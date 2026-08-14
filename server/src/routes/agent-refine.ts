import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  refineProposalStatusSchema,
} from "@paperclipai/shared";
import { agentRefineService, type RefineActorContext } from "../services/agent-refine.js";
import { logActivity } from "../services/activity-log.js";
import { validate } from "../middleware/validate.js";
import {
  proposeRefinementInputSchema,
  rollbackRefinementInputSchema,
} from "@paperclipai/shared";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { agentService } from "../services/agents.js";

type RefineProposalStatus = "pending" | "approved" | "rejected" | "superseded" | "rolled_back";

/**
 * Continual Harness /refine routes (OOP-3490 P-1).
 *
 * Six endpoints:
 *   POST   /api/companies/:companyId/agents/:agentId/refine
 *   GET    /api/companies/:companyId/agents/:agentId/refine-proposals
 *   GET    /api/companies/:companyId/refine-proposals/:id
 *   POST   /api/companies/:companyId/refine-proposals/:id/approve
 *   POST   /api/companies/:companyId/refine-proposals/:id/reject
 *   POST   /api/companies/:companyId/refine-proposals/:id/rollback
 *
 * Approval semantics: `approve` writes the proposed delta to the agent's
 * instruction-set bundle, captures a fresh snapshot, and supersedes any
 * other pending proposals for the same agent. `rollback` reverses an
 * approved proposal by restoring a target snapshot and writing a new
 * snapshot that mirrors it. Both require `actor.agentId` (board-authorized)
 * or `actor.userId` to be present.
 */

function readActor(actor: ReturnType<typeof getActorInfo>): RefineActorContext {
  if (actor.actorType === "agent") {
    return { agentId: actor.actorId, userId: null };
  }
  return { agentId: null, userId: actor.actorId };
}

function parseStatus(req: Request): RefineProposalStatus | undefined {
  const raw = typeof req.query.status === "string" ? req.query.status : undefined;
  if (!raw) return undefined;
  const parsed = refineProposalStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function agentRefineRoutes(db: Db) {
  const router = Router();
  const svc = agentRefineService(db);
  const agents = agentService(db);

  router.post(
    "/companies/:companyId/agents/:agentId/refine",
    validate(proposeRefinementInputSchema),
    async (req, res) => {
      const { companyId, agentId } = req.params as { companyId: string; agentId: string };
      const existing = await agents.getById(agentId);
      if (!existing || existing.companyId !== companyId) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      await assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const result = await svc.propose(agentId, req.body, readActor(actor));

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "agent.refine_proposed",
        entityType: "agent_refine_proposal",
        entityId: result.proposal.id,
        details: {
          targetAgentId: agentId,
          snapshotId: result.snapshot.id,
          evidenceCount: result.proposal.evidence?.length ?? 0,
        },
      });

      res.status(201).json({
        proposalId: result.proposal.id,
        snapshotId: result.snapshot.id,
        proposal: result.proposal,
        snapshot: result.snapshot,
      });
    },
  );

  router.get(
    "/companies/:companyId/agents/:agentId/refine-proposals",
    async (req, res) => {
      const { companyId, agentId } = req.params as { companyId: string; agentId: string };
      const existing = await agents.getById(agentId);
      if (!existing || existing.companyId !== companyId) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      await assertCompanyAccess(req, companyId);
      const status = parseStatus(req);
      const proposals = await svc.list(agentId, status);
      res.json(proposals);
    },
  );

  router.get("/companies/:companyId/refine-proposals/:id", async (req, res) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const detail = await svc.get(id);
    if (!detail || detail.proposal.companyId !== companyId) {
      res.status(404).json({ error: "Refine proposal not found" });
      return;
    }
    await assertCompanyAccess(req, companyId);
    res.json(detail);
  });

  router.post("/companies/:companyId/refine-proposals/:id/approve", async (req, res) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const existing = await svc.get(id);
    if (!existing || existing.proposal.companyId !== companyId) {
      res.status(404).json({ error: "Refine proposal not found" });
      return;
    }
    await assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const note = typeof req.body?.decisionNote === "string" ? req.body.decisionNote : undefined;
    const result = await svc.approve(id, readActor(actor), note);

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "agent.refine_approved",
      entityType: "agent_refine_proposal",
      entityId: id,
      details: {
        targetAgentId: existing.proposal.agentId,
        snapshotId: result.snapshot.id,
      },
    });

    res.json({
      proposal: result.proposal,
      snapshot: result.snapshot,
      agent: result.agent,
    });
  });

  router.post("/companies/:companyId/refine-proposals/:id/reject", async (req, res) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const existing = await svc.get(id);
    if (!existing || existing.proposal.companyId !== companyId) {
      res.status(404).json({ error: "Refine proposal not found" });
      return;
    }
    await assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const note = typeof req.body?.decisionNote === "string" ? req.body.decisionNote : undefined;
    const proposal = await svc.reject(id, readActor(actor), note);

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "agent.refine_rejected",
      entityType: "agent_refine_proposal",
      entityId: id,
      details: { targetAgentId: existing.proposal.agentId },
    });

    res.json({ proposal });
  });

  router.post(
    "/companies/:companyId/refine-proposals/:id/rollback",
    validate(rollbackRefinementInputSchema),
    async (req, res) => {
      const { companyId, id } = req.params as { companyId: string; id: string };
      const existing = await svc.get(id);
      if (!existing || existing.proposal.companyId !== companyId) {
        res.status(404).json({ error: "Refine proposal not found" });
        return;
      }
      await assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const result = await svc.rollback(id, req.body, readActor(actor));

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "agent.refine_rolled_back",
        entityType: "agent_refine_proposal",
        entityId: id,
        details: {
          targetAgentId: existing.proposal.agentId,
          snapshotId: result.snapshot.id,
          targetSnapshotId: req.body.targetSnapshotId,
        },
      });

      res.json({
        proposal: result.proposal,
        snapshot: result.snapshot,
        agent: result.agent,
      });
    },
  );

  return router;
}
