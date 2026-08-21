import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, RotateCw, Server, Square } from "lucide-react";
import type { TFunction } from "i18next";
import type {
  ToolConnection,
  ToolRuntimeAlertRecommendation,
  ToolRuntimeMetricSnapshot,
  ToolRuntimeSlot,
} from "@paperclipai/shared";
import { humanizeConnectionDisplayName, isToolConnectionAttentionHealth } from "@paperclipai/shared";
import { useTranslation } from "@/i18n";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Link } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";
import { toolsApi } from "@/api/tools";
import { ApiError } from "@/api/client";
import { useToast } from "@/context/ToastContext";
import { EmptyState } from "@/components/EmptyState";
import { ToolsPageHeader, LoadingState, ErrorState, RelativeTime } from "./shared";

/** Working / Needs attention / Off — the only status vocabulary on this surface. */
type RowStatus = "working" | "attention" | "off";

/**
 * A running-app row: a runtime slot joined to the connection it powers so we can
 * humanize its name and link to its `/apps/:connectionId` page. Status is derived
 * from the connection's health via `isToolConnectionAttentionHealth()` (with a
 * slot-health fallback) so the Apps index, app detail, and Health never disagree.
 */
interface RuntimeRow {
  slot: ToolRuntimeSlot;
  connection: ToolConnection | null;
  name: string;
  isLocal: boolean;
  status: RowStatus;
}

/** A health value that means the runtime slot itself is unhealthy. */
function slotHealthNeedsAttention(health: string | null | undefined): boolean {
  return health === "error" || health === "unhealthy" || health === "failed" || health === "degraded";
}

function rowStatusFor(slot: ToolRuntimeSlot, connection: ToolConnection | null): RowStatus {
  if (slot.status === "stopped" || slot.status === "disabled") return "off";
  if (connection && isToolConnectionAttentionHealth(connection.healthStatus)) return "attention";
  if (slot.status === "failed" || slot.status === "error") return "attention";
  if (slotHealthNeedsAttention(slot.healthStatus)) return "attention";
  return "working";
}

/** Filled dot (working) / triangle (needs attention) / hollow dot (off). */
function StatusMarker({ status }: { status: RowStatus }) {
  if (status === "attention") {
    return <span className="text-amber-600 dark:text-amber-400">▲</span>;
  }
  if (status === "off") {
    return <span className="inline-block h-2.5 w-2.5 rounded-full border border-muted-foreground/50" />;
  }
  return <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />;
}

function humanizeRowName(slot: ToolRuntimeSlot, connection: ToolConnection | null): string {
  if (connection) return humanizeConnectionDisplayName(connection);
  return humanizeConnectionDisplayName(slot.commandTemplateKey ?? slot.providerRef ?? slot.id.slice(0, 8));
}

/** Plain-words latency: "about 1.2s" / "about 240ms" / "—". */
function formatTypicalLatency(ms: number | null | undefined, t: TFunction): string {
  if (typeof ms !== "number" || Number.isNaN(ms)) return "—";
  if (ms >= 950) return t("runtimeTab.aboutSeconds", { value: (ms / 1000).toFixed(1) });
  return t("runtimeTab.aboutMillis", { value: Math.round(ms) });
}

/** How the slot runs, in plain words. */
function howItRuns(slot: ToolRuntimeSlot, t: TFunction): string {
  return slot.runtimeKind === "local_stdio"
    ? t("runtimeTab.runsOnThisMachine")
    : t("runtimeTab.connectsOverTheInternet");
}

/** Humanize the owner scope into a plain phrase. */
function scopeLabel(scope: string | null | undefined, t: TFunction): string {
  switch (scope) {
    case "company":
      return t("runtimeTab.scope.company");
    case "project":
    case "project_workspace":
      return t("runtimeTab.scope.project");
    case "execution_workspace":
    case "issue":
      return t("runtimeTab.scope.task");
    case "agent":
      return t("runtimeTab.scope.agent");
    default:
      return scope ? scope.replace(/[_-]+/g, " ") : "—";
  }
}

/** Plain-words trust tier — quarantined local code reads as such; remote is provider-side. */
function trustTierLabel(slot: ToolRuntimeSlot, t: TFunction): string {
  if (slot.runtimeKind !== "local_stdio") return t("runtimeTab.trustTier.providerVerified");
  const quarantined =
    slot.status === "failed" ||
    slot.status === "error" ||
    slot.healthStatus === "error" ||
    slot.healthStatus === "unhealthy";
  return quarantined ? t("runtimeTab.trustTier.quarantined") : t("runtimeTab.trustTier.trustedLocal");
}

/**
 * Plain-language translation for each supervisor alert. The runbook/severity
 * vocabulary stays out of these — it lives in the card's "Technical details".
 * `action` picks the one suggested button: restart the failing app, or a link to
 * the surface where the admin resolves it.
 */
type AlertAction = "restart" | "reviewApps" | "reviewActivity";
const ALERT_KEYS: Record<string, { titleKey: string; bodyKey: string; action: AlertAction }> = {
  mcp_runtime_stuck_starting_slot: {
    titleKey: "stuckStartingTitle",
    bodyKey: "stuckStartingBody",
    action: "restart",
  },
  mcp_runtime_stuck_running_slot: {
    titleKey: "stuckRunningTitle",
    bodyKey: "stuckRunningBody",
    action: "restart",
  },
  mcp_runtime_high_timeout_rate: {
    titleKey: "highTimeoutTitle",
    bodyKey: "highTimeoutBody",
    action: "reviewActivity",
  },
  mcp_runtime_high_error_rate: {
    titleKey: "highErrorTitle",
    bodyKey: "highErrorBody",
    action: "reviewActivity",
  },
  mcp_runtime_capacity_deferrals_repeated: {
    titleKey: "capacityTitle",
    bodyKey: "capacityBody",
    action: "reviewActivity",
  },
  mcp_runtime_restart_storm: {
    titleKey: "restartStormTitle",
    bodyKey: "restartStormBody",
    action: "restart",
  },
  mcp_runtime_connection_health_degraded: {
    titleKey: "healthDegradedTitle",
    bodyKey: "healthDegradedBody",
    action: "reviewApps",
  },
  mcp_runtime_missing_secret_failures: {
    titleKey: "missingSecretTitle",
    bodyKey: "missingSecretBody",
    action: "reviewApps",
  },
  mcp_runtime_audit_write_failures: {
    titleKey: "auditWriteTitle",
    bodyKey: "auditWriteBody",
    action: "reviewActivity",
  },
};

function plainAlertTitle(alert: ToolRuntimeAlertRecommendation, t: TFunction): string {
  const key = ALERT_KEYS[alert.name]?.titleKey;
  return key ? t(`runtimeTab.alerts.${key}`) : alert.description;
}
function plainAlertBody(alert: ToolRuntimeAlertRecommendation, t: TFunction): string {
  const key = ALERT_KEYS[alert.name]?.bodyKey;
  if (!key) return alert.observed;
  return t(`runtimeTab.alerts.${key}`, { observed: alert.observed.toLowerCase() });
}
function alertAction(alert: ToolRuntimeAlertRecommendation): AlertAction {
  return ALERT_KEYS[alert.name]?.action ?? "reviewActivity";
}

interface ConfirmTarget {
  kind: "stop" | "restart";
  slotId: string;
  name: string;
}

/** One plain-number summary card with an optional ops-vocabulary tooltip. */
function SummaryCard({
  label,
  value,
  note,
  detail,
}: {
  label: string;
  value: string;
  note?: string;
  detail?: string;
}) {
  const labelEl = detail ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help border-b border-dotted border-muted-foreground/40 text-xs font-semibold text-muted-foreground">
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{detail}</TooltipContent>
    </Tooltip>
  ) : (
    <span className="text-xs font-semibold text-muted-foreground">{label}</span>
  );
  return (
    <Card className="py-0">
      <CardContent className="space-y-1.5 px-5 py-4">
        <div>{labelEl}</div>
        <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{note ?? " "}</div>
      </CardContent>
    </Card>
  );
}

function LivePill() {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          {t("runtimeTab.live")}
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("runtimeTab.liveTooltip")}</TooltipContent>
    </Tooltip>
  );
}

/** Card-level "Technical details" / row-level expander toggle. */
function Disclosure({ open, label }: { open: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
      {label}
    </span>
  );
}

export function RuntimeTab({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { pushToast } = useToast();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [openAlertDetails, setOpenAlertDetails] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);

  const slots = useQuery({
    queryKey: queryKeys.tools.runtimeSlots(companyId),
    queryFn: () => toolsApi.listRuntimeSlots(companyId),
    refetchInterval: 15_000,
  });
  const health = useQuery({
    queryKey: queryKeys.tools.runtimeHealth(companyId),
    queryFn: () => toolsApi.getRuntimeHealth(companyId),
    refetchInterval: 15_000,
  });
  const connections = useQuery({
    queryKey: queryKeys.tools.connections(companyId),
    queryFn: () => toolsApi.listConnections(companyId),
    refetchInterval: 15_000,
  });

  const invalidateRuntime = () => {
    qc.invalidateQueries({ queryKey: queryKeys.tools.runtimeSlots(companyId) });
    qc.invalidateQueries({ queryKey: queryKeys.tools.runtimeHealth(companyId) });
    qc.invalidateQueries({ queryKey: queryKeys.tools.connections(companyId) });
  };

  const stopSlot = useMutation({
    mutationFn: (slotId: string) => toolsApi.stopRuntimeSlot(companyId, slotId),
    onSuccess: () => {
      invalidateRuntime();
      pushToast({ title: t("runtimeTab.toast.appStopped"), tone: "success" });
    },
    onError: (err) =>
      pushToast({ title: t("runtimeTab.toast.stopFailed"), body: err instanceof ApiError ? err.message : String(err), tone: "error" }),
    onSettled: () => setConfirm(null),
  });

  const restartSlot = useMutation({
    mutationFn: (slotId: string) => toolsApi.restartRuntimeSlot(companyId, slotId),
    onSuccess: () => {
      invalidateRuntime();
      pushToast({ title: t("runtimeTab.toast.appRestarted"), tone: "success" });
    },
    onError: (err) =>
      pushToast({ title: t("runtimeTab.toast.restartFailed"), body: err instanceof ApiError ? err.message : String(err), tone: "error" }),
    onSettled: () => setConfirm(null),
  });

  const rows = useMemo<RuntimeRow[]>(() => {
    const list = slots.data?.runtimeSlots ?? [];
    const byId = new Map((connections.data?.connections ?? []).map((c) => [c.id, c] as const));
    return list.map((slot) => {
      const connection = slot.connectionId ? byId.get(slot.connectionId) ?? null : null;
      return {
        slot,
        connection,
        name: humanizeRowName(slot, connection),
        isLocal: slot.runtimeKind === "local_stdio",
        status: rowStatusFor(slot, connection),
      };
    });
  }, [slots.data, connections.data]);

  if (slots.isLoading || health.isLoading || connections.isLoading) return <LoadingState />;
  if (slots.error || health.error) {
    return (
      <ErrorState
        error={slots.error ?? health.error}
        onRetry={() => {
          slots.refetch();
          health.refetch();
          connections.refetch();
        }}
      />
    );
  }

  const metrics = health.data?.metrics as ToolRuntimeMetricSnapshot | undefined;
  const firingAlerts = (health.data?.alerts ?? []).filter((a) => a.status === "firing");

  const workingCount = rows.filter((r) => r.status === "working").length;
  const attentionCount = rows.filter((r) => r.status === "attention").length;
  const totalCount = rows.length;
  const localAttentionRow = rows.find((r) => r.status === "attention" && r.isLocal) ?? null;

  const errors = (metrics?.toolFailuresLastHour ?? 0) + (metrics?.toolTimeoutsLastHour ?? 0);

  const beginRestart = (row: RuntimeRow) =>
    setConfirm({ kind: "restart", slotId: row.slot.id, name: row.name });
  const beginStop = (row: RuntimeRow) => setConfirm({ kind: "stop", slotId: row.slot.id, name: row.name });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <ToolsPageHeader title={t("runtimeTab.healthTitle")} description={t("runtimeTab.healthDescription")} />
        <LivePill />
      </div>

      {/* Summary strip — plain words; ops vocabulary lives in tooltips. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard
          label={t("runtimeTab.appsRunning")}
          value={totalCount === 0 ? t("common.none") : t("runtimeTab.appsRunningValue", { working: workingCount, total: totalCount })}
          note={
            totalCount === 0
              ? t("runtimeTab.appsStartWhenNeeded")
              : attentionCount > 0
                ? attentionCount === 1
                  ? t("runtimeTab.needsAttentionOne")
                  : t("runtimeTab.needsAttentionOther", { count: attentionCount })
                : t("runtimeTab.allWorking")
          }
        />
        <SummaryCard
          label={t("runtimeTab.typicalResponseTime")}
          value={formatTypicalLatency(metrics?.averageToolLatencyMsLastHour, t)}
          note={
            metrics?.averageToolLatencyMsLastHour == null
              ? t("runtimeTab.noCallsInLastHour")
              : (metrics?.timeoutRateLastHour ?? 0) >= 10
                ? t("runtimeTab.slowerThanUsual")
                : t("runtimeTab.acrossAllApps")
          }
          detail={t("runtimeTab.latencyDetail", {
            p95: formatTypicalLatency(metrics?.p95ToolLatencyMsLastHour, t),
            rate: metrics?.timeoutRateLastHour ?? 0,
          })}
        />
        <SummaryCard
          label={t("runtimeTab.errorsLastHour")}
          value={String(errors)}
          note={errors === 0 ? t("common.none") : t("runtimeTab.acrossYourApps")}
          detail={t("runtimeTab.errorsDetail", {
            failures: metrics?.toolFailuresLastHour ?? 0,
            timeouts: metrics?.toolTimeoutsLastHour ?? 0,
            capacity: metrics?.capacityDeferralsLastHour ?? 0,
          })}
        />
      </div>

      {/* Needs-attention cards — one per firing supervisor alert, in plain words. */}
      {firingAlerts.map((alert) => {
        const action = alertAction(alert);
        const detailsOpen = openAlertDetails[alert.name] ?? false;
        return (
          <Card key={alert.name} className="overflow-hidden border-foreground/30 py-0">
            <CardContent className="relative space-y-3 py-4 pl-6">
              <span className="absolute inset-y-0 left-0 w-1.5 bg-foreground" />
              <div>
                <p className="text-base font-bold text-foreground">▲ {plainAlertTitle(alert, t)}</p>
                <p className="mt-1 max-w-2xl text-sm text-foreground/80">{plainAlertBody(alert, t)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                {action === "restart" && localAttentionRow ? (
                  <Button size="sm" onClick={() => beginRestart(localAttentionRow)}>
                    <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                    {t("runtimeTab.restartName", { name: localAttentionRow.name })}
                  </Button>
                ) : action === "reviewApps" ? (
                  <Button size="sm" asChild>
                    <Link to="/apps/attention">{t("runtimeTab.reviewApps")}</Link>
                  </Button>
                ) : (
                  <Button size="sm" asChild>
                    <Link to="/apps/advanced/audit">{t("runtimeTab.reviewActivity")}</Link>
                  </Button>
                )}
                <button
                  type="button"
                  className="text-left"
                  onClick={() => setOpenAlertDetails((s) => ({ ...s, [alert.name]: !detailsOpen }))}
                >
                  <Disclosure open={detailsOpen} label={t("runtimeTab.technicalDetails")} />
                </button>
              </div>
              {detailsOpen ? (
                <dl className="grid grid-cols-1 gap-x-8 gap-y-2 rounded-md bg-muted/40 p-3 text-xs sm:grid-cols-2">
                  <Fact label={t("runtimeTab.fact.alert")} value={<span className="font-mono">{alert.name}</span>} />
                  <Fact label={t("runtimeTab.fact.severity")} value={alert.severity} />
                  <Fact label={t("runtimeTab.fact.threshold")} value={alert.threshold} />
                  <Fact label={t("runtimeTab.fact.observed")} value={alert.observed} />
                  <Fact label={t("runtimeTab.fact.firstResponder")} value={alert.firstResponderAction} />
                  <Fact label={t("runtimeTab.fact.runbook")} value={<span className="font-mono">{alert.runbookSection || health.data?.runbookPath}</span>} />
                </dl>
              ) : null}
            </CardContent>
          </Card>
        );
      })}

      {/* Status table — one row per running app. */}
      {totalCount === 0 ? (
        <EmptyState
          icon={Server}
          message={t("runtimeTab.emptyStateTitle")}
          description={t("runtimeTab.emptyStateDescription")}
        />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0 py-0">
            <div className="px-5 pb-1 pt-4">
              <h3 className="text-base font-bold text-foreground">{t("runtimeTab.runningApps")}</h3>
              <p className="text-xs text-muted-foreground">{t("runtimeTab.runningAppsHint")}</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                  <th className="px-5 py-2.5">{t("runtimeTab.col.app")}</th>
                  <th className="px-3 py-2.5">{t("runtimeTab.col.status")}</th>
                  <th className="px-3 py-2.5">{t("runtimeTab.col.lastUsed")}</th>
                  <th className="px-5 py-2.5 text-right">{t("runtimeTab.col.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  const open = expanded[row.slot.id] ?? false;
                  const busy =
                    (stopSlot.isPending && stopSlot.variables === row.slot.id) ||
                    (restartSlot.isPending && restartSlot.variables === row.slot.id);
                  return (
                    <RuntimeRowView
                      key={row.slot.id}
                      row={row}
                      open={open}
                      busy={busy}
                      onToggle={() => setExpanded((s) => ({ ...s, [row.slot.id]: !open }))}
                      onRestart={() => beginRestart(row)}
                      onStop={() => beginStop(row)}
                    />
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">{t("runtimeTab.remoteFootnote")}</p>

      <ConfirmDialog
        target={confirm}
        pending={stopSlot.isPending || restartSlot.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === "restart") restartSlot.mutate(confirm.slotId);
          else stopSlot.mutate(confirm.slotId);
        }}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}

function RuntimeRowView({
  row,
  open,
  busy,
  onToggle,
  onRestart,
  onStop,
}: {
  row: RuntimeRow;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onRestart: () => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const { slot, connection, name, isLocal, status } = row;
  const canControl = isLocal && status !== "off";
  return (
    <>
      <tr className="cursor-pointer align-middle hover:bg-accent/40" onClick={onToggle}>
        <td className="px-5 py-2.5">
          <div className="flex items-center gap-2.5">
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
            <StatusMarker status={status} />
            {connection ? (
              <Link
                to={`/apps/${connection.id}`}
                className="font-semibold text-foreground hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {name}
              </Link>
            ) : (
              <span className="font-semibold text-foreground">{name}</span>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5">
          <span className={status === "attention" ? "font-semibold text-foreground" : "text-foreground"}>
            {t(`runtimeTab.status.${status}`)}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <RelativeTime value={slot.lastUsedAt} />
        </td>
        <td className="px-5 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
          {isLocal ? (
            <Button size="sm" variant="outline" disabled={busy || status === "off"} onClick={onRestart}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCw className="mr-1.5 h-3.5 w-3.5" />}
              {t("runtimeTab.restart")}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">{t("runtimeTab.runsOnProviderSide")}</span>
          )}
        </td>
      </tr>
      {open ? (
        <tr className="bg-muted/40">
          <td colSpan={4} className="px-5 py-4">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-3">
              <Fact label={t("runtimeTab.fact.slotKey")} value={<span className="font-mono text-xs">{slot.slotKey ?? slot.commandTemplateKey ?? slot.id}</span>} />
              <Fact label={t("runtimeTab.fact.howItRuns")} value={howItRuns(slot, t)} />
              <Fact label={t("runtimeTab.fact.processId")} value={slot.processId ?? "—"} />
              <Fact label={t("runtimeTab.fact.scope")} value={scopeLabel(slot.ownerScopeType, t)} />
              <Fact label={t("runtimeTab.fact.trustTier")} value={trustTierLabel(slot, t)} />
              <Fact label={t("runtimeTab.fact.started")} value={<RelativeTime value={slot.lastStartedAt ?? slot.startedAt} />} />
            </dl>
            {slot.lastError ? (
              <p className="mt-3 text-xs text-destructive">{t("runtimeTab.lastError", { error: slot.lastError })}</p>
            ) : null}
            <div className="mt-4 flex items-center gap-2">
              {canControl ? (
                <>
                  <Button size="sm" variant="outline" disabled={busy} onClick={onStop}>
                    {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Square className="mr-1.5 h-3.5 w-3.5" fill="currentColor" />}
                    {t("runtimeTab.stop")}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={onRestart}>
                    {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCw className="mr-1.5 h-3.5 w-3.5" />}
                    {t("runtimeTab.restart")}
                  </Button>
                </>
              ) : !isLocal ? (
                <p className="text-xs text-muted-foreground">{t("runtimeTab.rowOffRemote")}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{t("runtimeTab.rowOffLocal")}</p>
              )}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ConfirmDialog({
  target,
  pending,
  onCancel,
  onConfirm,
}: {
  target: ConfirmTarget | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const isRestart = target?.kind === "restart";
  return (
    <Dialog open={!!target} onOpenChange={(o) => (!o ? onCancel() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isRestart
              ? t("runtimeTab.confirm.restartTitle", { name: target?.name ?? "" })
              : t("runtimeTab.confirm.stopTitle", { name: target?.name ?? "" })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm text-foreground">
          {isRestart ? (
            <>
              <p>{t("runtimeTab.confirm.restartBody", { name: target?.name ?? "" })}</p>
              <p className="text-xs text-muted-foreground">{t("runtimeTab.confirm.restartNote")}</p>
            </>
          ) : (
            <>
              <p>{t("runtimeTab.confirm.stopBody", { name: target?.name ?? "" })}</p>
              <p className="text-xs text-muted-foreground">{t("runtimeTab.confirm.stopNote")}</p>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {isRestart ? t("runtimeTab.restart") : t("runtimeTab.stop")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
