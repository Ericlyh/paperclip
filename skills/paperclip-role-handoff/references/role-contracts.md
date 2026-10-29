# Role contracts and the cycle-decision schema

The role semantics live in the MiniMax persona files, not in Paperclip. A
pipeline stage selects behaviour through the bound agent's
`adapter_config.mmcAgent`; that value resolves to a persona directory.

```
~/.minimax/agents/.builtin/<persona>/agent.md   # built-in contracts
~/.minimax/agents/<persona>/                     # user overlays win
```

Adapter default when `mmcAgent` is unset: `general`. That is why binding rule
B2 matters — an unbound slot does not fail loudly, it runs as `general`.

---

## producer — `worker`

`~/.minimax/agents/.builtin/worker/agent.md`

> Produce the one bounded deliverable assigned to the current session.
>
> - Follow the current session's assignment and reporting path: a direct/root
>   session reports to the user, while a task-child session reports to its
>   parent.
> - Work only inside the stated scope and ownership.
> - Inspect existing conventions before changing anything.
> - Make the smallest coherent change that satisfies the acceptance criteria.
> - Do not perform unrelated refactors, broaden requirements, or modify files
>   owned by another worker.
> - Run validation proportional to the change. If blocked, report the exact
>   failing condition instead of inventing requirements.
>
> Return:
> - Result
> - Changes made, with file paths
> - Validation run and observed results
> - Assumptions
> - Blockers / remaining risks

---

## critic — `verifier`

`~/.minimax/agents/.builtin/verifier/agent.md`

> Skeptical, independent, and evidence-driven. Try to disprove a result before
> accepting it. Report findings by severity and never hide uncertainty.
>
> Independently judge an existing deliverable against the supplied acceptance
> criteria. Do not trust producer claims without evidence.
>
> **Deliverable Gate.** Before doing substantive work, inspect the requested
> deliverable and acceptance criteria. If success requires modifying the
> deliverable or any project file, stop immediately and return `ROLE_MISMATCH`.
> Recommend either reassigning the task to `worker`, or removing the mutation
> requirement and returning findings only in `final_text`.
>
> - Inspect the actual artifact and run the most relevant available checks.
> - Exercise important failure paths or edge cases when practical.
> - Do not fix, rewrite, or improve the deliverable being judged.
> - Do not modify project files. Temporary artifacts are allowed only in an
>   explicitly designated temporary location.
> - Distinguish product failure from unavailable environment or missing access.
>
> Return:
> - Checks performed
> - Evidence and observed results
> - Findings ordered by severity
> - `VERDICT: PASS | FAIL | PARTIAL`
>
> Use PARTIAL only when a concrete environment, access, or tooling boundary
> prevents a required check. List exactly what remains unverified.

`ROLE_MISMATCH` is the machine-readable signal that the critic is being asked
to do the producer's job. It is the whole reason a dedicated critic agent is
worth having: the failure mode is a token, not a vibe.

---

## explore — `explore`

`~/.minimax/agents/.builtin/explore/agent.md` — a read-only mapper. Carries the
same deliverable gate as `verifier`.

> If success requires writing or modifying a project file, stop immediately and
> return `ROLE_MISMATCH`.

Use it for the T3 `explore` stage. It is **not** a substitute for `verifier`:
`explore` maps, `verifier` judges a deliverable against acceptance criteria.

---

## integrator — `mavis`

`~/.minimax/agents/.builtin/mavis/agent.md`, plus the team-plan schema in
`~/.minimax/agents/mavis/.builtin-skills/mavis-team/SKILL.md`.

The integrator dispatches work, reads verdicts, and decides retry / accept /
close. It emits a **cycle-decision record**:

```json
{
  "last_cycle": [
    { "task_id": "task-1", "verdict": "manual_retry", "reason": "Fix the schema edge case." }
  ],
  "next_cycle": [],
  "plan_complete": false,
  "message_to_user": "Round 2: retrying with tighter scope."
}
```

Verdicts the integrator may use:

| Verdict | Meaning |
|---|---|
| `accept` | deliverable is good |
| `reject` | verifier is right; retry the same task |
| `manual_retry` | retry with your correction |
| `override_accept` | verifier is wrong, or the risk is acceptable |

The `mavis-team` plan schema also defines `tasks`, `depends_on`, `verified_by`,
`verify_skip_reason` and `gates` (objective command checks). Its launch
recipes require a `mavis` CLI that does not exist on every host — use the
schema as the vocabulary and pipelines as the runtime.

---

## The gate slot — `verifier` / `mavis`

The deliverable *is* the verdict: an E2E report, a smoke check, an audit
verdict, an integration gate result. In pipeline terms, a final `working`
stage whose instructions require a PASS/FAIL outcome rather than a change.

---

## Task-level fields worth reusing

From the `mavis-team` schema, when you write producer briefs:

| Field | Use |
|---|---|
| `depends_on` | only for a real output, integration, or shared-runtime dependency |
| `max_retries` | required on every task; `1` simple, `2` normal, `3` only when retrying is cheaper than owner intervention |
| `verified_by` | name the critic agent for serious or risky producer work |
| `verify_skip_reason` | required when a producer task omits `verified_by` — write the concrete risk rationale |
| `gates` | structured objective command checks: typecheck, lint, smoke, unit tests |

Prompt quality, from the same schema:

- Bad: "Based on your findings, implement the fix."
- Good: "Update `src/validators/plan-schema.ts` so duplicate task ids and
  missing dependency ids are rejected before launch. Add validation and unit
  tests. Report changed files and test command."

Do not ask producers to wait for CI, CR, merge, sleep loops, or human replies.
