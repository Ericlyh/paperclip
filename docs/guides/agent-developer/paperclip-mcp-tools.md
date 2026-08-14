# Paperclip MCP Tools Catalog (`llms.txt`)

A machine-readable catalog of every tool exposed by the standalone Paperclip MCP
server (`@paperclipai/mcp-server`). External coding agents (Claude Code, Cursor,
Codex) load this file at session start to discover which Paperclip APIs they can
call directly. The format mirrors Spotify Portal's
`backstage.spotify.com/docs/portal/core-features-and-plugins/mcp/available-tools.md`.

The server is a thin MCP wrapper over the existing Paperclip REST API — every
tool either maps to a single `/api` endpoint or composes a small number of
existing endpoints. Tool names use MCP-idiomatic camelCase; schemas are
zod-validated at registration time, so external agents can rely on stable JSON
input/output shapes.

## Authentication

All tools require a Paperclip bearer token with read or write scope matching the
tool. Configure the server with:

- `PAPERCLIP_API_URL` — Paperclip base URL, e.g. `http://localhost:3100`
- `PAPERCLIP_API_KEY` — bearer token with `/api` read+write scope
- `PAPERCLIP_COMPANY_ID` — optional default company for company-scoped tools
- `PAPERCLIP_AGENT_ID` — optional default agent for checkout helpers
- `PAPERCLIP_RUN_ID` — optional run id forwarded on mutating requests (required
  when the calling agent is an MCP server session acting on its own behalf — see
  `claude-code-host.md` §OOP-2961)

## Read tools

| Tool | Purpose | Inputs |
| --- | --- | --- |
| `paperclipMe` | Current authenticated actor details | none |
| `paperclipInboxLite` | Agent's inbox-lite assignment list | none |
| `paperclipListAgents` | List agents in a company | `companyId?` |
| `paperclipGetAgent` | Get a single agent | `agentId`, `companyId?` |
| `paperclipListIssues` | Search/list issues with filters | `q?`, `status?`, `projectId?`, `assigneeAgentId?`, `labelId?`, … |
| `paperclipGetIssue` | Get a single issue | `issueId` |
| `paperclipGetHeartbeatContext` | Compact heartbeat context for an issue | `issueId`, `wakeCommentId?` |
| `paperclipListComments` | List comments on an issue | `issueId`, `after?`, `order?`, `limit?` |
| `paperclipGetComment` | Get one comment | `issueId`, `commentId` |
| `paperclipListIssueApprovals` | Approvals linked to an issue | `issueId` |
| `paperclipListDocuments` | List issue documents | `issueId` |
| `paperclipGetDocument` | Get one issue document by key | `issueId`, `key` |
| `paperclipListDocumentRevisions` | Document revision history | `issueId`, `key` |
| `paperclipListProjects` | List projects in a company | `companyId?` |
| `paperclipGetProject` | Get one project | `projectId`, `companyId?` |
| `paperclipGetIssueWorkspaceRuntime` | Workspace + runtime services for an issue | `issueId` |
| `paperclipGetWorkspaceContext` | Project-scoped Workspace context bundle (X-1 / OOP-3448): project + recent issues / decisions / documents / runs + members | `projectId`, `companyId?`, `issueLimit?`, `decisionLimit?`, `documentLimit?`, `runLimit?` |
| `paperclipGetIssueWorkspaceContext` | Workspace context bundle scoped to an issue's project; gracefully returns `error: "issue_has_no_project"` when no project | `issueId`, `issueLimit?`, `decisionLimit?`, `documentLimit?`, `runLimit?` |
| `paperclipListWorkspaceMembers` | Members (users + agents) associated with a project's Workspace | `projectId`, `companyId?` |
| `paperclipGetServiceOwnership` | Owner team + related entities for a service | `issueId`, `runtimeServiceId` or `serviceName` |
| `paperclipListRecentSessionsForService` | Recent agent runs against a service | `issueId`, `runtimeServiceId` or `serviceName`, `limit?`, `includeTranscripts?` |
| `paperclipWaitForIssueWorkspaceService` | Block until a service is ready | `issueId`, `serviceName?` or `runtimeServiceId?`, `timeoutSeconds?` |
| `paperclipListGoals` | List goals | `companyId?` |
| `paperclipGetGoal` | Get one goal | `goalId` |
| `paperclipListApprovals` | List approvals | `companyId?`, `status?` |
| `paperclipGetApproval` | Get one approval | `approvalId` |
| `paperclipGetApprovalIssues` | Issues linked to an approval | `approvalId` |
| `paperclipListApprovalComments` | Comments on an approval | `approvalId` |

## Write tools

| Tool | Purpose | Inputs |
| --- | --- | --- |
| `paperclipCreateIssue` | Create an issue | `companyId?`, `title`, `…` |
| `paperclipUpdateIssue` | Patch an issue (supports `resume: true`) | `issueId`, `…` |
| `paperclipCheckoutIssue` | Check out an issue for an agent | `issueId`, `agentId?` |
| `paperclipReleaseIssue` | Release a checkout | `issueId` |
| `paperclipAddComment` | Add a comment (supports `resume: true`) | `issueId`, `body`, `…` |
| `paperclipSuggestTasks` | Create `suggest_tasks` interaction | `issueId`, `payload` |
| `paperclipAskUserQuestions` | Create `ask_user_questions` interaction | `issueId`, `payload` |
| `paperclipRequestConfirmation` | Create `request_confirmation` interaction | `issueId`, `payload` |
| `paperclipUpsertIssueDocument` | Create/update issue document | `issueId`, `key`, `body`, `…` |
| `paperclipRestoreIssueDocumentRevision` | Restore prior revision | `issueId`, `key`, `revisionId` |
| `paperclipControlIssueWorkspaceServices` | Start/stop/restart runtime services | `issueId`, `action`, `…` |
| `paperclipCreateApproval` | Create board approval | `companyId?`, `type`, `payload`, `…` |
| `paperclipLinkIssueApproval` | Link an approval to an issue | `issueId`, `approvalId` |
| `paperclipUnlinkIssueApproval` | Unlink an approval | `issueId`, `approvalId` |
| `paperclipApprovalDecision` | Approve / reject / request revision / resubmit | `approvalId`, `action`, `…` |
| `paperclipAddApprovalComment` | Add approval comment | `approvalId`, `body` |
| `paperclipProposeRefinement` | Propose a refinement to an agent's instruction-set (Continual Harness `/refine`); captures a snapshot of the current state and returns `{ proposalId, snapshotId }` | `agentId`, `companyId?`, `proposedDelta` (JSON-stringified `{entryFile?, files}`), `evidence[]` (≥1 pointer, each with `issueId`/`runId`/`citation`) |
| `paperclipListRefineProposals` | List proposals for an agent, optional `status` filter | `agentId`, `companyId?`, `status?` |
| `paperclipGetRefineProposal` | Get a single proposal with its prior snapshot, source snapshot, and rollback snapshot chain | `proposalId`, `companyId?` |
| `paperclipApproveRefinement` | Approve a pending proposal; writes the delta to the agent's instruction-set, captures a new snapshot, supersedes other pending proposals for the same agent | `proposalId`, `companyId?`, `decisionNote?` |
| `paperclipRejectRefinement` | Reject a pending proposal with an optional note | `proposalId`, `companyId?`, `decisionNote?` |
| `paperclipRollbackRefinement` | Roll back an approved proposal to a specific prior `targetSnapshotId`; writes a new snapshot that mirrors the target | `proposalId`, `companyId?`, `targetSnapshotId` (uuid), `decisionNote?` |

### Continual Harness /refine (OOP-3490 P-1)

The 6 refine tools implement the Continual Harness pattern (Prime Agent's
`/refine`, ported to Paperclip with our approval flow). The three core tools are
`paperclipProposeRefinement`, `paperclipListRefineProposals`, and
`paperclipRollbackRefinement`. `paperclipGetRefineProposal`,
`paperclipApproveRefinement`, and `paperclipRejectRefinement` round out the
surface. Snapshots are append-only — rollback writes a NEW snapshot that mirrors
a prior one and never mutates existing snapshot rows. See
`paperclip-refine.md` for the full flow (evidence rules, status lifecycle, when
to invoke).

## Escape hatch

- `paperclipApiRequest` — Make a JSON request to any `/api` endpoint that does
  not yet have a dedicated tool. Restricted to paths under `/api`; rejects
  paths containing `..`. Accepts `method`, `path`, `jsonBody?`.

## Cross-references to OOP-3431 acceptance criteria

The OOP-3431 issue acceptance criteria are met by these tools:

| Criterion (OOP-3431) | Tool | Mapping |
| --- | --- | --- |
| `paperclip.search_issues` | `paperclipListIssues` | accepts `q` plus optional `status`, `projectId`, `assigneeAgentId`, `companyId`, `limit` |
| `paperclip.get_issue` | `paperclipGetIssue` | returns full issue; use `paperclipListComments` separately for recent comments |
| `paperclip.get_service_ownership` | `paperclipGetServiceOwnership` | resolves a workspace runtime service to owning company + assignee agents + related approvals |
| `paperclip.list_related_decisions` | `paperclipListIssueApprovals` + `paperclipGetApprovalIssues` | list approvals for an issue; list issues for an approval |
| `paperclip.list_recent_sessions_for_service` | `paperclipListRecentSessionsForService` | recent heartbeat runs scoped to a workspace runtime service |

## Smoke testing

The end-to-end smoke for the standalone MCP server is the
`scripts/smoke/mcp-fixture-harness.mjs` fixture harness plus the
`tests/e2e/mcp-user-stories.spec.ts` Playwright suite. To verify that the
`paperclipListIssues` tool agrees with `GET /api/issues?q=…`:

1. Start a local Paperclip server (`pnpm dev:server`).
2. Spawn the MCP server with `PAPERCLIP_API_URL` and `PAPERCLIP_API_KEY` set.
3. From any MCP-aware client, call `paperclipListIssues` with `q=<term>` and
   compare the response to `GET /api/companies/<id>/issues?q=<term>` — the
   payloads should match shape-for-shape because the tool proxies directly to
   the `/api` endpoint.

## Stable schema versioning

Each tool registers its zod schema at MCP registration time. External agents
should use the `inputSchema` and `outputSchema` returned by `tools/list` to
self-correct when the schema evolves. Breaking changes are gated on a schema
version bump in the package and a release note under
`doc/RELEASE-NOTES-mcp-access-governance.md`.
## Workspace context (X-1 / OOP-3448)

The Workspace pattern (mirroring Xirp / Backstage `Workspaces`) gives an
external coding agent a single-call institutional-memory view of the project an
issue belongs to. Use it at session start before any other Paperclip call.

### Recommended session-start flow

1. `paperclipGetIssue` to load the issue you were asked to work on.
2. `paperclipGetIssueWorkspaceContext({ issueId })` to pull the project-scoped
   Workspace bundle. Inspect:
   - `project` for upstream ownership, status, lead agent, goals.
   - `recentIssues` (≤20) for sibling work, blockers, in-flight tickets.
   - `recentDecisions` (≤10) for prior decisions recorded against project
     issues.
   - `recentDocuments` (≤10) for runbooks, plans, and wiki pages attached to
     project issues.
   - `recentRuns` (≤10) for the most recent heartbeat runs against project
     issues (useful for "what did the team try last").
   - `members` for the humans and agents that touch the project.
   - `summary` for aggregate counts (issues, open issues, decisions, docs,
     runs, members) and `generatedAt` for freshness.
3. If `paperclipGetIssueWorkspaceContext` returns
   `{ error: "issue_has_no_project" }`, the issue is unassigned to a project —
   fall back to `paperclipGetHeartbeatContext` for issue-scoped context and
   `paperclipListIssues({ projectId })` to suggest a project.
4. Optional follow-up: `paperclipListWorkspaceMembers({ projectId })` to get
   just the membership roster, and `paperclipGetWorkspaceContext({ projectId,
   issueLimit: 50, decisionLimit: 25, … })` to widen any individual slice.

### How the HTTP and MCP surfaces line up

| MCP tool | HTTP route |
| --- | --- |
| `paperclipGetWorkspaceContext` | `GET /api/companies/:companyId/projects/:projectId/workspace-context` |
| `paperclipGetIssueWorkspaceContext` | `GET /api/issues/:id/workspace-context` |
| `paperclipListWorkspaceMembers` | `GET /api/companies/:companyId/projects/:projectId/workspace-members` |

Bundle shape is the canonical `WorkspaceContextBundle` zod schema in
`packages/shared/src/validators/workspace-context.ts`. All `recent*` arrays are
sorted by `updatedAt` desc (with `createdAt` as a stable tiebreak) and capped
at the documented limits (`WORKSPACE_CONTEXT_DEFAULTS`).

### Why a Workspace instead of just `paperclipGetHeartbeatContext`

`paperclipGetHeartbeatContext` is optimized for a single issue's wake-up: a
flat map of ancestors, attention, recovery actions, productivity review, and
the current execution workspace. The Workspace bundle is optimized for
**picking up an issue cold** — what does this project own, who works on it,
what's been decided, what's been tried. Together they form a two-step
"context on demand" pattern that scales to long-running agent work without
loading every fact into every prompt.

### UI surface (OOP-3462)

The same `WorkspaceContextBundle` is rendered in the Paperclip board as a
read-only **Workspace** tab on the issue-detail page (issues with a
`projectId` only; the tab gracefully shows a "no project linkage" placeholder
when the issue is unassigned). The tab renders the project header, summary
counts, recent issues / decisions / documents / runs, and members — exactly
the same fields the MCP tools return. No caching or write-back at the UI
layer; the panel is a thin read-only view layered on top of the existing
`GET /api/issues/:id/workspace-context` HTTP route.
