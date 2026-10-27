# OOP-2793 — Agent-scoped board API keys

**Status:** plan
**Issue:** OOP-2793 (child of OOP-2792)
**Branch:** `oop-2793-agent-scoped-board-keys`
**Worktree:** `.worktrees/oop-2793`

## Problem

Harness-posted comments resolve to a *user* actor because the host's
`PAPERCLIP_API_KEY` is a `board_api_keys` row whose only principal column is
`user_id` (NOT NULL). The self-skip check at
`server/src/routes/issues.ts:5984` compares
`actor.actorType === "agent" && actor.actorId === assigneeId` and therefore
never matches harness-posted comments. The OOP-2792 routine-exemption fix
catches the cron-driven comments, but the manually-dispatched harness loop on
OOP-2761 still wakes itself.

## Goal

Let the harness authenticate as an **agent identity** so comment POSTs get
`authorType="agent"`, `authorAgentId=<self>`, and the existing self-skip branch
fires.

## Approach — add `agent_id` to `board_api_keys`

Make `board_api_keys` dual-owner: either `user_id` OR `agent_id` is set, never
both. The actor middleware resolves whichever is set.

### Why not the alternatives

- **Reuse `agentApiKeys`** — that table is for runtime→paperclip auth from a
  single-company agent process. The harness is host-side and often needs
  cross-company visibility. Different surface.
- **Separate `agent_board_api_keys` table** — doubles the auth lookup path
  and the index. The `boardApiKeys` hash index already exists and is the
  canonical "external caller" key store.
- **Restore OOP-2592's JWT injection** — that env injection is intentionally
  not the production path; the harness token is a bearer resolved by the auth
  middleware.

## Schema migration `0227_agent_scoped_board_api_keys.sql`

See file in `packages/db/src/migrations/0227_agent_scoped_board_api_keys.sql`.

## File-by-file change list

| File | Change |
|---|---|
| `packages/db/src/migrations/0227_agent_scoped_board_api_keys.sql` | NEW |
| `packages/db/dist/migrations/0227_agent_scoped_board_api_keys.sql` | NEW (mirror) |
| `packages/db/src/schema/board_api_keys.ts` | Add agent_id column, drop user_id NOT NULL |
| `server/src/services/board-auth.ts` | Dual-owner API |
| `server/src/middleware/auth.ts` | Branch on agent_id, new source value |
| `server/src/types/express.d.ts` | Add `agent_board_key` to source union |
| `server/src/routes/access.ts` | Accept agentId in POST body, gate by permission |
| `server/src/routes/openapi.ts` | Register new schema field |
| `packages/shared/src/validators/access.ts` | Extend createBoardApiKeySchema |
| `server/src/__tests__/board-api-key-agent-routes.test.ts` | NEW tests |
| `dist/*` | Regenerated via `pnpm build` |

## Acceptance criteria

From OOP-2792 issue body (24h soak semantics):

- Harness (Claude Code host) posting a comment via an agent-scoped board API
  key on its own assigned issue → zero `issue_commented` wakes.
- Harness posting a comment on an issue assigned to a *different* agent → wake
  fires once (no regression).
- Manual `in_progress` / `done` loops on OOP-2761-style issues → no self-wake
  amplification.
- 1h soak: zero unintended `issue_commented` wakes on OOP-2791 / OOP-2787 /
  OOP-2789 from harness-posted comments.

## Rollback

Reversible via a single migration:
```sql
DELETE FROM board_api_keys WHERE agent_id IS NOT NULL;
ALTER TABLE board_api_keys DROP CONSTRAINT board_api_keys_one_owner_chk;
ALTER TABLE board_api_keys DROP CONSTRAINT board_api_keys_agent_id_agents_id_fk;
DROP INDEX board_api_keys_agent_idx;
ALTER TABLE board_api_keys DROP COLUMN agent_id;
ALTER TABLE board_api_keys ALTER COLUMN user_id SET NOT NULL;
```
The harness falls back to user-scoped auth, OOP-2792's routine_execution fix
still covers the cron case.
