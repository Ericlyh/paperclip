import { z } from "zod";

/**
 * Evidence pointer backing a refinement. Must contain at least one of
 * `issueId`, `runId`, or `citation`. `snippet` is free-form supporting context.
 */
export const refineEvidencePointerSchema = z
  .object({
    issueId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    citation: z.string().trim().min(1).max(2000).optional(),
    snippet: z.string().trim().max(8000).optional(),
  })
  .refine(
    (value) =>
      Boolean(value.issueId) || Boolean(value.runId) || Boolean(value.citation),
    {
      message: "Each evidence pointer must include at least one of issueId, runId, or citation",
    },
  );

export type RefineEvidencePointer = z.infer<typeof refineEvidencePointerSchema>;

/**
 * JSON-stringified bundle delta proposed by a /refine call. Shape:
 * `{ entryFile?: string, files: Record<string,string> }`.
 */
export const refineProposedDeltaSchema = z
  .object({
    entryFile: z.string().trim().min(1).max(255).optional(),
    files: z.record(z.string().trim().min(1).max(255), z.string().max(524288)),
  })
  .refine((value) => Object.keys(value.files).length > 0, {
    message: "proposedDelta must include at least one file",
  });

export type RefineProposedDelta = z.infer<typeof refineProposedDeltaSchema>;

/**
 * Body for POST /api/companies/:companyId/agents/:agentId/refine.
 * `proposedDelta` arrives as a string the server will JSON-parse. This keeps
 * the wire format stable while letting callers ship multi-file bundles.
 */
export const proposeRefinementInputSchema = z.object({
  proposedDelta: z.string().trim().min(1).max(2_000_000),
  evidence: z.array(refineEvidencePointerSchema).min(1).max(50),
});

export type ProposeRefinementInput = z.infer<typeof proposeRefinementInputSchema>;

export const refineProposalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "superseded",
  "rolled_back",
]);

export const refinementDecisionNoteSchema = z.string().trim().max(2000).optional();

/**
 * Body for POST /api/companies/:companyId/refine-proposals/:id/rollback.
 * Rollback must target an explicit prior snapshot id — no implicit "previous".
 */
export const rollbackRefinementInputSchema = z.object({
  targetSnapshotId: z.string().uuid(),
  decisionNote: refinementDecisionNoteSchema,
});

export type RollbackRefinementInput = z.infer<typeof rollbackRefinementInputSchema>;
