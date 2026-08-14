import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

/**
 * Append-only snapshot of an agent's instruction-set bundle. Created either at
 * proposal time (capturing the current pre-delta state) or on approval (the
 * post-delta state). Source of truth for rollback.
 */
export const agentInstructionSnapshots = pgTable(
  "agent_instruction_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /**
     * JSON-encoded bundle: `{ rootPath, entryFile, mode, files }`.
     * Full content per snapshot (no diff storage) — see OOP-3490 non-goals.
     */
    content: jsonb("content").$type<{
      rootPath: string | null;
      entryFile: string;
      mode: "managed" | "external" | null;
      files: Record<string, string>;
    }>().notNull(),
    sourceProposalId: uuid("source_proposal_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentVersionIdx: index("agent_instruction_snapshots_agent_version_idx").on(
      table.agentId,
      table.version,
    ),
    agentCreatedIdx: index("agent_instruction_snapshots_agent_created_idx").on(
      table.agentId,
      table.createdAt,
    ),
    agentVersionUnique: index("agent_instruction_snapshots_agent_version_unique").on(
      table.agentId,
      table.version,
    ),
  }),
);

export type RefineProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "superseded"
  | "rolled_back";

/**
 * Evidence-backed proposal to refine an agent's instruction-set. Goes through
 * the Paperclip approval flow (always human/board-authorized agent decides).
 */
export const agentRefineProposals = pgTable(
  "agent_refine_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    /**
     * JSON-stringified proposed bundle delta. Shape:
     * `{ entryFile?: string, files: Record<string, string> }`.
     * Agents typically propose one file's new content; multi-file deltas are
     * allowed but rare.
     */
    proposedDelta: text("proposed_delta").notNull(),
    /**
     * Evidence backing the refinement. Each item must include at least one
     * of `issueId`, `runId`, or `citation`. Free-form `snippet` is allowed.
     */
    evidence: jsonb("evidence")
      .$type<Array<{ issueId?: string; runId?: string; snippet?: string; citation?: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    priorSnapshotId: uuid("prior_snapshot_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByUserId: text("decided_by_user_id"),
    decidedByAgentId: uuid("decided_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    decisionNote: text("decision_note"),
  },
  (table) => ({
    agentStatusIdx: index("agent_refine_proposals_agent_status_idx").on(table.agentId, table.status),
    companyCreatedIdx: index("agent_refine_proposals_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    statusCheck: check(
      "agent_refine_proposals_status_check",
      sql`${table.status} in ('pending','approved','rejected','superseded','rolled_back')`,
    ),
  }),
);

export type AgentInstructionSnapshot = typeof agentInstructionSnapshots.$inferSelect;
export type AgentInstructionSnapshotInsert = typeof agentInstructionSnapshots.$inferInsert;
export type AgentRefineProposal = typeof agentRefineProposals.$inferSelect;
export type AgentRefineProposalInsert = typeof agentRefineProposals.$inferInsert;
