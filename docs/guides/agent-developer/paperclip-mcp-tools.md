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