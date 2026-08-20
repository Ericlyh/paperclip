import { useMemo } from "react";
// Callers pass the i18next `t`; the alias keeps the identity default assignable
// (i18next's branded TFunction type cannot be satisfied by a plain function).
type Translate = (key: string, options?: Record<string, unknown>) => string;
import {
  humanizeConnectionDisplayName,
  type Agent,
  type ToolCallEvent,
  type ToolConnectionLifecycleEvent,
} from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/timeAgo";
import { appTabHref } from "../app-tabs";
import { useTranslation } from "@/i18n";
import type { ActivityPanelProps } from "./types";

export function ActivityPanel(props: ActivityPanelProps) {
  return <RecentActivity {...props} />;
}

type TimelineRow = {
  key: string;
  createdAt: Date | string;
  primary: string;
  dotClass: string;
  /** Secondary "while working on PAP-…" issue link, tool-call rows only. */
  issue?: { identifier: string } | null;
  /** Deep-link rendered after the timestamp ("View in Setup"), lifecycle rows only. */
  link?: { to: string; label: string } | null;
};

function RecentActivity({
  events,
  lifecycleEvents,
  issues,
  actionRequests,
  loading,
  agents,
  connectionId,
  appName,
  userLabelById,
}: ActivityPanelProps) {
  const { t } = useTranslation();
  const nameById = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);

  const rows = useMemo<TimelineRow[]>(() => {
    const callRows: TimelineRow[] = events
      .filter((e) => HUMANIZED_EVENTS.has(e.eventType))
      .map((event) => {
        const row = humanizeEvent(
          event,
          nameById.get(event.agentId ?? "") ?? null,
          event.actionRequestId ? actionRequests[event.actionRequestId] : undefined,
          isTestEvent(event) ? resolveActorLabel(event.actorId, userLabelById, t) : null,
          t,
        );
        return {
          key: `call:${event.id}`,
          createdAt: event.createdAt,
          primary: row.primary,
          dotClass: dotColor(event),
          issue: event.issueId ? issues[event.issueId] ?? null : null,
        };
      });

    const setupHref = appTabHref(connectionId, "setup");
    const lifecycleRows: TimelineRow[] = lifecycleEvents.map((event) => ({
      key: `lifecycle:${event.id}`,
      createdAt: event.createdAt,
      primary: humanizeLifecycleEvent(event, appName, nameById.get(event.agentId ?? "") ?? null, t),
      dotClass: lifecycleDotColor(event),
      link: { to: setupHref, label: lifecycleLinkLabel(event, t) },
    }));

    return [...callRows, ...lifecycleRows].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [events, lifecycleEvents, issues, actionRequests, nameById, connectionId, appName, userLabelById, t]);

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-bold text-foreground">{t("activity.recentActivityTitle")}</h2>
      </div>
      {loading ? (
        <div className="space-y-2 py-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-5 text-sm text-muted-foreground">{t("apps.activityPanel.empty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key} className="flex items-start gap-3 py-3 text-sm">
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", row.dotClass)} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-foreground">{row.primary}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {row.issue ? (
                    <>
                      {t("apps.activityPanel.whileWorkingOn")}{" "}
                      <Link
                        to={`/issues/${row.issue.identifier}`}
                        className="font-medium text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {row.issue.identifier}
                      </Link>
                      {" · "}
                    </>
                  ) : null}
                  {timeAgo(row.createdAt)}
                  {row.link ? (
                    <>
                      {" · "}
                      <Link
                        to={row.link.to}
                        className="font-medium text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {row.link.label}
                      </Link>
                    </>
                  ) : null}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const HUMANIZED_EVENTS = new Set<ToolCallEvent["eventType"]>([
  "call_completed",
  "call_failed",
  "call_denied",
  "approval_requested",
  "approval_resolved",
]);

/**
 * A row is a prosumer Test-tab call (vs. a real heartbeat-driven agent run) when
 * the gateway tagged the audit event `metadata.source === "test"` (PAP-11349).
 */
export function isTestEvent(event: ToolCallEvent): boolean {
  return (event.metadata as { source?: unknown } | null)?.source === "test";
}

/** Display name for the human who ran a Test-tab call, from the company directory. */
export function resolveActorLabel(
  actorId: string | null,
  userLabelById: Map<string, string> | undefined,
  t: Translate = (key) => key,
): string {
  if (actorId) {
    const label = userLabelById?.get(actorId);
    if (label) return label;
    if (actorId === "local-board") return t("apps.activityPanel.board");
  }
  return t("apps.activityPanel.someone");
}

export function humanizeEvent(
  event: ToolCallEvent,
  agentName: string | null,
  actionRequest?: ActivityPanelProps["actionRequests"][string],
  /** When set, this row is a Test-tab call run by the named user; prefix accordingly. */
  testRunnerLabel?: string | null,
  t: Translate = (key) => key,
): { primary: string } {
  // For Test-tab calls, surface "<User> tested as <Agent>" so prosumer test runs are
  // distinguishable from real heartbeat agent activity in the audit trail (PAP-11415).
  const who = testRunnerLabel
    ? `${testRunnerLabel} tested as ${agentName ?? "an agent"}`
    : agentName ?? "An agent";
  // The raw gateway tool name is prefixed (e.g. `mcp.app-gallery-link-…:kv-set`);
  // humanize it to "Kv Set" to match the cross-app Activity view (PAP-11105).
  const action = event.toolName ? humanizeConnectionDisplayName(event.toolName) : "an action";
  switch (event.eventType) {
    case "call_completed":
      return {
        primary: event.outcome === "success"
          ? t("apps.activityPanel.callCompleted", { who, action })
          : t("apps.activityPanel.callCompletedFailure", { who, action }),
      };
    case "call_failed":
      return { primary: t("apps.activityPanel.callFailed", { who: lower(who), action }) };
    case "call_denied":
      return {
        primary: testRunnerLabel
          ? t("apps.activityPanel.callDeniedTest", { who, action })
          : t("apps.activityPanel.callDenied", { action }),
      };
    case "approval_requested":
      return { primary: t("apps.activityPanel.approvalRequested", { who, action }) };
    case "approval_resolved":
      return { primary: humanizeApprovalResolved(action, actionRequest, t) };
    default:
      return { primary: t("apps.activityPanel.callCompleted", { who, action }) };
  }
}

function humanizeApprovalResolved(
  action: string,
  actionRequest?: ActivityPanelProps["actionRequests"][string],
  t: Translate = (key) => key,
): string {
  const resolver = actionRequest?.resolverDisplayName ?? t("apps.activityPanel.someone");
  if (actionRequest?.status === "approved") return t("apps.activityPanel.approved", { resolver, action });
  if (actionRequest?.status === "rejected") return t("apps.activityPanel.rejected", { resolver, action });
  return t("apps.activityPanel.reviewed", { resolver, action });
}

/** Humanize a connection lifecycle event into a prosumer sentence (PAP-11284). */
function humanizeLifecycleEvent(
  event: ToolConnectionLifecycleEvent,
  appName: string,
  agentName: string | null,
  t: Translate = (key) => key,
): string {
  const who = event.actorDisplayName ?? agentName ?? t("apps.activityPanel.someone");
  switch (event.type) {
    case "app_connected":
      return t("apps.activityPanel.appConnected", { who, appName });
    case "app_paused":
      return t("apps.activityPanel.appPaused", { who });
    case "app_resumed":
      return t("apps.activityPanel.appResumed", { who });
    case "reconnected":
      return t("apps.activityPanel.reconnected", { who, appName });
    case "disconnected":
      return t("apps.activityPanel.disconnected", { who, appName });
    case "allowlist_changed":
      return humanizeAllowlistChange(who, event.details, t);
    case "actions_quarantined": {
      const count = numberFrom(event.details?.count);
      return t("apps.activityPanel.actionsQuarantined", { count });
    }
    default:
      return t("apps.activityPanel.appUpdated", { who });
  }
}

function humanizeAllowlistChange(
  who: string,
  details: Record<string, unknown> | null,
  t: Translate = (key) => key,
): string {
  const added = numberFrom(details?.added);
  const removed = numberFrom(details?.removed);
  if (added > 0 && removed === 0) {
    return t("apps.activityPanel.allowlistAdded", { who, count: added });
  }
  if (removed > 0 && added === 0) {
    return t("apps.activityPanel.allowlistRemoved", { who, count: removed });
  }
  if (added > 0 && removed > 0) {
    return t("apps.activityPanel.allowlistUpdated", { who, added, removed });
  }
  return t("apps.activityPanel.allowlistTouched", { who });
}

function lifecycleLinkLabel(event: ToolConnectionLifecycleEvent, t: Translate = (key) => key): string {
  return event.type === "actions_quarantined"
    ? t("apps.activityPanel.reviewInSetup")
    : t("apps.activityPanel.viewInSetup");
}

function numberFrom(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function lower(who: string): string {
  return who === "An agent" ? "an agent" : who;
}

function dotColor(event: ToolCallEvent): string {
  if (event.eventType === "call_failed" || event.outcome === "failure" || event.outcome === "timeout") {
    return "bg-red-400";
  }
  if (event.eventType === "call_denied" || event.outcome === "denied") return "bg-amber-400";
  if (event.eventType === "approval_requested") return "bg-amber-400";
  return "bg-emerald-400";
}

function lifecycleDotColor(event: ToolConnectionLifecycleEvent): string {
  if (event.type === "disconnected") return "bg-red-400";
  if (event.type === "app_paused" || event.type === "actions_quarantined") return "bg-amber-400";
  return "bg-emerald-400";
}
