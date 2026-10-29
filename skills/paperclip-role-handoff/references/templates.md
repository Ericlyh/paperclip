# Canonical role-handoff templates

Three templates. Copy one, fill in the `<...>` slots, deploy it. Do not
re-invent a fourth.

Stage kinds are `working | review | done | cancelled` only. The DB CHECK
constraint on `pipeline_stages.kind` is exactly
`('working','review','done','cancelled')`. The server silently coerces a
legacy `"open"` to `"working"`, but write `working` — the coercion is a
migration shim, not a live kind.

---

## T1 — Single change with critique

The minimum useful graph: two role slots, one handoff.

```json
[
  { "key": "build", "name": "Build", "kind": "working", "position": 100,
    "config": { "automation": { "assigneeAgentId": "<producer-agent-id>",
                                "titleTemplate": "<work item title>",
                                "instructionsBody": "<self-contained producer spec; expected files; stop condition; the objective gate command>" } } },
  { "key": "review", "name": "Review", "kind": "review", "position": 200,
    "config": { "requireApproval": true,
                "approver": { "kind": "agent", "id": "<critic-agent-id>" },
                "approveToStageKey": "done",
                "rejectToStageKey": "build",
                "requestChangesToStageKey": "build",
                "requireRejectReason": true,
                "requireRequestChangesReason": true } },
  { "key": "done", "name": "Done", "kind": "done", "position": 900 },
  { "key": "cancelled", "name": "Cancelled", "kind": "cancelled", "position": 1000 }
]
```

**Deployment note.** The `automation` block on `build` is dropped if you pass
this file to `pipelines create`. Create the pipeline with the stages, then
PATCH the `build` stage with `config.automation` (or call
`pipelines set-automation --stage build --routine <id>`) so the server
materialises the routine.

**Producer `instructionsBody`** must be self-contained. It becomes the
routine description and is the producer's entire brief. Include:

- the concrete change to make, with the files to touch
- the objective gate command — the named check that proves it works (B4)
- the stop condition — when to stop and report rather than keep going
- the report shape the persona already uses (result, files changed, validation
  observed, assumptions, blockers)

**Critic instructions** — carry the persona contract verbatim:

> Inspect the deliverable and the acceptance criteria. If success requires
> modifying the deliverable or any project file, stop immediately and return
> `ROLE_MISMATCH`. Recommend either reassigning the task to `worker`, or
> removing the mutation requirement and returning findings only in
> `final_text`. Do not fix, rewrite, or improve the deliverable being judged.
> Inspect the actual artefact and run the most relevant available checks.
> Return: checks performed; evidence and observed results; findings ordered by
> severity; `VERDICT: PASS | FAIL | PARTIAL`. Use PARTIAL only when a
> concrete environment, access, or tooling boundary prevents a required check.

**Why `reject` and `request_changes` both point back to `build`.** `FAIL`
means the deliverable is wrong; `PARTIAL` means it could not be fully
checked. Both send the case back to the producer, but the reason strings
differ in kind, and the critic is forced to write one either way.

---

## T2 — Change -> critique -> integrator

T1 plus a decision stage. Three role slots; the integrator is the one that
decides, so a run cannot close without a recorded decision.

```json
[
  { "key": "build", "name": "Build", "kind": "working", "position": 100,
    "config": { "automation": { "assigneeAgentId": "<producer-agent-id>",
                                "titleTemplate": "<work item title>",
                                "instructionsBody": "<producer spec + objective gate>" } } },
  { "key": "review", "name": "Review", "kind": "review", "position": 200,
    "config": { "requireApproval": true,
                "approver": { "kind": "agent", "id": "<critic-agent-id>" },
                "approveToStageKey": "decide",
                "rejectToStageKey": "build",
                "requestChangesToStageKey": "build",
                "requireRejectReason": true,
                "requireRequestChangesReason": true } },
  { "key": "decide", "name": "Decide", "kind": "working", "position": 300,
    "config": { "automation": { "assigneeAgentId": "<integrator-agent-id>",
                                "titleTemplate": "Decide: <work item title>",
                                "instructionsBody": "<cycle-decision instructions>" } } },
  { "key": "done", "name": "Done", "kind": "done", "position": 900 },
  { "key": "cancelled", "name": "Cancelled", "kind": "cancelled", "position": 1000 }
]
```

**The `decide` stage's `instructionsBody`** must require the cycle-decision
record (B5):

```json
{
  "last_cycle": [
    { "task_id": "<issue-id>", "verdict": "manual_retry", "reason": "..." }
  ],
  "next_cycle": [],
  "plan_complete": false,
  "message_to_user": "..."
}
```

Verdicts the integrator may use: `accept` (deliverable is good), `reject`
(verifier is right; retry the same task), `manual_retry` (retry with your
correction), `override_accept` (verifier is wrong or the risk is acceptable).

**The integrator creates the retry as a NEW work item.** It never re-opens the
producer's artefact in place. That is how an unbounded loop is avoided, and it
is what pairs with B6.

---

## T3 — Research -> critique -> gate

The evidence path. The gate stage's deliverable *is* the PASS/FAIL verdict.

| Stage | kind | automation assignee | notes |
|---|---|---|---|
| `explore` | `working` | producer running the `explore` persona | read-only; `ROLE_MISMATCH` if a file must be written |
| `review` | `review` | approver = critic | `requestChangesToStageKey: explore` |
| `gate` | `working` | gate agent | the E2E / integration / audit check |
| `done` | `done` | — | — |

```json
[
  { "key": "explore", "name": "Explore", "kind": "working", "position": 100,
    "config": { "automation": { "assigneeAgentId": "<explore-agent-id>",
                                "titleTemplate": "Research: <work item title>",
                                "instructionsBody": "<read-only research brief>" } } },
  { "key": "review", "name": "Review", "kind": "review", "position": 200,
    "config": { "requireApproval": true,
                "approver": { "kind": "agent", "id": "<critic-agent-id>" },
                "approveToStageKey": "gate",
                "rejectToStageKey": "explore",
                "requestChangesToStageKey": "explore",
                "requireRejectReason": true,
                "requireRequestChangesReason": true } },
  { "key": "gate", "name": "Gate", "kind": "working", "position": 300,
    "config": { "automation": { "assigneeAgentId": "<gate-agent-id>",
                                "titleTemplate": "Gate: <work item title>",
                                "instructionsBody": "<the E2E/audit check; the deliverable is the verdict>" } } },
  { "key": "done", "name": "Done", "kind": "done", "position": 900 },
  { "key": "cancelled", "name": "Cancelled", "kind": "cancelled", "position": 1000 }
]
```

The `explore` persona carries the same deliverable gate as `verifier`: if the
research task turns out to require writing a file, it stops with
`ROLE_MISMATCH` rather than doing it.

---

## Portable form (Layer 4)

For work that must not depend on pipeline machinery: one issue per node,
`parent_id` = the run root, `blocks` edges for `depends_on`, and the verdict in
the critic issue's final comment as `VERDICT: PASS | FAIL | PARTIAL`.

```
        [root run issue]
        /        |        \
  producer   critic  integrator
      |---- blocks ----|
```

- producer issue reaches `done` -> wakes the critic's owner
- critic issue reaches `done` (verdict approve) -> wakes the integrator's owner
- verdict FAIL -> the critic issue does not reach `done`, the integrator is
  never woken, and no retry happens without explicit integrator action

That last property is the "no Ralph Wiggum" guarantee, obtained free from the
existing edge semantics. It is less capable than a pipeline (no enforced
verdict vocabulary, no agent approver, no stage config) but it works on any
issue with no new schema.

---

## Choosing a layer

| Situation | Use |
|---|---|
| Multi-issue run with enforced role gates; reused across issues | **Pipeline** (T1/T2/T3) |
| One issue that needs a reviewer mid-flight | `execution_policy.stages` |
| No pipeline or config machinery wanted; keep it simple | Issue DAG + `blocks` |

The pipeline is the durable, reusable artifact. The issue DAG is re-created per
run.
