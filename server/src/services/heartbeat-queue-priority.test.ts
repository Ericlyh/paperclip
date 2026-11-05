import { describe, expect, it } from "vitest";
import {
  QUEUED_RUN_STARVATION_MS,
  queuedRunPriorityRank,
} from "./heartbeat-queue-priority.js";

const MINUTE = 60 * 1000;

describe("queuedRunPriorityRank", () => {
  it("keeps the existing order when nothing has aged", () => {
    const fresh = { ageMs: 1 * MINUTE, isDependencyReady: true };

    // An issue already in flight goes first.
    expect(queuedRunPriorityRank({ ...fresh, hasIssueId: true, issueStatus: "in_progress" }))
      .toBeLessThan(queuedRunPriorityRank({ ...fresh, hasIssueId: true, issueStatus: "todo" }));
    // A run with no issue at all comes after both.
    expect(queuedRunPriorityRank({ ...fresh, hasIssueId: true, issueStatus: "todo" }))
      .toBeLessThan(queuedRunPriorityRank({ ...fresh, hasIssueId: false, issueStatus: null }));
    // A run whose issue is still dependency-blocked comes last.
    expect(queuedRunPriorityRank({ ...fresh, hasIssueId: false, issueStatus: null }))
      .toBeLessThan(queuedRunPriorityRank({ ...fresh, hasIssueId: true, isDependencyReady: false, issueStatus: "todo" }));
  });

  it("promotes an aged run ahead of newer work", () => {
    const aged = { ageMs: QUEUED_RUN_STARVATION_MS, isDependencyReady: true, hasIssueId: true, issueStatus: "todo" };

    // The OOP-6777 shape: a routine execution that has been queued for half an
    // hour must beat a fresh continuation of an issue already in progress.
    expect(queuedRunPriorityRank(aged))
      .toBeLessThan(queuedRunPriorityRank({
        ageMs: 0,
        hasIssueId: true,
        isDependencyReady: true,
        issueStatus: "in_progress",
      }));
  });

  it("keeps a dependency-blocked run behind a ready one", () => {
    const blocked = queuedRunPriorityRank({
      ageMs: 0,
      hasIssueId: true,
      isDependencyReady: false,
      issueStatus: "todo",
    });
    const ready = queuedRunPriorityRank({
      ageMs: 0,
      hasIssueId: true,
      isDependencyReady: true,
      issueStatus: "todo",
    });
    expect(blocked).toBeGreaterThan(ready);
  });

  it("does not promote a dependency-blocked run", () => {
    // Ageing it would only pull it forward to be cancelled by the dependency
    // gate in claimQueuedRun.
    expect(queuedRunPriorityRank({
      ageMs: 10 * QUEUED_RUN_STARVATION_MS,
      hasIssueId: true,
      isDependencyReady: false,
      issueStatus: "todo",
    })).toBe(4);
  });

  it("promotes an aged run that has no issue", () => {
    expect(queuedRunPriorityRank({
      ageMs: QUEUED_RUN_STARVATION_MS,
      hasIssueId: false,
      isDependencyReady: true,
      issueStatus: null,
    })).toBeLessThan(queuedRunPriorityRank({
      ageMs: 0,
      hasIssueId: true,
      isDependencyReady: true,
      issueStatus: "in_progress",
    }));
  });

  it("promotes exactly at the starvation threshold", () => {
    const base = { hasIssueId: true, isDependencyReady: true, issueStatus: "todo" as const };
    expect(queuedRunPriorityRank({ ...base, ageMs: QUEUED_RUN_STARVATION_MS - 1 })).toBe(2);
    expect(queuedRunPriorityRank({ ...base, ageMs: QUEUED_RUN_STARVATION_MS })).toBe(-2);
  });

  it("grades the age so the oldest overdue run always wins", () => {
    const base = { hasIssueId: true, isDependencyReady: true, issueStatus: "todo" as const };
    const older = queuedRunPriorityRank({ ...base, ageMs: 3 * QUEUED_RUN_STARVATION_MS });
    const newer = queuedRunPriorityRank({ ...base, ageMs: QUEUED_RUN_STARVATION_MS });
    // A flat tier would let a steady stream of newer overdue work overtake an
    // older one; the graded tier cannot.
    expect(older).toBeLessThan(newer);
  });

  describe("routine execution tier (OOP-7265)", () => {
    const fresh = { ageMs: 1 * MINUTE, isDependencyReady: true, hasIssueId: true };

    it("ranks a routine execution ahead of ad-hoc issue work that has not started", () => {
      expect(queuedRunPriorityRank({ ...fresh, issueStatus: "todo", isRoutineExecution: true }))
        .toBeLessThan(queuedRunPriorityRank({ ...fresh, issueStatus: "todo" }));
    });

    it("still puts work already in progress first", () => {
      // The routine tier only decides between work that has not started yet.
      expect(queuedRunPriorityRank({ ...fresh, issueStatus: "in_progress", isRoutineExecution: true }))
        .toBeLessThan(queuedRunPriorityRank({ ...fresh, issueStatus: "todo", isRoutineExecution: true }));
      expect(queuedRunPriorityRank({ ...fresh, issueStatus: "in_progress" }))
        .toBeLessThan(queuedRunPriorityRank({ ...fresh, issueStatus: "todo", isRoutineExecution: true }));
    });

    it("does not promote a dependency-blocked routine execution", () => {
      // It cannot start yet, so pulling it forward would only get it cancelled
      // by the dependency gate in claimQueuedRun.
      expect(queuedRunPriorityRank({
        ageMs: 1 * MINUTE,
        hasIssueId: true,
        isDependencyReady: false,
        issueStatus: "todo",
        isRoutineExecution: true,
      })).toBe(4);
    });

    it("lets genuinely overdue ad-hoc work overtake a fresh routine execution", () => {
      // The starvation tier is the safety valve: ad-hoc work that has waited
      // past the threshold is promoted ahead of a routine fire, so the
      // routine tier cannot starve it.
      const overdue = queuedRunPriorityRank({
        ageMs: QUEUED_RUN_STARVATION_MS,
        hasIssueId: true,
        isDependencyReady: true,
        issueStatus: "todo",
      });
      const freshRoutine = queuedRunPriorityRank({
        ageMs: 1 * MINUTE,
        hasIssueId: true,
        isDependencyReady: true,
        issueStatus: "todo",
        isRoutineExecution: true,
      });
      expect(overdue).toBeLessThan(freshRoutine);
    });

    it("is inert when the run is not a routine execution", () => {
      const base = { ageMs: 1 * MINUTE, hasIssueId: true, isDependencyReady: true, issueStatus: "todo" as const };
      expect(queuedRunPriorityRank({ ...base, isRoutineExecution: false }))
        .toBe(queuedRunPriorityRank({ ...base }));
    });
  });
});
