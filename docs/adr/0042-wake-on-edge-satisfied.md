# ADR-0042: Wake-on-Edge-Satisfied for Issue Dependency Edges

**Status:** Accepted
**Date:** 2026-08-06
**Deciders:** MiniMax Code Orchestrator, Claude Code (host)
**Source:** OOP-3058 (Graph Engineering B)
**Spec:** `_default/notes/OOP-3058-wake-on-edge-satisfied-spec.md`

---

## Context

The issue dependency graph (`issueRelations.type = "blocks"`) is the primary
orchestration DAG for paperclip. When a blocker issue `B` completes, the
system must wake the owner of every dependent issue `D` that was blocked by `B`.

The system already had this capability wired (PATCH `/issues/:id` `becameDone`
hook + workspace-finalize hook). This ADR formalises the contract so it is
auditable, nameable, and not regressed by future refactors.

---

## Decision

Implement **wake-on-edge-satisfied (WOE)** as a named first-class property of
the `blocks` edge.

### The Contract

A `blocks` edge from issue `B` (blocker) to issue `D` (dependent) is a promise:

> When `B` reaches terminal-success (`status = "done"`), `D`'s owner is woken
> iff `D`'s readiness map evaluates to `isDependencyReady = true`.

**Readiness gates (both must pass):**

| Gate | Condition |
|------|-----------|
| (a) Done blockers | Every blocker of `D` has `status = "done"` |
| (b) Workspace-finalize barrier | Every done blocker's `executionWorkspaceId` has a recorded successful `workspace_finalize` row (OOP-2793 sync-back barrier) |

**Trigger points:**
- `server/src/routes/issues.ts` — `becameDone` hook (PATCH `/issues/:id`).
- `server/src/services/heartbeat.ts` — workspace-finalize hook. If (b) was
  incomplete at the first attempt and finalizes later, `listWakeableBlockedDependents`
  is re-evaluated and the wake fires on the finalize callback.

**Cancellation rule.** A blocker reaching `status = "cancelled"` does **not**
satisfy the contract. The dependent stays `blocked`; an operator must remove
or replace the `blocks` relation explicitly. The wake-on-edge contract is
silent on cancellation.

**Monitor fallback.** Issues with no incoming `blocks` edges fall back to
`monitorNextCheckAt` cron polling. An edge-wake should push
`monitorNextCheckAt` forward to prevent a duplicate wake within the same
monitor poll window (see § Implementation Notes).

---

## Consequences

### Positive
- The wake-on-edge path is now formally named and auditable from one ADR.
- Future contributors can read the JSDoc on `listWakeableBlockedDependents`
  and know it IS the wake-on-edge path — no risk of duplication.
- The cancellation rule is explicit; operators know they must manage the
  relation, not just the issue status.

### Negative
- One new invariant: `monitor*` fields must be suppressed after an edge-wake
  fires to avoid a double-wake in the same monitor poll window.

### Neutral
- No new cron loop added. If a future "wake-on-edge digest" routine is filed,
  it must pass the OOP-620 routine gate (routine-template.md § Tier 1 + Tier 2).

---

## Implementation Notes

### monitor* alignment shim (G2 from OOP-3058)

When an edge-wake fires, the dependent's `monitorNextCheckAt` should be pushed
forward by `max(previous schedule, now + 60s)` and `monitorLastTriggeredAt`
should be bumped to `now`. This prevents the monitor heartbeat loop from firing
a duplicate wake within the same poll window.

Hook locations:
- `server/src/routes/issues.ts` — inside the `becameDone` block, after
  `listWakeableBlockedDependents` returns and before `addWakeup` is called.
- `server/src/services/heartbeat.ts` — inside the finalize-path block after
  `listWakeableBlockedDependents` returns.

### blockerAttention invariant (G3 from OOP-3058)

A wake-eligible dependent (all blockers done, all finalize barriers cleared)
must show `blockerAttention.state !== "uncovered"` in `listIssueBlockerAttentionMap`.
The contract test (`issue-wake-on-edge-satisfied-contract.test.ts`) asserts
this invariant.

---

## References

- OOP-3058 (Graph Engineering B): `_default/notes/OOP-3058-wake-on-edge-satisfied-spec.md`
- OOP-2793 (workspace-finalize sync-back barrier)
- OOP-620 (routine gate / Tier 1)
- OOP-621 (Tier 2 / MVL)
- `server/src/services/issues.ts` — `listWakeableBlockedDependents` (line 4253+)
- `server/src/services/issues.ts` — `listIssueDependencyReadinessMap` (line 653+)
- `server/src/routes/issues.ts` — `becameDone` hook (line ~4963)
- `server/src/services/heartbeat.ts` — finalize-path wake re-fire (line ~8519)
- `server/src/__tests__/heartbeat-dependency-scheduling.test.ts` (existing coverage)
