import { useMemo, useState, type ReactNode } from "react";
import type { ActivityEvent, Issue, Agent } from "@paperclipai/shared";
import { isResponsibleUserDenialCode, responsibleUserLabel } from "@paperclipai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { accessApi, type CurrentBoardAccess } from "../api/access";
import { activityApi, type RunForIssue, type RunLivenessState } from "../api/activity";
import { ApiError } from "../api/client";
import {
  heartbeatsApi,
  type ActiveRunForIssue,
  type LiveRunForIssue,
  type WatchdogDecisionInput,
} from "../api/heartbeats";
import { useToastActions } from "../context/ToastContext";
import { cn, relativeTime } from "../lib/utils";
import { useTranslation } from "../i18n";
import { queryKeys } from "../lib/queryKeys";
import { keepPreviousDataForSameQueryTail } from "../lib/query-placeholder-data";
import { describeRunRetryState } from "../lib/runRetryState";
import { readSourceResolvedWatchdogFold } from "../lib/source-resolved-watchdog-fold";
import { SourceResolvedFoldBadge } from "./SourceResolvedFoldBadge";
import { ResponsibleUserDenialNotice } from "./ResponsibleUserDenialNotice";

type IssueRunLedgerProps = {
  issueId: string;
  companyId: string;
  issueStatus: Issue["status"];
  childIssues: Issue[];
  agentMap: ReadonlyMap<string, Agent>;
  hasLiveRuns: boolean;
  activityEvents?: ActivityEvent[];
  renderActivityEvent?: (event: ActivityEvent) => ReactNode;
  resolveUserLabel?: (userId: string) => string | null | undefined;
};

type IssueRunLedgerContentProps = {
  runs: RunForIssue[];
  liveRuns?: LiveRunForIssue[];
  activeRun?: ActiveRunForIssue | null;
  issueStatus: Issue["status"];
  childIssues: Issue[];
  agentMap: ReadonlyMap<string, Pick<Agent, "name">>;
  activityEvents?: ActivityEvent[];
  renderActivityEvent?: (event: ActivityEvent) => ReactNode;
  resolveUserLabel?: (userId: string) => string | null | undefined;
  pendingWatchdogDecision?: WatchdogDecisionInput["decision"] | null;
  canRecordWatchdogDecisions?: boolean;
  watchdogDecisionError?: string | null;
  onWatchdogDecision?: (input: WatchdogDecisionInput) => void;
};

type LedgerRun = RunForIssue & {
  isLive?: boolean;
  agentName?: string;
  outputSilence?: ActiveRunForIssue["outputSilence"];
};

type LedgerFeedItem =
  | {
      kind: "run";
      id: string;
      timestamp: string;
      run: LedgerRun;
    }
  | {
      kind: "activity";
      id: string;
      timestamp: string;
      event: ActivityEvent;
    };

type LivenessCopy = {
  label: string;
  tone: string;
  description: string;
};

const LIVENESS_TONES: Record<RunLivenessState, string> = {
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  advanced: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  plan_only: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  empty_response: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  blocked: "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  failed: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  needs_followup: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

const PENDING_LIVENESS_TONE = "border-border bg-background text-muted-foreground";
const RETRY_PENDING_LIVENESS_TONE = "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
const MISSING_LIVENESS_TONE = "border-border bg-background text-muted-foreground";

function buildLivenessCopy(
  t: (key: string, options?: Record<string, unknown>) => string,
): Record<RunLivenessState, LivenessCopy> {
  return {
    completed: {
      label: t("runLedger.liveness.completed.label", { defaultValue: "Completed" }),
      tone: LIVENESS_TONES.completed,
      description: t("runLedger.liveness.completed.description", { defaultValue: "Task reached a terminal state." }),
    },
    advanced: {
      label: t("runLedger.liveness.advanced.label", { defaultValue: "Advanced" }),
      tone: LIVENESS_TONES.advanced,
      description: t("runLedger.liveness.advanced.description", { defaultValue: "Run produced concrete evidence of progress." }),
    },
    plan_only: {
      label: t("runLedger.liveness.planOnly.label", { defaultValue: "Plan only" }),
      tone: LIVENESS_TONES.plan_only,
      description: t("runLedger.liveness.planOnly.description", { defaultValue: "Run described future work without concrete action evidence." }),
    },
    empty_response: {
      label: t("runLedger.liveness.emptyResponse.label", { defaultValue: "Empty response" }),
      tone: LIVENESS_TONES.empty_response,
      description: t("runLedger.liveness.emptyResponse.description", { defaultValue: "Run finished without useful output." }),
    },
    blocked: {
      label: t("runLedger.liveness.blocked.label", { defaultValue: "Blocked" }),
      tone: LIVENESS_TONES.blocked,
      description: t("runLedger.liveness.blocked.description", { defaultValue: "Run or task declared a blocker." }),
    },
    failed: {
      label: t("runLedger.liveness.failed.label", { defaultValue: "Failed" }),
      tone: LIVENESS_TONES.failed,
      description: t("runLedger.liveness.failed.description", { defaultValue: "Run ended unsuccessfully." }),
    },
    needs_followup: {
      label: t("runLedger.liveness.needsFollowup.label", { defaultValue: "Needs follow-up" }),
      tone: LIVENESS_TONES.needs_followup,
      description: t("runLedger.liveness.needsFollowup.description", { defaultValue: "Run produced useful output but did not prove concrete progress." }),
    },
  };
}

function buildPendingLivenessCopy(
  t: (key: string, options?: Record<string, unknown>) => string,
): LivenessCopy {
  return {
    label: t("runLedger.liveness.pending.label", { defaultValue: "Checks after finish" }),
    tone: PENDING_LIVENESS_TONE,
    description: t("runLedger.liveness.pending.description", { defaultValue: "Liveness is evaluated after the run finishes." }),
  };
}

function buildRetryPendingLivenessCopy(
  t: (key: string, options?: Record<string, unknown>) => string,
): LivenessCopy {
  return {
    label: t("runLedger.liveness.retryPending.label", { defaultValue: "Retry pending" }),
    tone: RETRY_PENDING_LIVENESS_TONE,
    description: t("runLedger.liveness.retryPending.description", { defaultValue: "Paperclip queued an automatic retry that has not started yet." }),
  };
}

function buildMissingLivenessCopy(
  t: (key: string, options?: Record<string, unknown>) => string,
): LivenessCopy {
  return {
    label: t("runLedger.liveness.missing.label", { defaultValue: "No liveness data" }),
    tone: MISSING_LIVENESS_TONE,
    description: t("runLedger.liveness.missing.description", { defaultValue: "This run has no persisted liveness classification." }),
  };
}

const TERMINAL_CHILD_STATUSES = new Set<Issue["status"]>(["done", "cancelled"]);
const ACTIVE_RUN_STATUSES = new Set(["queued", "running"]);

type RunOutputSilenceLevel = NonNullable<ActiveRunForIssue["outputSilence"]>["level"];

type RunOutputSilenceCopy = {
  label: string;
  tone: string;
};

const RUN_OUTPUT_SILENCE_TONES: Partial<Record<RunOutputSilenceLevel, string>> = {
  suspicious: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  critical: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  snoozed: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
};

function buildRunOutputSilenceCopy(
  t: (key: string, options?: Record<string, unknown>) => string,
): Partial<Record<RunOutputSilenceLevel, RunOutputSilenceCopy>> {
  return {
    suspicious: {
      label: t("runLedger.outputSilence.suspicious.label", { defaultValue: "Silence watch" }),
      tone: RUN_OUTPUT_SILENCE_TONES.suspicious!,
    },
    critical: {
      label: t("runLedger.outputSilence.critical.label", { defaultValue: "Stale run" }),
      tone: RUN_OUTPUT_SILENCE_TONES.critical!,
    },
    snoozed: {
      label: t("runLedger.outputSilence.snoozed.label", { defaultValue: "Silence snoozed" }),
      tone: RUN_OUTPUT_SILENCE_TONES.snoozed!,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

interface ModelProfileSummary {
  requested: string;
  applied: string | null;
  configSource: string | null;
  fallbackReason: string | null;
}

function modelProfileForRun(run: RunForIssue): ModelProfileSummary | null {
  const result = asRecord(run.resultJson);
  const profile = asRecord(result?.modelProfile);
  if (!profile) return null;
  const requested = readString(profile.requested);
  if (!requested) return null;
  return {
    requested,
    applied: readString(profile.applied),
    configSource: readString(profile.configSource),
    fallbackReason: readString(profile.fallbackReason),
  };
}

function modelProfileBadgeTone(summary: ModelProfileSummary) {
  if (summary.applied === summary.requested) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (summary.fallbackReason) {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "border-border bg-background text-muted-foreground";
}

function modelProfileTitle(summary: ModelProfileSummary) {
  const lines = [`Requested: ${summary.requested}`];
  if (summary.applied) lines.push(`Applied: ${summary.applied}`);
  if (summary.configSource) lines.push(`Source: ${summary.configSource}`);
  if (summary.fallbackReason) lines.push(`Fallback: ${summary.fallbackReason}`);
  return lines.join("\n");
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatDuration(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (!start) return null;
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (totalSeconds < 60) return t("time.secondsCompact", { value: totalSeconds, defaultValue: `${totalSeconds}s` });
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0
      ? t("time.minutesSecondsCompact", { minutes, seconds, defaultValue: `${minutes}m ${seconds}s` })
      : t("time.minutesCompact", { value: minutes, defaultValue: `${minutes}m` });
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? t("time.hoursMinutesCompact", { hours, minutes: remainingMinutes, defaultValue: `${hours}h ${remainingMinutes}m` })
    : t("time.hoursCompact", { value: hours, defaultValue: `${hours}h` });
}

function formatRelativeTime(
  date: Date | string,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const now = Date.now();
  const then = new Date(date).getTime();
  if (!Number.isFinite(then)) return relativeTime(date);
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return t("time.justNow", { defaultValue: "just now" });
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return t("time.minutesAgo", { value: diffMin, defaultValue: `${diffMin}m ago` });
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return t("time.hoursAgo", { value: diffHr, defaultValue: `${diffHr}h ago` });
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return t("time.daysAgo", { value: diffDay, defaultValue: `${diffDay}d ago` });
  return relativeTime(date);
}

function toIsoString(value: string | Date | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function liveRunToLedgerRun(run: LiveRunForIssue | ActiveRunForIssue): LedgerRun {
  return {
    runId: run.id,
    status: run.status,
    agentId: run.agentId,
    agentName: run.agentName,
    adapterType: run.adapterType,
    startedAt: toIsoString(run.startedAt),
    finishedAt: toIsoString(run.finishedAt),
    createdAt: toIsoString(run.createdAt) ?? new Date().toISOString(),
    invocationSource: run.invocationSource,
    usageJson: null,
    resultJson: null,
    isLive: run.status === "queued" || run.status === "running",
    outputSilence: run.outputSilence,
  };
}

function mergeRuns(
  runs: RunForIssue[],
  liveRuns: LiveRunForIssue[] | undefined,
  activeRun: ActiveRunForIssue | null | undefined,
) {
  const byId = new Map<string, LedgerRun>();
  for (const run of runs) byId.set(run.runId, run);
  for (const run of liveRuns ?? []) {
    const existing = byId.get(run.id);
    byId.set(
      run.id,
      existing
        ? { ...existing, isLive: true, agentName: run.agentName, outputSilence: run.outputSilence }
        : liveRunToLedgerRun(run),
    );
  }
  if (activeRun) {
    const existing = byId.get(activeRun.id);
    if (existing) {
      byId.set(activeRun.id, {
        ...existing,
        isLive: isActiveRun(existing) || isActiveRun(activeRun),
        agentName: activeRun.agentName,
        outputSilence: activeRun.outputSilence,
      });
    } else {
      byId.set(activeRun.id, liveRunToLedgerRun(activeRun));
    }
  }

  return [...byId.values()].sort((a, b) => {
    const aTime = new Date(a.startedAt ?? a.createdAt).getTime();
    const bTime = new Date(b.startedAt ?? b.createdAt).getTime();
    if (aTime !== bTime) return bTime - aTime;
    return b.runId.localeCompare(a.runId);
  });
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}

function isActiveRun(run: Pick<LedgerRun, "status" | "isLive">) {
  return run.isLive || ACTIVE_RUN_STATUSES.has(run.status);
}

function runSummary(
  run: LedgerRun,
  agentMap: ReadonlyMap<string, Pick<Agent, "name">>,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const agentName = compactAgentName(run, agentMap);
  if (run.status === "running") return t("runLedger.summary.running", { agent: agentName, defaultValue: `Running now by ${agentName}` });
  if (run.status === "queued") return t("runLedger.summary.queued", { agent: agentName, defaultValue: `Queued for ${agentName}` });
  if (run.status === "scheduled_retry") return t("runLedger.summary.scheduledRetry", { agent: agentName, defaultValue: `Automatic retry scheduled for ${agentName}` });
  return t("runLedger.summary.other", { agent: agentName, status: statusLabel(run.status), defaultValue: `${statusLabel(run.status)} by ${agentName}` });
}

function livenessCopyForRun(
  run: LedgerRun,
  retryPending: LivenessCopy,
  live: Record<RunLivenessState, LivenessCopy>,
  pending: LivenessCopy,
  missing: LivenessCopy,
) {
  if (run.status === "scheduled_retry") return retryPending;
  if (run.livenessState) return live[run.livenessState];
  return isActiveRun(run) ? pending : missing;
}

function stopReasonLabel(
  run: RunForIssue,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const result = asRecord(run.resultJson);
  const stopReason = readString(result?.stopReason);
  const timeoutFired = result?.timeoutFired === true;
  const effectiveTimeoutSec = readNumber(result?.effectiveTimeoutSec);
  const timeoutText =
    effectiveTimeoutSec && effectiveTimeoutSec > 0 ? `${effectiveTimeoutSec}s timeout` : null;

  if (timeoutFired || stopReason === "timeout") {
    if (timeoutText && effectiveTimeoutSec) {
      return t("runLedger.stopReason.timeoutWithSeconds", { seconds: effectiveTimeoutSec, defaultValue: `timeout (${effectiveTimeoutSec}s timeout)` });
    }
    return t("runLedger.stopReason.timeout", { defaultValue: "timeout" });
  }
  if (stopReason === "max_turns_exhausted" || stopReason === "turn_limit_exhausted") {
    return t("runLedger.stopReason.maxTurnsExhausted", { defaultValue: "max turns exhausted" });
  }
  if (stopReason === "budget_paused") return t("runLedger.stopReason.budgetPaused", { defaultValue: "budget paused" });
  if (stopReason === "cancelled") return t("runLedger.stopReason.cancelled", { defaultValue: "cancelled" });
  if (stopReason === "paused") return t("runLedger.stopReason.pausedByBoard", { defaultValue: "paused by board" });
  if (stopReason === "process_lost") return t("runLedger.stopReason.processLost", { defaultValue: "process lost" });
  if (stopReason === "unmanaged_background_task_stopped") return t("runLedger.stopReason.unmanagedBackgroundTaskStopped", { defaultValue: "unmanaged background task stopped" });
  if (stopReason === "adapter_failed") return t("runLedger.stopReason.adapterFailed", { defaultValue: "adapter failed" });
  if (stopReason === "completed") {
    if (timeoutText && effectiveTimeoutSec) {
      return t("runLedger.stopReason.completedWithSeconds", { seconds: effectiveTimeoutSec, defaultValue: `completed (${effectiveTimeoutSec}s timeout)` });
    }
    return t("runLedger.stopReason.completed", { defaultValue: "completed" });
  }
  return timeoutText;
}

function stopStatusLabel(
  run: LedgerRun,
  stopReason: string | null,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (stopReason) return stopReason;
  if (run.status === "scheduled_retry") return t("runLedger.stopStatus.retryPending", { defaultValue: "Retry pending" });
  if (run.status === "queued") return t("runLedger.stopStatus.waitingToStart", { defaultValue: "Waiting to start" });
  if (run.status === "running") return t("runLedger.stopStatus.stillRunning", { defaultValue: "Still running" });
  if (!run.livenessState) return t("runLedger.stopStatus.unavailable", { defaultValue: "Unavailable" });
  return t("runLedger.stopStatus.noStopReason", { defaultValue: "No stop reason" });
}

function lastUsefulActionLabel(run: LedgerRun, t: (key: string, options?: Record<string, unknown>) => string) {
  if (run.status === "scheduled_retry") return t("runLedger.lastUsefulAction.waitingForNextAttempt", { defaultValue: "Waiting for next attempt" });
  if (run.lastUsefulActionAt) return relativeTime(run.lastUsefulActionAt);
  if (isActiveRun(run)) return t("runLedger.lastUsefulAction.noActionRecorded", { defaultValue: "No action recorded yet" });
  if (run.livenessState === "plan_only" || run.livenessState === "needs_followup") {
    return t("runLedger.lastUsefulAction.noConcreteAction", { defaultValue: "No concrete action" });
  }
  if (run.livenessState === "empty_response") return t("runLedger.lastUsefulAction.noUsefulOutput", { defaultValue: "No useful output" });
  if (!run.livenessState) return t("runLedger.lastUsefulAction.unavailable", { defaultValue: "Unavailable" });
  return t("runLedger.lastUsefulAction.noneRecorded", { defaultValue: "None recorded" });
}

function continuationLabel(run: LedgerRun) {
  if (!run.continuationAttempt || run.continuationAttempt <= 0) return null;
  return `Continuation attempt ${run.continuationAttempt}`;
}

function hasExhaustedContinuation(run: RunForIssue) {
  return /continuation attempts exhausted/i.test(run.livenessReason ?? "");
}

function childIssueSummary(childIssues: Issue[]) {
  const active = childIssues.filter((issue) => !TERMINAL_CHILD_STATUSES.has(issue.status));
  const done = childIssues.filter((issue) => issue.status === "done").length;
  const cancelled = childIssues.filter((issue) => issue.status === "cancelled").length;
  return { active, done, cancelled, total: childIssues.length };
}

function compactAgentName(run: LedgerRun, agentMap: ReadonlyMap<string, Pick<Agent, "name">>) {
  return run.agentName ?? agentMap.get(run.agentId)?.name ?? run.agentId.slice(0, 8);
}

function formatSilenceAge(ms: number | null | undefined, t: (key: string, options?: Record<string, unknown>) => string) {
  if (!ms || ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return t("time.underOneMinute", { defaultValue: "under 1 minute" });
  if (totalMinutes < 60) return t("time.minutes", { count: totalMinutes, defaultValue: `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}` });
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return t("time.hours", { count: hours, defaultValue: `${hours} hour${hours === 1 ? "" : "s"}` });
  return t("time.hoursMinutesCompact", { hours, minutes, defaultValue: `${hours}h ${minutes}m` });
}

function canBoardRecordWatchdogDecision(
  companyId: string,
  boardAccess: CurrentBoardAccess | undefined,
) {
  if (!boardAccess) return false;
  if (boardAccess.source === "local_implicit" || boardAccess.isInstanceAdmin) return true;

  const membership = boardAccess.memberships?.find(
    (item) => item.companyId === companyId && item.status === "active",
  );
  if (!membership) return boardAccess.companyIds.includes(companyId) && !boardAccess.memberships;
  return membership.membershipRole !== "viewer" && membership.membershipRole !== null;
}

function watchdogDecisionErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) {
    return "Only the board or the assigned recovery owner can record watchdog decisions";
  }
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Paperclip could not record the watchdog decision.";
}

export function IssueRunLedger({
  issueId,
  companyId,
  issueStatus,
  childIssues,
  agentMap,
  hasLiveRuns,
  activityEvents,
  renderActivityEvent,
  resolveUserLabel,
}: IssueRunLedgerProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [watchdogDecisionError, setWatchdogDecisionError] = useState<string | null>(null);
  const { data: boardAccess } = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
    retry: false,
  });
  const { data: runs } = useQuery({
    queryKey: queryKeys.issues.runs(issueId),
    queryFn: () => activityApi.runsForIssue(issueId),
    refetchInterval: hasLiveRuns || issueStatus === "in_progress" ? 5000 : false,
    placeholderData: keepPreviousDataForSameQueryTail<RunForIssue[]>(issueId),
  });
  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.issues.liveRuns(issueId),
    queryFn: () => heartbeatsApi.liveRunsForIssue(issueId),
    enabled: hasLiveRuns,
    refetchInterval: 3000,
    placeholderData: keepPreviousDataForSameQueryTail<LiveRunForIssue[]>(issueId),
  });
  const { data: activeRun = null } = useQuery({
    queryKey: queryKeys.issues.activeRun(issueId),
    queryFn: () => heartbeatsApi.activeRunForIssue(issueId),
    enabled: hasLiveRuns || issueStatus === "in_progress",
    refetchInterval: hasLiveRuns ? false : 3000,
    placeholderData: keepPreviousDataForSameQueryTail<ActiveRunForIssue | null>(issueId),
  });
  const watchdogDecision = useMutation({
    mutationFn: (input: WatchdogDecisionInput) => heartbeatsApi.recordWatchdogDecision(input),
    onMutate: () => {
      setWatchdogDecisionError(null);
    },
    onSuccess: () => {
      setWatchdogDecisionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.activeRun(issueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(issueId) });
    },
    onError: (error) => {
      const message = watchdogDecisionErrorMessage(error);
      const dedupeSuffix = error instanceof ApiError ? String(error.status) : "error";
      setWatchdogDecisionError(message);
      pushToast({
        title: "Watchdog decision not recorded",
        body: message,
        tone: "error",
        dedupeKey: `watchdog-decision:${issueId}:${dedupeSuffix}`,
      });
    },
  });

  return (
    <IssueRunLedgerContent
      runs={runs ?? []}
      liveRuns={liveRuns}
      activeRun={activeRun}
      issueStatus={issueStatus}
      childIssues={childIssues}
      agentMap={agentMap}
      activityEvents={activityEvents}
      renderActivityEvent={renderActivityEvent}
      resolveUserLabel={resolveUserLabel}
      pendingWatchdogDecision={watchdogDecision.variables?.decision ?? null}
      canRecordWatchdogDecisions={canBoardRecordWatchdogDecision(companyId, boardAccess)}
      watchdogDecisionError={watchdogDecisionError}
      onWatchdogDecision={(input) => watchdogDecision.mutate(input)}
    />
  );
}

export function IssueRunLedgerContent({
  runs,
  liveRuns,
  activeRun,
  issueStatus,
  childIssues,
  agentMap,
  activityEvents,
  renderActivityEvent,
  resolveUserLabel,
  pendingWatchdogDecision,
  canRecordWatchdogDecisions = true,
  watchdogDecisionError,
  onWatchdogDecision,
}: IssueRunLedgerContentProps) {
  const { t } = useTranslation();
  const ledgerRuns = useMemo(() => mergeRuns(runs, liveRuns, activeRun), [activeRun, liveRuns, runs]);
  const livenessCopy = useMemo(() => buildLivenessCopy(t), [t]);
  const pendingLivenessCopy = useMemo(() => buildPendingLivenessCopy(t), [t]);
  const retryPendingLivenessCopy = useMemo(() => buildRetryPendingLivenessCopy(t), [t]);
  const missingLivenessCopy = useMemo(() => buildMissingLivenessCopy(t), [t]);
  const runOutputSilenceCopy = useMemo(() => buildRunOutputSilenceCopy(t), [t]);
  const latestRun = ledgerRuns[0] ?? null;
  const latestSilentRun = useMemo(
    () =>
      ledgerRuns.find((run) =>
        isActiveRun(run)
        && (run.outputSilence?.level === "critical" || run.outputSilence?.level === "suspicious"),
      ) ?? null,
    [ledgerRuns],
  );
  const children = childIssueSummary(childIssues);
  const canRenderActivityEvents = Boolean(renderActivityEvent);
  const feedItems = useMemo<LedgerFeedItem[]>(() => {
    const items: LedgerFeedItem[] = [];
    for (const run of ledgerRuns) {
      items.push({
        kind: "run",
        id: run.runId,
        timestamp: run.startedAt ?? run.createdAt,
        run,
      });
    }
    if (canRenderActivityEvents) {
      for (const event of activityEvents ?? []) {
        items.push({
          kind: "activity",
          id: event.id,
          timestamp: event.createdAt instanceof Date
            ? event.createdAt.toISOString()
            : String(event.createdAt),
          event,
        });
      }
    }
    return items.sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime();
      const bTime = new Date(b.timestamp).getTime();
      if (aTime !== bTime) return bTime - aTime;
      if (a.kind !== b.kind) return a.kind === "run" ? -1 : 1;
      return b.id.localeCompare(a.id);
    });
  }, [activityEvents, canRenderActivityEvents, ledgerRuns]);

  return (
    <section className="space-y-3" aria-label={t("runLedger.ariaLabel", { defaultValue: "Task run ledger" })}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-muted-foreground">{t("runLedger.title", { defaultValue: "Run ledger" })}</h3>
          <p className="text-xs text-muted-foreground">
            {latestRun
              ? runSummary(latestRun, agentMap, t)
              : issueStatus === "in_progress"
                ? t("runLedger.empty.waiting", { defaultValue: "Waiting for the first run record." })
                : t("runLedger.empty.none", { defaultValue: "No runs linked yet." })}
          </p>
        </div>
        {latestRun ? (
          <Link
            to={`/agents/${latestRun.agentId}/runs/${latestRun.runId}`}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {t("runLedger.latestRunLink", { defaultValue: "Latest run" })}
          </Link>
        ) : null}
      </div>

      {children.total > 0 ? (
        <div className="rounded-md border border-border/70 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-foreground">{t("runLedger.childWork.title", { defaultValue: "Child work" })}</span>
            <span className="text-muted-foreground">
              {children.active.length > 0
                ? t("runLedger.childWork.summary.active", {
                    active: children.active.length,
                    done: children.done,
                    cancelled: children.cancelled,
                    defaultValue: `${children.active.length} active, ${children.done} done, ${children.cancelled} cancelled`,
                  })
                : t("runLedger.childWork.summary.allTerminal", {
                    total: children.total,
                    done: children.done,
                    cancelled: children.cancelled,
                    defaultValue: `all ${children.total} terminal (${children.done} done, ${children.cancelled} cancelled)`,
                  })}
            </span>
          </div>
          {children.active.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {children.active.slice(0, 4).map((child) => (
                <Link
                  key={child.id}
                  to={`/issues/${child.identifier ?? child.id}`}
                  className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-(length:--text-micro) hover:bg-accent/40"
                >
                  <span className="shrink-0 font-mono text-muted-foreground">{child.identifier ?? child.id.slice(0, 8)}</span>
                  <span className="truncate">{child.title}</span>
                  <span className="shrink-0 text-muted-foreground">{statusLabel(child.status)}</span>
                </Link>
              ))}
              {children.active.length > 4 ? (
                <span className="rounded-md border border-border px-2 py-1 text-(length:--text-micro) text-muted-foreground">
                  {t("runLedger.childWork.more", { count: children.active.length - 4, defaultValue: `+${children.active.length - 4} more` })}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {latestSilentRun?.outputSilence ? (
        <div
          className={cn(
            "rounded-md border px-3 py-2 text-xs",
            latestSilentRun.outputSilence.level === "critical"
              ? "border-red-500/30 bg-red-500/10 text-red-900 dark:text-red-200"
              : "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200",
          )}
        >
          <p className="font-medium">
            {latestSilentRun.outputSilence.level === "critical"
              ? t("runLedger.watchdog.staleTitle", { defaultValue: "Stale-run watchdog alert" })
              : t("runLedger.watchdog.silenceTitle", { defaultValue: "Output silence watchdog warning" })}
          </p>
          <p className="mt-1">
            {t("runLedger.watchdog.silentFor", {
              duration: formatSilenceAge(latestSilentRun.outputSilence.silenceAgeMs, t) ?? t("runLedger.watchdog.extendedPeriod", { defaultValue: "an extended period" }),
              defaultValue: "Latest active run has been silent for {{duration}}.",
            })}
            {latestSilentRun.outputSilence.evaluationIssueIdentifier ? (
              <>
                {" "}
                {t("runLedger.watchdog.recoveryPrefix", { defaultValue: "Review" })}{" "}
                <Link
                  to={`/issues/${latestSilentRun.outputSilence.evaluationIssueIdentifier}`}
                  className="font-medium underline underline-offset-2"
                >
                  {latestSilentRun.outputSilence.evaluationIssueIdentifier}
                </Link>
                {" "}
                {t("runLedger.watchdog.recoverySuffix", { defaultValue: "for recovery context." })}
              </>
            ) : null}
          </p>
          {onWatchdogDecision && canRecordWatchdogDecisions ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                className="rounded-md border border-border bg-background/80 px-2 py-1 text-(length:--text-micro) text-foreground hover:bg-background"
                onClick={() =>
                  onWatchdogDecision({
                    runId: latestSilentRun.runId,
                    decision: "continue",
                    evaluationIssueId: latestSilentRun.outputSilence?.evaluationIssueId ?? null,
                  })}
                disabled={pendingWatchdogDecision != null}
              >
                {t("runLedger.watchdog.continueLabel", { defaultValue: "Continue monitoring" })}
              </button>
              <button
                type="button"
                className="rounded-md border border-border bg-background/80 px-2 py-1 text-(length:--text-micro) text-foreground hover:bg-background"
                onClick={() =>
                  onWatchdogDecision({
                    runId: latestSilentRun.runId,
                    decision: "snooze",
                    evaluationIssueId: latestSilentRun.outputSilence?.evaluationIssueId ?? null,
                    snoozedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                    reason: "Snoozed from issue run ledger",
                  })}
                disabled={pendingWatchdogDecision != null}
              >
                {t("runLedger.watchdog.snoozeOneHour", { defaultValue: "Snooze 1h" })}
              </button>
              <button
                type="button"
                className="rounded-md border border-border bg-background/80 px-2 py-1 text-(length:--text-micro) text-foreground hover:bg-background"
                onClick={() =>
                  onWatchdogDecision({
                    runId: latestSilentRun.runId,
                    decision: "dismissed_false_positive",
                    evaluationIssueId: latestSilentRun.outputSilence?.evaluationIssueId ?? null,
                    reason: "Dismissed from issue run ledger",
                  })}
                disabled={pendingWatchdogDecision != null}
              >
                {t("runLedger.watchdog.markFalsePositive", { defaultValue: "Mark false positive" })}
              </button>
            </div>
          ) : null}
          {watchdogDecisionError ? (
            <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-(length:--text-micro) text-red-900 dark:text-red-200">
              {watchdogDecisionError}
            </p>
          ) : null}
        </div>
      ) : null}

      {feedItems.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          {renderActivityEvent
            ? t("runLedger.empty.withActivity", { defaultValue: "Runs and activity will appear here once this task has history." })
            : t("runLedger.empty.historyOnly", { defaultValue: "Historical runs without liveness metadata will appear here once linked to this task." })}
        </div>
      ) : (
        <div className="space-y-1.5">
          {feedItems.slice(0, 20).map((item) => {
            if (item.kind === "activity") {
              return <div key={`activity:${item.id}`}>{renderActivityEvent?.(item.event)}</div>;
            }
            const run = item.run;
            const liveness = livenessCopyForRun(run, retryPendingLivenessCopy, livenessCopy, pendingLivenessCopy, missingLivenessCopy);
            const stopReason = stopReasonLabel(run, t);
            const duration = formatDuration(run.startedAt, run.finishedAt, t);
            const exhausted = hasExhaustedContinuation(run);
            const continuation = continuationLabel(run);
            const retryState = describeRunRetryState(run);
            const agentName = compactAgentName(run, agentMap);
            const onBehalfOfLabel = run.responsibleUserId
              ? responsibleUserLabel(resolveUserLabel?.(run.responsibleUserId))
              : null;
            const denialCode = isResponsibleUserDenialCode(run.errorCode) ? run.errorCode : null;
            const sourceResolvedFold = readSourceResolvedWatchdogFold(run.resultJson);
            return (
              <article
                key={`run:${run.runId}`}
                className="space-y-1.5 rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-foreground">{t("runLedger.feed.runLabel", { defaultValue: "Run" })}</span>
                  <Link
                    to={`/agents/${run.agentId}/runs/${run.runId}`}
                    className="min-w-0 max-w-full truncate font-mono text-foreground hover:underline"
                  >
                    {run.runId.slice(0, 8)}
                  </Link>
                  <span>{t("runLedger.feed.byAgent", { agent: agentName, defaultValue: `by ${agentName}` })}</span>
                  {onBehalfOfLabel ? (
                    <span
                      data-testid="run-on-behalf-of"
                      className="min-w-0 max-w-full truncate text-muted-foreground"
                      title={t("runLedger.feed.actingOnBehalfOf", { agent: onBehalfOfLabel, defaultValue: `Acting on behalf of ${onBehalfOfLabel}` })}
                    >
                      {t("runLedger.feed.onBehalfOf", { defaultValue: "on behalf of" })}{" "}
                      <span className="text-foreground">{onBehalfOfLabel}</span>
                    </span>
                  ) : null}
                  <span className="rounded-md border border-border px-1.5 py-0.5 text-(length:--text-micro) capitalize text-muted-foreground">
                    {statusLabel(run.status)}
                  </span>
                  {run.isLive ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-(length:--text-micro) text-blue-700 dark:text-blue-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                      {t("runLedger.feed.liveBadge", { defaultValue: "live" })}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "rounded-md border px-1.5 py-0.5 text-(length:--text-micro) font-medium",
                      liveness.tone,
                    )}
                    title={liveness.description}
                  >
                    {liveness.label}
                  </span>
                  {exhausted ? (
                    <span className="rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-(length:--text-micro) font-medium text-red-700 dark:text-red-300">
                      {t("runLedger.feed.exhausted", { defaultValue: "Exhausted" })}
                    </span>
                  ) : null}
                  {continuation ? (
                    <span className="text-(length:--text-micro) text-muted-foreground">{continuation}</span>
                  ) : null}
                  {retryState ? (
                    <span
                      className={cn(
                        "rounded-md border px-1.5 py-0.5 text-(length:--text-micro) font-medium",
                        retryState.tone,
                      )}
                    >
                      {retryState.badgeLabel}
                    </span>
                  ) : null}
                  {run.outputSilence && runOutputSilenceCopy[run.outputSilence.level] ? (
                    <span
                      className={cn(
                        "rounded-md border px-1.5 py-0.5 text-(length:--text-micro) font-medium",
                        runOutputSilenceCopy[run.outputSilence.level]?.tone,
                      )}
                    >
                      {runOutputSilenceCopy[run.outputSilence.level]?.label}
                    </span>
                  ) : null}
                  {(() => {
                    const profile = modelProfileForRun(run);
                    if (!profile) return null;
                    const label = profile.applied === profile.requested
                      ? `Profile: ${profile.requested}`
                      : profile.applied
                        ? `Profile: ${profile.requested} → ${profile.applied}`
                        : `Profile: ${profile.requested} (unavailable)`;
                    return (
                      <span
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 text-(length:--text-micro) font-medium",
                          modelProfileBadgeTone(profile),
                        )}
                        title={modelProfileTitle(profile)}
                      >
                        {label}
                      </span>
                    );
                  })()}
                  {sourceResolvedFold ? <SourceResolvedFoldBadge /> : null}
                  <span className="ml-auto shrink-0">{formatRelativeTime(item.timestamp, t)}</span>
                </div>

                <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                  <div className="min-w-0">
                    <span className="text-foreground">{t("runLedger.feed.elapsed", { defaultValue: "Elapsed" })}</span>{" "}
                    {duration ?? t("runLedger.feed.unknownDuration", { defaultValue: "unknown" })}
                  </div>
                  <div className="min-w-0">
                    <span className="text-foreground">{t("runLedger.feed.lastUsefulAction", { defaultValue: "Last useful action" })}</span>{" "}
                    {lastUsefulActionLabel(run, t)}
                  </div>
                  <div className="min-w-0">
                    <span className="text-foreground">{t("runLedger.feed.stop", { defaultValue: "Stop" })}</span>{" "}
                    {stopStatusLabel(run, stopReason, t)}
                  </div>
                </div>

                {retryState ? (
                  <div className="rounded-md border border-border/70 bg-accent/20 px-2 py-2 text-xs leading-5 text-muted-foreground">
                    {retryState.detail ? <p>{retryState.detail}</p> : null}
                    {retryState.secondary ? <p>{retryState.secondary}</p> : null}
                    {retryState.retryOfRunId ? (
                      <p>
                        Retry of{" "}
                        <Link
                          to={`/agents/${run.agentId}/runs/${retryState.retryOfRunId}`}
                          className="font-mono text-foreground hover:underline"
                        >
                          {retryState.retryOfRunId.slice(0, 8)}
                        </Link>
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {(() => {
                  const profile = modelProfileForRun(run);
                  if (!profile?.fallbackReason || profile.applied === profile.requested) return null;
                  return (
                    <p className="min-w-0 break-words text-(length:--text-micro) leading-5 text-amber-700 dark:text-amber-300">
                      {profile.requested === "cheap"
                        ? t("runLedger.modelProfile.fallbackCheap", { defaultValue: "Cheap profile fell back to primary" })
                        : t("runLedger.modelProfile.unavailable", { requested: profile.requested, defaultValue: `${profile.requested} profile unavailable` })}
                      {": "}
                      <span className="font-mono">{profile.fallbackReason}</span>
                    </p>
                  );
                })()}

                {run.livenessReason ? (
                  <p className="min-w-0 break-words text-xs leading-5 text-muted-foreground">
                    {run.livenessReason}
                  </p>
                ) : null}

                {denialCode ? (
                  <ResponsibleUserDenialNotice
                    code={denialCode}
                    userName={run.responsibleUserId ? resolveUserLabel?.(run.responsibleUserId) : null}
                  />
                ) : null}

                {run.nextAction ? (
                  <div className="min-w-0 rounded-md bg-accent/40 px-2 py-1.5 text-xs leading-5">
                    <span className="font-medium text-foreground">{t("runLedger.feed.nextAction", { defaultValue: "Next action:" })} </span>
                    <span className="break-words text-muted-foreground">{run.nextAction}</span>
                  </div>
                ) : null}
              </article>
            );
          })}
          {feedItems.length > 20 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {t("runLedger.feed.olderItemsCount", { count: feedItems.length - 20, defaultValue: `${feedItems.length - 20} older items not shown` })}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
