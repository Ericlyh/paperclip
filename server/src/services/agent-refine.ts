import { and, desc, eq, max, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agentInstructionSnapshots,
  agentRefineProposals,
  type AgentInstructionSnapshot,
  type AgentRefineProposal,
  type RefineProposalStatus,
} from "@paperclipai/db";
import {
  proposeRefinementInputSchema,
  refineProposedDeltaSchema,
  rollbackRefinementInputSchema,
  type ProposeRefinementInput,
  type RefineEvidencePointer,
  type RefineProposedDelta,
  type RollbackRefinementInput,
} from "@paperclipai/shared";
import { agentInstructionsService } from "./agent-instructions.js";
import { agentService } from "./agents.js";
import { badRequest, forbidden, notFound, unprocessable } from "../errors.js";

export interface BundleSnapshotContent {
  rootPath: string | null;
  entryFile: string;
  mode: "managed" | "external" | null;
  files: Record<string, string>;
}

export interface RefineProposalWithSnapshots {
  proposal: AgentRefineProposal;
  priorSnapshot: AgentInstructionSnapshot | null;
  sourceSnapshot: AgentInstructionSnapshot | null;
  rollbackSnapshots: AgentInstructionSnapshot[];
}

export interface RefineActorContext {
  agentId?: string | null;
  userId?: string | null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validateProposedDelta(raw: string): RefineProposedDelta {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw unprocessable("proposedDelta must be a JSON-encoded bundle delta");
  }
  const result = refineProposedDeltaSchema.safeParse(parsed);
  if (!result.success) {
    throw unprocessable(
      `proposedDelta is not a valid bundle delta: ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
  return result.data;
}

function evidenceLooksValid(evidence: RefineEvidencePointer[]): boolean {
  if (evidence.length === 0) return false;
  return evidence.every(
    (item) =>
      Boolean(asString(item.issueId)) ||
      Boolean(asString(item.runId)) ||
      Boolean(asString(item.citation)),
  );
}

/**
 * Per-paperclipai/policies: snapshots are append-only. The service layer never
 * offers UPDATE; rollback works by writing a NEW snapshot that mirrors a prior
 * one and supersedes the current instruction-set.
 */
export function agentRefineService(db: Db) {
  const instructions = agentInstructionsService();
  const svc = agentService(db);

  async function captureBundleContent(agentId: string): Promise<BundleSnapshotContent> {
    const agent = await svc.getById(agentId);
    if (!agent) throw notFound("Agent not found");
    const exported = await instructions.exportFiles(agent);
    const adapterConfig = asRecord(agent.adapterConfig);
    return {
      rootPath: asString(adapterConfig.instructionsRootPath),
      entryFile: exported.entryFile,
      mode: (asString(adapterConfig.instructionsBundleMode) as "managed" | "external" | null) ?? null,
      files: exported.files,
    };
  }

  async function nextVersionNumber(agentId: string): Promise<number> {
    const rows = await db
      .select({ value: max(agentInstructionSnapshots.version) })
      .from(agentInstructionSnapshots)
      .where(eq(agentInstructionSnapshots.agentId, agentId));
    const maxVersion = rows[0]?.value;
    return (typeof maxVersion === "number" ? maxVersion : 0) + 1;
  }

  async function insertSnapshot(input: {
    agentId: string;
    version: number;
    content: BundleSnapshotContent;
    sourceProposalId: string | null;
  }): Promise<AgentInstructionSnapshot> {
    const rows = await db
      .insert(agentInstructionSnapshots)
      .values({
        agentId: input.agentId,
        companyId: (await svc.getById(input.agentId))!.companyId,
        version: input.version,
        content: input.content,
        sourceProposalId: input.sourceProposalId,
      })
      .returning()
      .then((rows) => rows[0]);
    if (!rows) throw new Error("Failed to insert instruction snapshot");
    return rows;
  }

  return {
    propose: async (
      agentId: string,
      rawInput: unknown,
      actor: RefineActorContext,
    ): Promise<{ proposal: AgentRefineProposal; snapshot: AgentInstructionSnapshot }> => {
      const parsed = proposeRefinementInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable(
          `Invalid refine proposal: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        );
      }
      const body: ProposeRefinementInput = parsed.data;
      if (!evidenceLooksValid(body.evidence)) {
        throw unprocessable(
          "Each evidence pointer must include at least one of issueId, runId, or citation",
        );
      }
      const delta = validateProposedDelta(body.proposedDelta);

      const agent = await svc.getById(agentId);
      if (!agent) throw notFound("Agent not found");

      const bundle = await captureBundleContent(agentId);
      const priorVersion = await nextVersionNumber(agentId);

      return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const txSvc = agentRefineService(txDb);
        const snapshot = await txSvc.insertSnapshot({
          agentId,
          version: priorVersion,
          content: bundle,
          sourceProposalId: null,
        });
        const proposalRows = await tx
          .insert(agentRefineProposals)
          .values({
            agentId,
            companyId: agent.companyId,
            status: "pending",
            proposedDelta: JSON.stringify(delta),
            evidence: body.evidence,
            priorSnapshotId: snapshot.id,
            createdByAgentId: actor.agentId ?? null,
          })
          .returning()
          .then((rows) => rows[0]);
        if (!proposalRows) throw new Error("Failed to insert refine proposal");
        return { proposal: proposalRows, snapshot };
      });
    },

    list: async (
      agentId: string,
      status?: RefineProposalStatus,
    ): Promise<AgentRefineProposal[]> => {
      const conditions = status
        ? and(eq(agentRefineProposals.agentId, agentId), eq(agentRefineProposals.status, status))
        : eq(agentRefineProposals.agentId, agentId);
      return db
        .select()
        .from(agentRefineProposals)
        .where(conditions)
        .orderBy(desc(agentRefineProposals.createdAt));
    },

    get: async (proposalId: string): Promise<RefineProposalWithSnapshots | null> => {
      const proposal = await db
        .select()
        .from(agentRefineProposals)
        .where(eq(agentRefineProposals.id, proposalId))
        .then((rows) => rows[0] ?? null);
      if (!proposal) return null;
      const priorSnapshot = proposal.priorSnapshotId
        ? await db
            .select()
            .from(agentInstructionSnapshots)
            .where(eq(agentInstructionSnapshots.id, proposal.priorSnapshotId))
            .then((rows) => rows[0] ?? null)
        : null;
      const sourceSnapshot = priorSnapshot
        ? await db
            .select()
            .from(agentInstructionSnapshots)
            .where(eq(agentInstructionSnapshots.id, priorSnapshot.id))
            .then((rows) => rows[0] ?? null)
        : null;
      const rollbackSnapshots = priorSnapshot
        ? await db
            .select()
            .from(agentInstructionSnapshots)
            .where(
              and(
                eq(agentInstructionSnapshots.agentId, proposal.agentId),
                sql`${agentInstructionSnapshots.version} <= ${priorSnapshot.version}`,
              ),
            )
            .orderBy(desc(agentInstructionSnapshots.version))
        : [];
      return { proposal, priorSnapshot, sourceSnapshot, rollbackSnapshots };
    },

    approve: async (
      proposalId: string,
      actor: RefineActorContext,
      decisionNote?: string,
    ): Promise<{ proposal: AgentRefineProposal; snapshot: AgentInstructionSnapshot; agent: Awaited<ReturnType<typeof svc.getById>> }> => {
      if (!actor.agentId && !actor.userId) {
        throw forbidden("Approval requires a user or board-authorized agent");
      }
      return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const proposal = await tx
          .select()
          .from(agentRefineProposals)
          .where(eq(agentRefineProposals.id, proposalId))
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!proposal) throw notFound("Refine proposal not found");
        if (proposal.status !== "pending") {
          throw badRequest(`Refine proposal is already ${proposal.status}`);
        }
        const delta = validateProposedDelta(proposal.proposedDelta);
        const agent = await agentService(txDb).getById(proposal.agentId);
        if (!agent) throw notFound("Agent not found");

        const targetFiles = { ...delta.files };
        const entryFile = delta.entryFile;
        const materialized = await agentInstructionsService().materializeManagedBundle(
          agent,
          targetFiles,
          { replaceExisting: true, entryFile, clearLegacyPromptTemplate: true },
        );
        await agentService(txDb).update(
          agent.id,
          { adapterConfig: materialized.adapterConfig },
          {
            recordRevision: {
              createdByAgentId: actor.agentId ?? null,
              createdByUserId: actor.userId ?? null,
              source: "refine_approval",
            },
          },
        );

        const refreshedAgent = await agentService(txDb).getById(agent.id);
        if (!refreshedAgent) throw notFound("Agent disappeared during approval");
        const bundle = await captureBundleContent(agent.id);
        const version = await nextVersionNumber(agent.id);
        const snapshotRows = await tx
          .insert(agentInstructionSnapshots)
          .values({
            agentId: agent.id,
            companyId: agent.companyId,
            version,
            content: bundle,
            sourceProposalId: proposal.id,
          })
          .returning()
          .then((rows) => rows[0]);
        if (!snapshotRows) throw new Error("Failed to write post-approval snapshot");

        // Supersede prior pending proposals for the same agent (single-active
        // refinement in flight at a time).
        await tx
          .update(agentRefineProposals)
          .set({ status: "superseded" })
          .where(
            and(
              eq(agentRefineProposals.agentId, agent.id),
              eq(agentRefineProposals.status, "pending"),
              sql`${agentRefineProposals.id} <> ${proposal.id}`,
            ),
          );

        const updatedRows = await tx
          .update(agentRefineProposals)
          .set({
            status: "approved",
            decidedAt: new Date(),
            decidedByAgentId: actor.agentId ?? null,
            decidedByUserId: actor.userId ?? null,
            decisionNote: decisionNote ?? null,
          })
          .where(eq(agentRefineProposals.id, proposal.id))
          .returning()
          .then((rows) => rows[0]);
        if (!updatedRows) throw new Error("Failed to mark proposal approved");

        return { proposal: updatedRows, snapshot: snapshotRows, agent: refreshedAgent };
      });
    },

    reject: async (
      proposalId: string,
      actor: RefineActorContext,
      decisionNote?: string,
    ): Promise<AgentRefineProposal> => {
      if (!actor.agentId && !actor.userId) {
        throw forbidden("Rejection requires a user or board-authorized agent");
      }
      const updated = await db.transaction(async (tx) => {
        const proposal = await tx
          .select()
          .from(agentRefineProposals)
          .where(eq(agentRefineProposals.id, proposalId))
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!proposal) throw notFound("Refine proposal not found");
        if (proposal.status !== "pending") {
          throw badRequest(`Refine proposal is already ${proposal.status}`);
        }
        const rows = await tx
          .update(agentRefineProposals)
          .set({
            status: "rejected",
            decidedAt: new Date(),
            decidedByAgentId: actor.agentId ?? null,
            decidedByUserId: actor.userId ?? null,
            decisionNote: decisionNote ?? null,
          })
          .where(eq(agentRefineProposals.id, proposal.id))
          .returning()
          .then((rows) => rows[0]);
        return rows ?? null;
      });
      if (!updated) throw new Error("Failed to mark proposal rejected");
      return updated;
    },

    rollback: async (
      proposalId: string,
      rawInput: unknown,
      actor: RefineActorContext,
    ): Promise<{ proposal: AgentRefineProposal; snapshot: AgentInstructionSnapshot; agent: Awaited<ReturnType<typeof svc.getById>> }> => {
      if (!actor.agentId && !actor.userId) {
        throw forbidden("Rollback requires a user or board-authorized agent");
      }
      const parsed = rollbackRefinementInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable(
          `Invalid rollback input: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        );
      }
      const body: RollbackRefinementInput = parsed.data;
      return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const proposal = await tx
          .select()
          .from(agentRefineProposals)
          .where(eq(agentRefineProposals.id, proposalId))
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!proposal) throw notFound("Refine proposal not found");
        const targetSnapshot = await tx
          .select()
          .from(agentInstructionSnapshots)
          .where(eq(agentInstructionSnapshots.id, body.targetSnapshotId))
          .then((rows) => rows[0] ?? null);
        if (!targetSnapshot) throw notFound("Target snapshot not found");
        if (targetSnapshot.agentId !== proposal.agentId) {
          throw badRequest("Target snapshot belongs to a different agent");
        }
        const agent = await agentService(txDb).getById(proposal.agentId);
        if (!agent) throw notFound("Agent not found");

        const materialized = await agentInstructionsService().materializeManagedBundle(
          agent,
          targetSnapshot.content.files,
          {
            replaceExisting: true,
            entryFile: targetSnapshot.content.entryFile,
            clearLegacyPromptTemplate: true,
          },
        );
        await agentService(txDb).update(
          agent.id,
          { adapterConfig: materialized.adapterConfig },
          {
            recordRevision: {
              createdByAgentId: actor.agentId ?? null,
              createdByUserId: actor.userId ?? null,
              source: "refine_rollback",
            },
          },
        );

        const refreshedAgent = await agentService(txDb).getById(agent.id);
        if (!refreshedAgent) throw notFound("Agent disappeared during rollback");
        const postBundle = await captureBundleContent(agent.id);
        const version = await nextVersionNumber(agent.id);
        const snapshotRows = await tx
          .insert(agentInstructionSnapshots)
          .values({
            agentId: agent.id,
            companyId: agent.companyId,
            version,
            content: postBundle,
            sourceProposalId: proposal.id,
          })
          .returning()
          .then((rows) => rows[0]);
        if (!snapshotRows) throw new Error("Failed to write post-rollback snapshot");

        await tx
          .update(agentRefineProposals)
          .set({ status: "rolled_back" })
          .where(
            and(
              eq(agentRefineProposals.agentId, agent.id),
              eq(agentRefineProposals.status, "pending"),
              sql`${agentRefineProposals.id} <> ${proposal.id}`,
            ),
          );

        const updatedRows = await tx
          .update(agentRefineProposals)
          .set({
            status: "rolled_back",
            decidedAt: new Date(),
            decidedByAgentId: actor.agentId ?? null,
            decidedByUserId: actor.userId ?? null,
            decisionNote: body.decisionNote ?? null,
          })
          .where(eq(agentRefineProposals.id, proposal.id))
          .returning()
          .then((rows) => rows[0]);
        if (!updatedRows) throw new Error("Failed to mark proposal rolled_back");
        return { proposal: updatedRows, snapshot: snapshotRows, agent: refreshedAgent };
      });
    },

    listSnapshots: async (agentId: string): Promise<AgentInstructionSnapshot[]> =>
      db
        .select()
        .from(agentInstructionSnapshots)
        .where(eq(agentInstructionSnapshots.agentId, agentId))
        .orderBy(desc(agentInstructionSnapshots.version)),

    getSnapshot: async (snapshotId: string): Promise<AgentInstructionSnapshot | null> =>
      db
        .select()
        .from(agentInstructionSnapshots)
        .where(eq(agentInstructionSnapshots.id, snapshotId))
        .then((rows) => rows[0] ?? null),

    insertSnapshot,
  };
}
