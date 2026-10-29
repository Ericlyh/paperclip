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
 */
export function queuedRunPriorityRank(input: {
  hasIssueId: boolean;
  isDependencyReady: boolean;
  issueStatus: string | null | undefined;
  ageMs: number;
}): number {
  if (input.isDependencyReady && input.ageMs >= QUEUED_RUN_STARVATION_MS) {
    return -1 - Math.floor(input.ageMs / QUEUED_RUN_STARVATION_MS);
  }
  if (!input.hasIssueId) return 2;
  if (!input.isDependencyReady) return 3;
  return input.issueStatus === "in_progress" ? 0 : 1;
}
