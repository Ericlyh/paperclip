# ADR-0043: Role-Handoff Workflow Graph (Producer → Critic → Integrator)

**Status:** Accepted
**Date:** 2026-10-29
**Deciders:** Claude Code (host)
**Source:** OOP-3060 (Graph Engineering D)
**Spec:** `_default/notes/OOP-3060-role-handoff-workflow-graph.md`

---

## Context

Andrew Ng's step 4 of the agentic-design-pattern framework — the one this
issue set calls "Graph Engineering D" — is *"stop running one agent — run a
team — one codes, one reviews, one tests"*. OOP-2272 §Proposal D proposed
making the MiniMax role team (`{Coder, Verifier, Orchestrator}`) a first-class,
inspectable, reusable workflow graph, so that the handoff stops being
re-improvised per issue.

Two things had to be established before that could be specified:

1. **What the role team actually is.** The names in the 2026-07-24 study are
   stale. A single patch on **2026-08-24** renamed the whole team *and* its
   persona bindings in the same breath: `MiniMax Code Coder` → `MiniMax Code
   Worker` (`mmcAgent: coder` → `worker`), `MiniMax Code Verifier` →
   `MiniMax Code Explorer` (`verifier` → `explore`), and `[deprecated] MiniMax
   Code General` / `[deprecated] MiniMax Code Orchestrator` → terminated.
   Nothing in the platform held the *shape* of the team through that rename,
   which is why the handoff had to be re-improvised.

2. **Whether the platform already has a first-class workflow graph.** It does —
   in four layers, none of which had been written down together.

| Layer | Mechanism | Granularity |
|---|---|---|
| Role semantics | MiniMax persona contracts (`~/.minimax/agents/.builtin/*/agent.md`) | per-agent |
| **First-class workflow graph** | **`pipelines` / `pipeline_stages` / `pipeline_transitions`** | multi-issue |
| Single-issue variant | `issues.execution_policy.stages` | one issue |
| Portable fallback | issue DAG (`parent_id` + `blocks`) + wake-on-edge (ADR-0042) | any |

The pipeline subsystem already carries the role-handoff shape natively:
`pipeline_stages.kind` is `working | review | done | cancelled`; a stage's
`config.approver` accepts `{kind: "agent"}`; a stage's `config.automation`
creates the next agent's issue on entry; and `approveToStageKey` /
`rejectToStageKey` / `requestChangesToStageKey` route the verdict.

Meanwhile the *role* side was half-wired. The `verifier` persona — which
carries the single most valuable contract in the exercise, an enforceable
`ROLE_MISMATCH` gate that stops a critic from silently becoming a second
coder, plus a `VERDICT: PASS | FAIL | PARTIAL` vocabulary — was **not bound
to any live Paperclip agent**. The producer slot (`worker`) and the integrator
slot (`mavis`) were.

---

## Decision

Adopt the **Role-Handoff Graph (RHG)** as the canonical form for step-4
multi-agent work, and express it as a **pipeline stage template** over the
existing pipeline subsystem. Do not introduce a new graph type, a new
relation type, or a new orchestration layer.

### The Contract

A role-handoff graph is a named pipeline whose stages map onto three role
slots:

| Slot | Stage kind | Binding |
|---|---|---|
| **producer** — "one codes" | `working` | `config.automation.assigneeAgentId` (or `onEnter.run_routine`) |
| **critic** — "one reviews" | `review` | `config.requireApproval: true` + `config.approver: {kind: "agent", id}` |
| **integrator** — "one decides" | `working` | `config.automation.assigneeAgentId`, emitting a cycle-decision record |

The critic stage MUST route all three verdicts:

| Verdict | Pipeline decision | Config requirement |
|---|---|---|
| `PASS` | `approve` | `approveToStageKey` → next stage |
| `FAIL` | `reject` | `rejectToStageKey` + `requireRejectReason: true` |
| `PARTIAL` | `request_changes` | `requestChangesToStageKey` → producer + `requireRequestChangesReason: true` |

**Binding rules (a graph violating them is invalid, not blocked):**

- **B1** — every role slot names a persona that exists on disk under
  `~/.minimax/agents/<persona>/`.
- **B2** — a slot naming a Paperclip agent MUST have that agent's
  `adapter_config.mmcAgent` equal to the persona. Otherwise the binding is
  decorative: the agent silently runs `general`.
- **B3** — the critic stage MUST use `requireApproval` with
  `approver.kind: "agent"` and `requireRejectReason: true`.
- **B4** — every producer stage MUST declare an objective gate (a named
  command/test), mirroring the OOP-620 objective-gate condition.
- **B5** — every run MUST have exactly one integrator stage, and it MUST emit
  a cycle-decision record before the run closes.
- **B6** — a run MUST NOT exceed its round bound
  (`execution_policy.maxReviewRounds`, or the stage's reject-edge budget). On
  breach it escalates to a named human owner.
- **B7** — role identity is carried by `title` / `capabilities` / `metadata` /
  instructions, **not** by `agents.role`, whose API enum is the fixed 12-value
  list `ceo, cto, cmo, cfo, security, engineer, designer, pm, qa, devops,
  researcher, general` (`packages/shared/src/constants.ts:47-61`). There is no
  `coder` / `verifier` / `orchestrator` role value.

**Retry discipline.** A FAIL verdict routes back to the producer stage via
`requestChangesToStageKey` / `rejectToStageKey`; the integrator creates the
retry as a **new** work item rather than re-opening the artefact in place.
Combined with B6, this is the "no Ralph Wiggum" bound the loop-engineering
lineage (OOP-619 / OOP-1207) requires.

**Scope selection.** Use a pipeline (Layer 2) for reusable multi-issue runs;
use `execution_policy.stages` (Layer 3) for a one-off issue needing a
mid-flight reviewer; use the issue DAG + `blocks` (Layer 4, ADR-0042) when
pipeline machinery is unwanted. The pipeline is the durable, reusable
artifact — the issue DAG is re-created per run, which is exactly the
re-improvisation this ADR exists to stop.

---

## Consequences

### Positive

- The role-handoff graph stops being re-improvised per issue: three canonical
  templates (T1 change+critique, T2 change+critique+integrator, T3
  research+critique+gate) are specified in the spec doc and belong in a
  company skill.
- The graph is **inspectable** for free: `pipelines`, `pipeline_stages`,
  `pipeline_transitions` and the append-only `pipeline_case_events` log are
  first-class tables with a CLI, and `packages/shared/src/pipeline-health.ts`
  already warns on `review_no_approver` / `stage_no_automation` /
  `automation_no_agent`.
- The "one reviews" contract becomes **server-enforced** rather than advisory:
  a critic that returns FAIL cannot advance the work and cannot do so without
  writing down why.
- Role identity is anchored to something that actually selects behaviour
  (`adapter_config.mmcAgent`) instead of to a display name, which is what
  broke during the 2026-08-24 rename.
- No new infra, no migration. `issue_relations.type` keeps its CHECK
  constraint of `= 'blocks'`; the graph rides on pipeline stages.

### Negative

- The pipeline subsystem is **largely unused on this board**: `execution_policy`
  is non-null on 1 issue out of 6 304. Adopting pipelines means adopting a
  subsystem that has not been exercised much here, and its live tutorial is
  stale (`"kind": "open"`, pre-migration `0120`), so it will mislead the first
  few users.
- `autonomy: "auto"` is currently rejected at runtime (`autonomy_not_enabled`);
  only `manual` and `suggest` are live. Automatic stage advance therefore has
  to go through `autoAdvanceOnChildrenTerminal`, which is a narrower
  mechanism than it looks.
- The integrator slot has no server-side enforcement: B5 is a discipline, not
  a constraint. Nothing stops a run closing without a decision record.

### Neutral

- No routine is created by this ADR. A graph-driven wake loop would be a
  routine and must pass the OOP-620 four-condition gate.
- The MiniMax role personas are unchanged — they are the input, not the
  output.
- The fleet knowledge graph (OOP-3057) is not the source of truth for this
  graph. A role-node / handoff-edge extension there is an *inspection* layer
  and needs no DDL, but it needs a `sync_roles` step in `fleet-graph-sync.py`
  or the next full re-sync wipes it.

---

## Implementation Notes

### The critic slot is the one thing that is not wired

`verifier` is unbound. `MiniMax Code Explorer` is bound to `explore` — a
different capability (read-only mapper) that Explorer already runs in
production. **Recommendation: create a dedicated agent bound to `verifier`**
rather than re-pointing Explorer.

### Two independent breaks in the `mavis_local` execution path

1. `MAVIS_AUTH_ENDPOINT` defaults to `http://127.0.0.1:15321` and **nothing is
   listening**. The `com.molt.mavis-auth` launchd job is loaded but not
   running: its `KeepAlive` dict is `{SuccessfulExit: false, Crashed: true}`,
   so the clean SIGTERM visible in its log does **not** restart it.
2. `adapter_config.mmcBin` points at
   `/Users/molt/.paperclip/adapter-plugins/mavis-wrapper.sh`, which **does not
   exist**. The current adapter never reads `mmcBin`, so this is dead config
   rather than a live break — but it misrepresents the executable path.

### The `mavis-team` plan YAML is a specification, not a launcher

`~/.minimax/agents/mavis/.builtin-skills/mavis-team/SKILL.md` defines an
excellent declarative team-plan schema (`tasks`, `depends_on`, `verified_by`,
`verify_skip_reason`, `gates`, and a cycle-decision JSON record). Its launch
recipes require a `mavis` CLI, which does not exist on this host — MiniMax
Code 3.0.68 dropped the standalone binary. Use it as the vocabulary; use
pipelines as the runtime.

### Inspecting the role graph

Once the fleet-graph extension exists, role nodes carry `kind = 'role'`,
`nodes.title` = persona name, `nodes.assignee_agent_id` = the bound agent, and
`nodes.status` = the agent's status — so an unbound or dead role is visible in
the graph rather than implied. `nodes.kind` and `edges.edge_type` are both
unconstrained TEXT, so **no DDL change is required**. Beware:
`fleet-graph-schema.sql` uses `CREATE TABLE IF NOT EXISTS`, which SQLite
ignores for an existing table — new *columns* would silently not apply.

---

## References

- OOP-3060 (Graph Engineering D): `_default/notes/OOP-3060-role-handoff-workflow-graph.md`
- OOP-2272 (Graph Engineering, parent): `_default/notes/OOP-2272-graph-engineering-study.md`
- OOP-3059 (Graph Eng C): `_default/notes/OOP-3059-graph-eng-c-scope.md`
- OOP-3058 (Graph Eng B): ADR-0042, `_default/notes/OOP-3058-wake-on-edge-satisfied-spec.md`
- OOP-3057 (Graph Eng A): fleet knowledge graph — `/Users/molt/.paperclip/bin/fleet-graph-*`
- OOP-620 (routine approval gate) — `agent-instructions/routine-template.md`
- `packages/db/src/schema/pipelines.ts` — `pipeline_stages.kind` CHECK (`:46`)
- `server/src/services/pipelines.ts` — `PipelineStageConfig` (`:107`),
  `assertActorCanApproveStageExit` (`:1062`), `executeAutomationLedger`
  (`:2921`), `reviewCase` (`:4891`)
- `packages/shared/src/constants.ts` — `AGENT_ROLES` (`:47`)
- `server/src/services/issue-execution-policy.ts` — `applyIssueExecutionStageTransition` (`:662`)
- `server/src/routes/issues.ts` — `assertInReviewReviewPath` (`:3510`)
- `docs/pipelines-tutorial.md` — worked example (⚠️ pre-`0120` `kind: open`)
- `~/.minimax/agents/.builtin/{verifier,worker,explore}/agent.md` — role contracts
- `~/.minimax/agents/mavis/.builtin-skills/mavis-team/SKILL.md` — plan schema
