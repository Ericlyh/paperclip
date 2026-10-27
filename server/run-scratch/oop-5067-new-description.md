## Ownership
- **Owner:** paperclip (routine lifecycle: cron, gate, triage surface, escalation routing)
- **Executor:** Claude Code (host) — claude_local adapter, agentId 32a76d69-dd7f-4b4c-aadb-eb0cb71baf58
- **Orchestrator:** Claude Code (host) (self-orchestrated; cross-loop spot-check lives in the heartbeat digest)

## 4-condition test
- Repeats at least weekly? Y — hourly at minute 23 HKT (cron `23 * * * *`, timezone `Asia/Hong_Kong`); user pick `every hour` from interaction 2cc4bed1-24e6-40e9-93d0-680dc4844ac5
- Objective gate? Y — **two-stage**:
  - **Stage 1 (API):** `curl -fsS -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues?status=backlog&assigneeAgentId=$PAPERCLIP_AGENT_ID&limit=10"` returns 200 with at least one item — the candidate set. (`activityGatePolicy=always` means the curl runs on every fire; an empty result is an honest "no backlog to claim" not a gate short-circuit.)
  - **Stage 2 (executor, BEFORE claim):** for each candidate, fetch `GET /api/issues/{id}` and skip (with audit) if ANY of: (a) candidate's own `blockedByIssueIds.length > 0`, (b) candidate's `parentId` is non-null AND parent's `status in {blocked, cancelled, done}`, (c) candidate's `assigneeAgentId` is no longer me. The audit comment names the filtered items + reason for each.
  - **Why two stages:** the issues list API does not support `blockedByIssueIds=none` or `parentStatus=…` query filters (see `IssueFilters` in `paperclip-src/server/src/services/issues.ts:537-579`); the OOP-5067 drift issue proposed pushing these to the gate, but the only API-supported parent filter is `parentId=<UUID>`, which doesn't help with "no parent" or "parent active". Stage 2 is the executor's documented compensation.
  - **Gate exit code:** stage 1 must succeed (curl 200). Stage 2 is data-driven, not exit-code-driven.
- Token budget? Y — $0.05/run idle (stage 1 empty → skip), $0.05–$0.10/run when stage 2 filters everything (stage 1 returns N items, executor fetches parent for each, all skipped → skip with audit), $0.15–$0.40/run when claiming a ticket; ~$1–$3/mo assuming 24 runs/day mostly idle
- Senior-engineer tools? Y — host LaunchAgent `com.molt.paperclip.plist`, full repo checkout under `/Users/molt/.paperclip/instances/default/projects/ed30ea86-a66e-434b-b307-6776a59f7698/`, env credentials for Paperclip + Vercel + Supabase + `VERCELTOKEN` + `SUPABASEACCESSTOKEN_LOVEBYTE`

## Triage
- triageTarget: <this-routine-fire-issue> (the auto-generated OOP-50xx issue that the dispatch created for THIS fire — its `linkedIssueId` from the run record; executor posts its summary comment THERE, not on OOP-4211 (stale LoveByte umbrella) and not on a different umbrella)
- Audit destination: per-fire issue. Each fire's audit comment lives on its own OOP-50xx issue. There is no umbrella audit-log issue.

## Escalation
- Trigger A: stage 1 returns empty for 3 consecutive runs → priority=medium issue assigned to user, blocks=[<this-routine>]
- Trigger B: routine claims an issue that lands `blocked` within the same heartbeat → priority=high issue assigned to user naming the specific blocked issue, blocks=[<this-routine>, <claimed-issue>]
- Trigger C: routine errors out (control-plane write fails twice in a row per the 2-strike rule) → priority=high issue assigned to Claude Code (host) for self-repair, blocks=[<this-routine>]
- Trigger D (NEW, OOP-5067 drift self-repair): 4+ consecutive fires where stage 1 returns non-empty AND stage 2 filters everything AND the SAME candidates are filtered each time (same parent UUIDs / same `blockedByIssueIds` patterns) → priority=low issue assigned to Claude Code (host) for routine-description drift self-repair, blocks=[<this-routine>]. First observed: OOP-5066 22:23 HKT 2026-09-23 (5th consecutive identical fire). Trigger D only fires when the persistent pattern suggests the description is drifting from actual practice; legitimate stage-2 filtering of varied candidates (i.e. the filter is doing its job across a changing backlog) does NOT trip Trigger D.

## Tier 2 — MVL pieces
- Skill: /Users/molt/.paperclip/agent-instructions/claude-code-host.md (host executor reads this on wake)
- State file: <this-routine-fire-issue> (the auto-generated OOP-50xx per fire acts as both audit log and run-state record; routine summaries posted as comments here)

## Loop owner
- paperclip (orchestrator: Claude Code (host))

## Cadence rationale
- User asked `every hour`; cron `23 * * * *` avoids the :00 collision that stacks every Paperclip wakeup. Revised 2026-09-22: `activityGatePolicy=always` (was `require_external_activity` — that policy is correct for *reactive* routines like CI triage or alert monitors, but inverted for a *proactive* sweeper: it required external project activity, which is exactly the condition the routine was supposed to eliminate, so 5 days of hourly fires (~120) returned 0 claims). `concurrencyPolicy=skip_if_active` still prevents pile-up.
- Revised 2026-09-24 (OOP-5067): gate is now two-stage — stage 1 (API) returns candidates; stage 2 (executor) skips items whose parent is blocked/done/cancelled or whose own `blockedByIssueIds` is non-empty. triageTarget changed from OOP-4211 (stale LoveByte umbrella) to <this-routine-fire-issue>. Trigger D added for routine-description drift self-repair. Pre-fix baseline (5 consecutive fires OOP-5016/5024/5026/5034/5064): stage 1 returned the same 4 items (OOP-2817/117/116/2677) every fire; stage 2 (now verified) would skip all 4 because their parents are OOP-2816=blocked, OOP-111=done, OOP-2411=blocked. Expected post-fix outcome: stage 1 returns the same 4 items, stage 2 filters all 4, executor skips with audit. Stage-1 items will stop appearing once the 4 parents are resolved or the 4 children are closed/archived.
