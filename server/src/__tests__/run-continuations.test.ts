import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_LIVENESS_CONTINUATION_ATTEMPTS,
  RUN_LIVENESS_CONTINUATION_REASON,
  buildRunLivenessContinuationIdempotencyKey,
  decideRunLivenessContinuation,
} from "../services/run-continuations.ts";

const companyId = "company-1";
const agentId = "agent-1";
const issueId = "issue-1";
const runId = "run-1";

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: runId,
    companyId,
    agentId,
    continuationAttempt: 0,
    ...overrides,
  } as never;
}

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: issueId,
    companyId,
    identifier: "PAP-1577",
    title: "Add bounded liveness continuation wakes",
    status: "in_progress",
    assigneeAgentId: agentId,
    executionState: null,
    projectId: null,
    ...overrides,
  } as never;
}

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: agentId,
    companyId,
    status: "idle",
    ...overrides,
  } as never;
}

describe("run liveness continuations", () => {
  it("enqueues the first plan_only continuation for the same issue and assignee", () => {
    const decision = decideRunLivenessContinuation({
      run: run(),
      issue: issue(),
      agent: agent(),
      livenessState: "plan_only",
      livenessReason: "Planned without acting",
      nextAction: "Take the first concrete action now.",
      budgetBlocked: false,
      idempotentWakeExists: false,
      hasActionEvidence: true,
    });

    expect(decision.kind).toBe("enqueue");
    if (decision.kind !== "enqueue") return;
    expect(decision.nextAttempt).toBe(1);
    expect(decision.idempotencyKey).toBe(
      buildRunLivenessContinuationIdempotencyKey({
        issueId,
        sourceRunId: runId,
        livenessState: "plan_only",
        nextAttempt: 1,
      }),
    );
    expect(decision.payload).toMatchObject({
      issueId,
      sourceRunId: runId,
      livenessState: "plan_only",
      livenessReason: "Planned without acting",
      continuationAttempt: 1,
      maxContinuationAttempts: DEFAULT_MAX_LIVENESS_CONTINUATION_ATTEMPTS,
      instruction: "Take the first concrete action now.",
    });
    expect(decision.payload).not.toHaveProperty("modelProfile");
    expect(decision.contextSnapshot).toMatchObject({
      issueId,
      wakeReason: RUN_LIVENESS_CONTINUATION_REASON,
      livenessContinuationAttempt: 1,
      livenessContinuationMaxAttempts: DEFAULT_MAX_LIVENESS_CONTINUATION_ATTEMPTS,
      livenessContinuationSourceRunId: runId,
      livenessContinuationState: "plan_only",
      livenessContinuationReason: "Planned without acting",
      livenessContinuationInstruction: "Take the first concrete action now.",
    });
    expect(decision.contextSnapshot).not.toHaveProperty("modelProfile");
  });

  it("enqueues the second empty_response continuation", () => {
    const decision = decideRunLivenessContinuation({
      run: run({ continuationAttempt: 1 }),
      issue: issue(),
      agent: agent(),
      livenessState: "empty_response",
      livenessReason: "No useful output",
      nextAction: null,
      budgetBlocked: false,
      idempotentWakeExists: false,
    });

    expect(decision.kind).toBe("enqueue");
    if (decision.kind !== "enqueue") return;
    expect(decision.nextAttempt).toBe(2);
  });

  it("leaves advanced terminal runs to stranded issue recovery instead of bounded liveness continuation", () => {
    const decision = decideRunLivenessContinuation({
      run: run(),
      issue: issue(),
      agent: agent(),
      livenessState: "advanced",
      livenessReason: "Run produced concrete action evidence: created an issue comment",
      nextAction: "Resume the implementation from the remaining acceptance criteria.",
      budgetBlocked: false,
      idempotentWakeExists: false,
    });

    expect(decision).toEqual({
      kind: "skip",
      reason: "liveness state is not actionable for continuation",
    });
  });

  it("does not enqueue a third continuation and returns an exhaustion comment", () => {
    const decision = decideRunLivenessContinuation({
      run: run({ continuationAttempt: 2 }),
      issue: issue(),
      agent: agent(),
      livenessState: "plan_only",
      livenessReason: "Still planning",
      nextAction: null,
      budgetBlocked: false,
      idempotentWakeExists: false,
      hasActionEvidence: true,
    });

    expect(decision.kind).toBe("exhausted");
    if (decision.kind !== "exhausted") return;
    expect(decision.comment).toContain("Bounded liveness continuation exhausted");
    expect(decision.comment).toContain("Attempts used: 2/2");
  });

  it("skips plan_only without concrete action evidence (OOP-4180 self-sustaining loop)", () => {
    // Prose-only plan_only output must NOT extend the bounded-continuation
    // budget — the corrective handoff would itself only re-plan. The issue
    // is left visible for human attention instead.
    const decision = decideRunLivenessContinuation({
      run: run(),
      issue: issue(),
      agent: agent(),
      livenessState: "plan_only",
      livenessReason: "Planned without acting",
      nextAction: null,
      budgetBlocked: false,
      idempotentWakeExists: false,
      hasActionEvidence: false,
    });

    expect(decision).toEqual({
      kind: "skip",
      reason:
        "plan_only run produced no concrete action evidence on the issue — issue remains visible for human attention rather than auto-queueing another corrective handoff",
    });
  });

  it("skips plan_only without action evidence even on the second attempt (replay of OOP-4180)", () => {
    // Replay the OOP-4180 scenario: three consecutive plan_only runs against
    // the same source run. None carry evidence, so all three return skip —
    // no corrective handoffs are queued and no comments are emitted.
    const attempts = [0, 1, 2].map((continuationAttempt) =>
      decideRunLivenessContinuation({
        run: run({ continuationAttempt }),
        issue: issue(),
        agent: agent(),
        livenessState: "plan_only",
        livenessReason: "Planned without acting",
        nextAction: null,
        budgetBlocked: false,
        idempotentWakeExists: false,
        hasActionEvidence: false,
      }),
    );

    expect(attempts.map((d) => d.kind)).toEqual(["skip", "skip", "skip"]);
    // The exhausted branch must NOT fire on evidence-negative plan_only —
    // we deliberately surface to the user via "no continuation", not via
    // the exhausted comment, so the OOP-4180 thread (3 identical agent
    // comments + 1 exhausted comment) cannot reproduce.
    expect(attempts.map((d) => (d.kind === "exhausted" ? d.comment : null))).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("extends the bounded-continuation budget when plan_only carries action evidence", () => {
    const decision = decideRunLivenessContinuation({
      run: run(),
      issue: issue(),
      agent: agent(),
      livenessState: "plan_only",
      livenessReason: "Planned, then wrote a substantive comment",
      nextAction: "Continue from where the comment left off.",
      budgetBlocked: false,
      idempotentWakeExists: false,
      hasActionEvidence: true,
    });

    expect(decision.kind).toBe("enqueue");
    if (decision.kind !== "enqueue") return;
    expect(decision.nextAttempt).toBe(1);
    // The corrective-handoff instruction reflects the existing nextAction —
    // the regression-check path is intact for evidence-positive runs.
    expect(decision.payload.instruction).toBe("Continue from where the comment left off.");
  });

  it("ignores hasActionEvidence for empty_response (legacy behavior preserved)", () => {
    // empty_response is a different signal — the run produced no output at
    // all. The corrective handoff asks the agent to produce output, so
    // requiring action evidence here would be a regression.
    const decision = decideRunLivenessContinuation({
      run: run({ continuationAttempt: 1 }),
      issue: issue(),
      agent: agent(),
      livenessState: "empty_response",
      livenessReason: "No useful output",
      nextAction: null,
      budgetBlocked: false,
      idempotentWakeExists: false,
      hasActionEvidence: false,
    });

    expect(decision.kind).toBe("enqueue");
    if (decision.kind !== "enqueue") return;
    expect(decision.nextAttempt).toBe(2);
  });

  it("treats null hasActionEvidence as legacy 'allow continuation' for plan_only", () => {
    // Backward compatibility: callers that have not been updated to compute
    // the evidence flag (e.g. older test setups or a non-heartbeat caller)
    // must still allow continuation. Only the explicit `false` triggers the
    // gate.
    const decision = decideRunLivenessContinuation({
      run: run(),
      issue: issue(),
      agent: agent(),
      livenessState: "plan_only",
      livenessReason: "Unknown evidence state — fallback",
      nextAction: null,
      budgetBlocked: false,
      idempotentWakeExists: false,
      hasActionEvidence: null,
    });

    expect(decision.kind).toBe("enqueue");
  });

  it("skips non-actionable and guarded issues", () => {
    const guardedCases = [
      { livenessState: "advanced" as const },
      { issue: issue({ status: "done" }) },
      { issue: issue({ assigneeAgentId: "other-agent" }) },
      { issue: issue({ executionState: { status: "pending" } }) },
      { agent: agent({ status: "paused" }) },
      { budgetBlocked: true },
      { idempotentWakeExists: true },
    ];

    for (const guarded of guardedCases) {
      const decision = decideRunLivenessContinuation({
        run: run(),
        issue: guarded.issue ?? issue(),
        agent: guarded.agent ?? agent(),
        livenessState: guarded.livenessState ?? "plan_only",
        livenessReason: "No progress",
        nextAction: null,
        budgetBlocked: guarded.budgetBlocked ?? false,
        idempotentWakeExists: guarded.idempotentWakeExists ?? false,
        hasActionEvidence: true,
      });

      expect(decision.kind).toBe("skip");
    }
  });
});
