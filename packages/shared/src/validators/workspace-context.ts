import { z } from "zod";

/**
 * Stable shape for the project-scoped Workspace context bundle (X-1 / OOP-3448).
 *
 * A Workspace is a project-scoped knowledge hub that aggregates institutional
 * memory for any agent picking up an issue. The bundle mirrors the Xirp
 * Workspace pattern from Backstage, adapted to Paperclip's existing primitives
 * (projects, issues, decisions, documents, heartbeat_runs, memberships).
 *
 * All "recent*" arrays are sorted by `updatedAt` (or, when absent, by `createdAt`)
 * descending and capped at the documented limit. The shape is intentionally
 * read-only for v0.1.
 */

export const WORKSPACE_CONTEXT_DEFAULTS = {
  recentIssuesLimit: 20,
  recentDecisionsLimit: 10,
  recentDocumentsLimit: 10,
  recentRunsLimit: 10,
} as const;

export const workspaceContextProjectSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable().optional(),
    status: z.string(),
    color: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
    leadAgentId: z.string().uuid().nullable().optional(),
    urlKey: z.string().nullable().optional(),
    goalIds: z.array(z.string().uuid()).optional(),
    goals: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            title: z.string().nullable().optional(),
            status: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .optional(),
    updatedAt: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
  })
  .passthrough();

export const workspaceContextIssueSummarySchema = z
  .object({
    id: z.string().uuid(),
    identifier: z.string().nullable().optional(),
    title: z.string(),
    status: z.string(),
    priority: z.string().nullable().optional(),
    assigneeAgentId: z.string().uuid().nullable().optional(),
    assigneeUserId: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
  })
  .passthrough();

export const workspaceContextDecisionSummarySchema = z
  .object({
    id: z.string().uuid(),
    bundleId: z.string().uuid().nullable().optional(),
    originIssueId: z.string().uuid().nullable().optional(),
    originIssueIdentifier: z.string().nullable().optional(),
    title: z.string(),
    status: z.string().nullable().optional(),
    executionStatus: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough();

export const workspaceContextDocumentSummarySchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().nullable().optional(),
    format: z.string().nullable().optional(),
    latestRevisionNumber: z.number().int().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
  })
  .passthrough();

export const workspaceContextRunSummarySchema = z
  .object({
    runId: z.string().uuid(),
    agentId: z.string().uuid().nullable().optional(),
    agentName: z.string().nullable().optional(),
    adapterType: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    finishedAt: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    invocationSource: z.string().nullable().optional(),
    errorCode: z.string().nullable().optional(),
  })
  .passthrough();

export const workspaceContextMemberSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    role: z.string().nullable().optional(),
  })
  .passthrough();

export const workspaceContextMembersSchema = z
  .object({
    users: z.array(workspaceContextMemberSchema),
    agents: z.array(workspaceContextMemberSchema),
  })
  .strict();

export const workspaceContextSummarySchema = z
  .object({
    issueCount: z.number().int().nonnegative(),
    openIssueCount: z.number().int().nonnegative(),
    decisionCount: z.number().int().nonnegative(),
    documentCount: z.number().int().nonnegative(),
    runCount: z.number().int().nonnegative(),
    memberCount: z.number().int().nonnegative(),
    generatedAt: z.string(),
  })
  .strict();

export const workspaceContextBundleSchema = z
  .object({
    project: workspaceContextProjectSchema.nullable(),
    recentIssues: z.array(workspaceContextIssueSummarySchema),
    recentDecisions: z.array(workspaceContextDecisionSummarySchema),
    recentDocuments: z.array(workspaceContextDocumentSummarySchema),
    recentRuns: z.array(workspaceContextRunSummarySchema),
    members: workspaceContextMembersSchema,
    summary: workspaceContextSummarySchema,
  })
  .strict();

export type WorkspaceContextBundle = z.infer<typeof workspaceContextBundleSchema>;
export type WorkspaceContextSummary = z.infer<typeof workspaceContextSummarySchema>;
export type WorkspaceContextMembers = z.infer<typeof workspaceContextMembersSchema>;
export type WorkspaceContextMember = z.infer<typeof workspaceContextMemberSchema>;
export type WorkspaceContextIssueSummary = z.infer<typeof workspaceContextIssueSummarySchema>;
export type WorkspaceContextDecisionSummary = z.infer<typeof workspaceContextDecisionSummarySchema>;
export type WorkspaceContextDocumentSummary = z.infer<typeof workspaceContextDocumentSummarySchema>;
export type WorkspaceContextRunSummary = z.infer<typeof workspaceContextRunSummarySchema>;
export type WorkspaceContextProject = z.infer<typeof workspaceContextProjectSchema>;

export const workspaceContextQuerySchema = z
  .object({
    issueLimit: z.coerce.number().int().positive().max(100).optional(),
    decisionLimit: z.coerce.number().int().positive().max(50).optional(),
    documentLimit: z.coerce.number().int().positive().max(50).optional(),
    runLimit: z.coerce.number().int().positive().max(50).optional(),
  })
  .strict();

export type WorkspaceContextQuery = z.infer<typeof workspaceContextQuerySchema>;
