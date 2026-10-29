---
name: paperclip-role-handoff
description: >
  Deploy and run the role-handoff workflow graph (producer -> critic ->
  integrator) on Paperclip pipelines. Use when work needs one agent to produce a
  bounded change, an independent critic to review it without touching the
  deliverable, and an integrator to decide retry or accept. Provides the three
  canonical templates (T1 change+critique, T2 change+critique+integrator, T3
  research+critique+gate), the binding rules that make a role slot real rather
  than decorative, and the PASS/FAIL/PARTIAL verdict contract.
---

# Paperclip Role-Handoff Skill

A role-handoff graph is a **named pipeline** whose stages map onto three role
slots. Use it instead of re-improvising a producer/reviewer handoff per issue.

Copy a template. Do not re-invent one.

| Slot | Ng's phrase | Stage kind | Bound persona | Live binding rule |
|---|---|---|---|---|
| **producer** | "one codes" | `working` | `worker` | `config.automation.assigneeAgentId` |
| **critic** | "one reviews" | `review` | `verifier` | `config.approver = {kind: "agent", id}` |
| **integrator** | "one decides" | `working` | `mavis` | `config.automation.assigneeAgentId` |

A fourth optional slot, **gate** ("one tests"), is a final `working` stage whose
deliverable *is* the PASS/FAIL verdict — an E2E report, smoke check, audit
verdict, or integration gate result.

## The verdict contract

The persona vocabulary and the pipeline vocabulary are the same three
decisions. Use the server's, because `requireRejectReason` and
`requireRequestChangesReason` are enforced.

| Persona verdict | Pipeline decision | Enforced by | Effect |
|---|---|---|---|
| `PASS` | `approve` | `approveToStageKey` | advance to the next stage |
| `FAIL` | `reject` | `requireRejectReason: true` | route to `rejectToStageKey`; a reason is **mandatory** |
| `PARTIAL` | `request_changes` | `requireRequestChangesReason: true` | route to `requestChangesToStageKey` (back to the producer); a reason is **mandatory** |

That is the whole "one reviews" contract in server-enforced terms: a critic that
says FAIL cannot advance the work, and cannot do so without writing down why.

## Binding rules

A graph that violates these is **invalid**, not blocked. Check them before you
call a role-handoff pipeline deployed.

- **B1** — every role slot names a persona that exists on disk under
  `~/.minimax/agents/<persona>/` (built-ins live in
  `~/.minimax/agents/.builtin/<persona>/`). An unknown persona is a spec error.
- **B2** — a slot naming a Paperclip agent MUST have that agent's
  `adapter_config.mmcAgent` equal to the persona. Otherwise the binding is
  decorative: the agent silently runs `general`.
- **B3** — the critic stage MUST use `requireApproval: true` with
  `approver.kind: "agent"` and `requireRejectReason: true`.
- **B4** — every producer stage MUST declare an objective gate: a named
  command or test, in `automation.instructionsBody`. (Mirrors the OOP-620
  objective-gate condition.)
- **B5** — every run MUST have exactly one integrator stage, and it MUST emit a
  cycle-decision record before the run closes.
- **B6** — a run MUST NOT exceed its round bound. On breach it escalates to a
  named human owner.
- **B7** — role identity is carried by `title` / `capabilities` / `metadata` /
  instructions, **not** by `agents.role`. The API enum is the fixed 12-value
  list `ceo, cto, cmo, cfo, security, engineer, designer, pm, qa, devops,
  researcher, general` — there is no `coder` / `verifier` / `orchestrator`
  value. If you want the enum to carry meaning the legal mapping is producer ->
  `engineer`, critic -> `qa`, integrator -> `pm`.

**Retry discipline.** A FAIL verdict routes back to the producer stage. The
integrator creates the retry as a **new** work item, never by re-opening the
producer's artefact in place. Combined with B6, this is the "no Ralph Wiggum"
bound.

## The three canonical templates

Full stage JSON, producer/verdict prompt bodies, and the portable (issue-DAG)
form are in `references/templates.md`.

- **T1 — change + critique** (2 role slots). `build` (`working`) -> `review`
  (`review`) -> `done`, with `rejectToStageKey` and `requestChangesToStageKey`
  back to `build`. The minimum useful graph.
- **T2 — change + critique + integrator** (3 role slots). T1 plus a `decide`
  stage (`working`) between `review` and `done`, whose automation assigns the
  integrator and whose instructions require the cycle-decision JSON.
- **T3 — research + critique + gate** (evidence path). `explore` (`working`,
  read-only) -> `review` (`review`) -> `gate` (`working`, the E2E/audit check)
  -> `done`.

## Deploying a template

Two live stage kinds only: `working`, `review`, `done`, `cancelled`. The DB
CHECK constraint on `pipeline_stages.kind` is exactly
`('working','review','done','cancelled')`. Use `working` for intake stages.

**Step 1 — create the pipeline with the stages file.**

```sh
paperclipai pipelines create -C "$COMPANY_ID" \
  --key t1-change-critique \
  --name "T1 Change + Critique" \
  --stages-file t1-stages.json
```

**Step 2 — bind the producer stage's automation.** This is the step that is
easy to get wrong:

> `config.automation` passed to `pipelines create` is **silently dropped**. The
> server strips `automation` out of the stage config before it persists, because
> the automation is materialised as a real routine. To bind a producer you must
> PATCH the stage afterwards with `config.automation`; the server then creates
> (or updates) the routine and writes `onEnter.run_routine.routineId` into the
> stage config.

```sh
paperclipai pipelines set-automation -C "$COMPANY_ID" <pipeline-key> \
  --stage build --routine <routine-id>
```

or, to let the server create the routine for you:

```sh
curl -sS -X PATCH "$PAPERCLIP_API_URL/api/pipelines/<pipeline-id>/stages/<stage-id>" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-paperclip-run-id: $PAPERCLIP_RUN_ID" \
  -d '{"config": {"automation": {
        "assigneeAgentId": "<producer-agent-uuid>",
        "titleTemplate": "<work item title>",
        "instructionsBody": "<self-contained producer spec; expected files; stop condition; the objective gate command>"}}}'
```

The `instructionsBody` must be self-contained: it becomes the routine
description, and it is the only place the producer learns what to build, what
the gate command is, and when to stop. Put the objective gate command in it
(B4).

**Step 3 — set transitions** if you want the graph enforced.

```sh
paperclipai pipelines set-transitions -C "$COMPANY_ID" <pipeline-key> --file transitions.json
```

## Running a role-handoff graph

1. Ingest a case: `POST /api/pipelines/{id}/cases` (or `paperclipai pipelines
   ingest`). The case lands in its initial stage.
2. Entering a `working` stage with automation creates a **real issue** assigned
   to `automation.assigneeAgentId`, with a pipeline context pack.
3. The producer's issue reaches a terminal state; the case advances.
4. The case reaches the `review` stage. Only the agent named in
   `approver.id` may decide the verdict — `assertActorCanApproveStageExit`
   rejects everyone else with `403 review_required`.
5. The critic's decision routes the case: approve -> next stage, reject ->
   `rejectToStageKey`, request_changes -> `requestChangesToStageKey`.

## Live caveats

- **`autonomy: "auto"` is rejected at runtime** (`autonomy_not_enabled`). Only
  `manual` and `suggest` are live. Automatic stage advance goes through
  `autoAdvanceOnChildrenTerminal` instead.
- **The critic must be able to say no.** If the review stage's approver is
  `any_human` or a `user`, the "one reviews" contract is advisory, not
  enforced.
- **Nothing stops a run closing without a decision record.** B5 is a
  discipline, not a constraint — the integrator stage's own instructions have to
  require the cycle-decision JSON.
- **`approver.id` is required at stage-create time** and must be the critic
  agent's uuid. A stage cannot be created with a dangling approver id, so
  create the critic agent before you create the review stage.

## The portable form (no pipeline machinery)

For work that must not depend on pipelines: one issue per node,
`parent_id` = the run root, `blocks` edges for `depends_on`, and the verdict in
the critic issue's final comment as `VERDICT: PASS | FAIL | PARTIAL`. If the
verdict is FAIL the critic issue does not reach `done`, the integrator is never
woken, and no retry happens without explicit integrator action.

The pipeline is the durable, reusable artifact. The issue DAG is re-created per
run — which is exactly the re-improvisation this skill exists to stop.

## Verifying a deployed graph

```sh
# the graph itself
curl -sS "$PAPERCLIP_API_URL/api/pipelines/<pipeline-id>" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"

# health warnings (review_no_approver, stage_no_automation, automation_no_agent)
curl -sS "$PAPERCLIP_API_URL/api/pipelines/<pipeline-id>/health" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"

# the persona bindings behind each slot (B2)
docker exec paperclip-db psql -U paperclip -d paperclip \
  -c "SELECT name, adapter_config->>'mmcAgent' AS persona FROM agents;"
```

## References

- `references/templates.md` — T1/T2/T3 stage JSON, prompt bodies, portable form
- `references/role-contracts.md` — the persona contracts and the cycle-decision schema
- `paperclip-src/docs/adr/0043-role-handoff-workflow-graph.md` — the decision record
- `paperclip-src/docs/pipelines-tutorial.md` — the pipeline subsystem walkthrough
