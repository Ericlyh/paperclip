/**
 * Ranking of queued heartbeat runs.
 *
 * The start queue puts a run whose issue is already `in_progress` ahead of one
 * whose issue has not started, which is the right default: finish what is in
 * flight before starting something new.  It is also a strict priority, so a
 * busy agent that keeps producing `in_progress` continuations can starve a
 * fresh execution forever.
 *
 * Observed 2026-10-29 (OOP-6777): two routine executions sat queued for 8.4 h
 * while the host agent's two concurrency slots were refilled continuously by
 * continuations of issues already in progress.  Nothing timed out, nothing
 * failed, and the routine looked healthy on the board.
 */

/**
 * A queued run that has waited this long is no longer allowed to be overtaken
 * by newer work.
 */
export const QUEUED_RUN_STARVATION_MS = 30 * 60 * 1000;

/**
 * Rank of a queued heartbeat run in the start queue.  Lower runs first.
 *
 * `ageMs` is how long the run has been waiting.  A run that has waited past
 * `QUEUED_RUN_STARVATION_MS` is promoted ahead of everything else, and the
 * older it is the further ahead: one tier per `QUEUED_RUN_STARVATION_MS`.
 * Grading the age is what makes the promotion a starvation fix rather than a
 * reshuffle -- with a flat tier, a steady stream of higher-priority overdue
 * work could still overtake an overdue routine execution indefinitely.
 *
 * A run whose issue is still dependency-blocked is NOT promoted: it cannot
 * start yet, so ageing it would only pull it forward to be cancelled by the
 * dependency gate.  The other staleness gates in `claimQueuedRun` (terminal
 * issue, changed assignee, ...) still apply to a promoted run, so an obsolete
 * overdue run is cancelled rather than executed.
 *
 * A routine execution gets its own tier (OOP-7265).  A cron fire has a fixed
 * window -- the work it represents is only worth doing while that window is
 * open -- whereas ad-hoc issue work has no window and can afford to wait.
 * Measured 2026-11-01..2026-11-05 on this board: of 160 routine fires that
 * reached a start, 24 (15%) waited more than 30 minutes for a slot and 12
 * (7.5%) waited more than an hour, while the median was 0 minutes.  The queue
 * was serving ad-hoc work by age, so a fresh routine fire sat behind an
 * ad-hoc `todo` issue that had been queued far longer.
 *
 * `invocationSource` on the run row does NOT identify a routine fire: a
 * routine execution is dispatched like any other assignment
 * (`invocationSource: "assignment"`, `wakeReason: "issue_assigned"`), so
 * reading it would rank issue-monitor and missing-comment wakes ahead of
 * routine fires rather than the routine fires themselves.  The discriminator
 * is the issue's origin: `issues.originKind === "routine_execution"`.
 *
 * Work already in flight still goes first (tier 0): the routine tier only
 * decides between work that has not started yet.  Genuinely overdue work of
 * any kind is still promoted ahead of everything by the starvation tier, so
 * ad-hoc work that waits past `QUEUED_RUN_STARVATION_MS` overtakes a fresh
 * routine fire and the worst-case ad-hoc delay is unchanged.
 */
export function queuedRunPriorityRank(input: {
  hasIssueId: boolean;
  isDependencyReady: boolean;
  issueStatus: string | null | undefined;
  ageMs: number;
  isRoutineExecution?: boolean;
}): number {
  if (input.isDependencyReady && input.ageMs >= QUEUED_RUN_STARVATION_MS) {
    return -1 - Math.floor(input.ageMs / QUEUED_RUN_STARVATION_MS);
  }
  if (!input.hasIssueId) return 3;
  if (!input.isDependencyReady) return 4;
  if (input.issueStatus === "in_progress") return 0;
  return input.isRoutineExecution ? 1 : 2;
}
