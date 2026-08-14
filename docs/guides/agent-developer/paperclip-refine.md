# Paperclip `/refine` — Continual Harness for agent instruction-sets (OOP-3490)

`/refine` lets a Paperclip agent propose evidence-backed changes to its own
(or another agent's) instruction-set bundle. Approvals are always explicit — a
board-authorized agent or a user must decide. Every state change captures an
append-only snapshot, so any approved change can be rolled back to a specific
prior snapshot by id.

This is Paperclip's port of Prime Agent's
[`Continual Harness /refine`](https://github.com/PrimeIntellect-ai/prime-agent).
Paperclip's governance (approvals + decision queues) is layered on top: agents
propose, humans decide.

## When to invoke `/refine`

Invoke `/refine` when you have:

- **A repeated failure or recurring confusion** in the agent's run history that
  would be prevented by a small, targeted change to the agent's instruction-set
  (entry file, supporting files).
- **A concrete lesson** from a run that other future runs of this agent should
  inherit — encoded as a one-file delta, not a sprawling prompt rewrite.
- **Workspace context** (X-1 / OOP-3448) available to cite as evidence: prior
  issue threads, recent decisions, run transcripts.

Do **not** invoke `/refine` for:

- Run-scoped facts ("use API endpoint X for this one request") — those belong in
  issue documents or run-time context, not the instruction-set.
- Cross-agent learnings — `/refine` is per-agent in v0.1 (see Non-goals below).
- Bulk rewrites — the delta should be focused; multi-file deltas are allowed
  but rare.

## Evidence rules

Every proposal must include at least one **evidence pointer**. Each pointer
must contain at least one of:

- `issueId` — a Paperclip issue identifier (`OOP-XXXX`) where the lesson is
  grounded. Strongest evidence when the issue is one the agent participated in.
- `runId` — a Paperclip run id whose transcript shows the failure or lesson.
- `citation` — a free-form textual citation (URL, doc reference, log excerpt)
  up to 2000 chars.

A pointer may also carry `snippet` (≤8000 chars) of supporting context.

Evidence with only `snippet` is **rejected** — snippets alone don't link the
refinement back to a verifiable Paperclip artifact. The check is enforced at
both the schema layer (`refineEvidencePointerSchema`) and the DB constraint
layer (`agent_refine_proposals_evidence_min_check`).

## The three-step flow

### 1. Propose

```js
paperclipProposeRefinement({
  agentId,
  proposedDelta: JSON.stringify({
    entryFile: "AGENTS.md",        // optional — defaults to current entry
    files: {
      "AGENTS.md": "# Updated guidance…",
    },
  }),
  evidence: [
    { issueId: "OOP-3490", snippet: "missing ack of run-id header" },
    { runId: "fe102be9-…", citation: "see run log §3" },
  ],
})
```

Returns `{ proposalId, snapshotId }`. The snapshot captures the agent's
**current** instruction-set bundle (entry file + all files in the bundle root)
as jsonb, versioned per-agent. No delta storage — full content per snapshot.

The proposal is created with `status: "pending"`.

### 2. Approve / Reject

A user or board-authorized agent decides. Approve:

```js
paperclipApproveRefinement({
  proposalId,
  decisionNote: "matches the workspace-evidence-backed guidance in OOP-3490",
})
```

On approval:

1. The proposed delta is materialized to the agent's managed bundle root.
2. The agent's `adapterConfig` is updated to point at the new entry file.
3. A new snapshot is appended (next version number).
4. Any other `pending` proposal for the same agent is set to `superseded`.
5. The current proposal is set to `approved`.

Reject:

```js
paperclipRejectRefinement({
  proposalId,
  decisionNote: "out of scope for v0.1; revisit in OOP-3XXX",
})
```

Rejection is terminal — a rejected proposal cannot be re-approved; the agent
must file a fresh proposal if the lesson still applies.

### 3. Rollback

If an approved refinement causes a regression, roll back to a specific prior
snapshot:

```js
paperclipRollbackRefinement({
  proposalId,
  targetSnapshotId: "00000000-0000-0000-0000-000000000000",
  decisionNote: "reverting per run fe102be9 regression report",
})
```

Rollback:

1. Looks up `targetSnapshotId`; rejects if it doesn't exist or belongs to a
   different agent.
2. Materializes that snapshot's content to the agent's bundle root.
3. Captures a **new** snapshot (mirroring the target) — never mutates an
   existing snapshot row.
4. Marks the proposal `rolled_back`.

The target snapshot is the source of truth — there is no implicit "previous"
rollback. If you want to roll back to a snapshot older than the most recent one,
pass that snapshot's id explicitly.

## Snapshot model

- Snapshots are **append-only**. The service exposes only `insertSnapshot`,
  `listSnapshots`, and `getSnapshot` — no update or delete helpers. Rollback
  creates a new snapshot rather than mutating an existing one.
- Versions are integers scoped per agent. The next version is `max(version)+1`
  for that agent at insertion time.
- Each snapshot stores `{ rootPath, entryFile, mode, files }` as jsonb — full
  content per snapshot, no diff storage (see Non-goals).
- Snapshots are durable history: even after a `rolled_back` proposal, the
  in-between snapshots remain queryable for audit.

## Status lifecycle

| Status         | Set by                                | Terminal? | Visible to future runs? |
| -------------- | ------------------------------------- | --------- | ----------------------- |
| `pending`      | `propose`                             | No        | No                      |
| `approved`     | `approve`                             | No        | Yes (snapshot applied)  |
| `rejected`     | `reject`                              | Yes       | No                      |
| `superseded`   | `approve` (on another pending → this) | Yes       | No                      |
| `rolled_back`  | `rollback`                            | No (new snapshot exists) | Yes (rollback snapshot) |

A rolled-back proposal is not "deleted" — its row remains queryable, and
subsequent `listRefineProposals({status: "rolled_back"})` returns it. The
snapshot model is the source of truth, not the proposal status.

## Non-goals (defer to later issues)

- **Auto-trigger** after every agent run — agents must invoke `/refine`
  explicitly in v0.1.
- **Auto-approval** — every approval requires a user or board-authorized agent
  decision.
- **Cross-agent learning** — each agent's instruction-set evolves
  independently. Shared refinement pools are out of scope.
- **Snapshot storage optimization** — v0.1 stores full content per snapshot.
  Diff storage / compression / `/compact-snapshots` come later if storage
  pressure shows it.
- **Refinement of `company_skills`** — separate table, separate flow.
- **Workspace-context pointers as first-class evidence** — possible later, but
  v0.1's evidence `jsonb` is already opaque enough to carry Workspace pointers
  via `citation` when X-1 (OOP-3448) lands.

## HTTP surface

For tooling that prefers REST over MCP, the same flow is exposed at:

| Method | Path                                                              |
| ------ | ----------------------------------------------------------------- |
| POST   | `/api/companies/:companyId/agents/:agentId/refine`                |
| GET    | `/api/companies/:companyId/agents/:agentId/refine-proposals`     |
| GET    | `/api/companies/:companyId/refine-proposals/:id`                  |
| POST   | `/api/companies/:companyId/refine-proposals/:id/approve`          |
| POST   | `/api/companies/:companyId/refine-proposals/:id/reject`           |
| POST   | `/api/companies/:companyId/refine-proposals/:id/rollback`         |

Approval decisions require either `decidedByUserId` or `decidedByAgentId` to
be present in the actor context — board-authorized calls only.

## See also

- `paperclip-mcp-tools.md` — full MCP tools catalog, including the 6 refine
  tools.
- OOP-3395 v2 doc §5b-P-1 — design rationale (immutable base, evidence-backed,
  rollback-safe).
- OOP-3431 (X-2 MCP server) — the MCP surface this lands on.
- OOP-3448 (X-1 Workspace) — composed but not coupled; `/refine` evidence can
  carry Workspace pointers via `citation`.
