import { useEffect, useState } from "react";
// module-level t: pure helper, no React hook (hard rule 4)
import { t } from "../i18n";
import { useTranslation } from "../i18n";
import { AlertTriangle, RotateCcw, TimerReset } from "lucide-react";
import { healthApi, type DevServerHealthStatus } from "../api/health";
import { Badge } from "@/components/ui/badge";

const RESTART_PENDING_RESET_MS = 30_000;

function formatRelativeTimestamp(value: string | null): string | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;

  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) return t("time.justNow", { defaultValue: "just now" });
  const deltaMinutes = Math.round(deltaMs / 60_000);
  if (deltaMinutes < 60) return t("time.minutesAgo", { value: deltaMinutes, defaultValue: `${deltaMinutes}m ago` });
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) return t("time.hoursAgo", { value: deltaHours, defaultValue: `${deltaHours}h ago` });
  const deltaDays = Math.round(deltaHours / 24);
  return t("time.daysAgo", { value: deltaDays, defaultValue: `${deltaDays}d ago` });
}

function describeReason(devServer: DevServerHealthStatus): string {
  if (devServer.reason === "backend_changes_and_pending_migrations") {
    return t("devRestart.reason.backendChangesAndPendingMigrations", {
      defaultValue: "backend files changed and migrations are pending",
    });
  }
  if (devServer.reason === "pending_migrations") {
    return t("devRestart.reason.pendingMigrations", {
      defaultValue: "pending migrations need a fresh boot",
    });
  }
  return t("devRestart.reason.backendChangesSinceBoot", {
    defaultValue: "backend files changed since this server booted",
  });
}

export function DevRestartBanner({ devServer }: { devServer?: DevServerHealthStatus }) {
  const { t } = useTranslation();
  const [restartPending, setRestartPending] = useState(false);
  useEffect(() => {
    if (!restartPending) return;
    const timeout = window.setTimeout(() => {
      setRestartPending(false);
    }, RESTART_PENDING_RESET_MS);
    return () => window.clearTimeout(timeout);
  }, [restartPending]);

  if (!devServer?.enabled || !devServer.restartRequired) return null;

  const currentDevServer = devServer;
  const changedAt = formatRelativeTimestamp(devServer.lastChangedAt);
  const sample = devServer.changedPathsSample.slice(0, 3);
  const activeRunLabel = `${devServer.activeRunCount} live run${
    devServer.activeRunCount === 1 ? "" : "s"
  }`;

  async function requestRestartNow() {
    const warning =
      currentDevServer.activeRunCount > 0
        ? t("devRestart.confirm.restartWithRuns", {
            count: currentDevServer.activeRunCount,
            defaultValue: `Restart Paperclip now? This may interrupt ${currentDevServer.activeRunCount} live run${
              currentDevServer.activeRunCount === 1 ? "" : "s"
            }.`,
          })
        : t("devRestart.confirm.restart", { defaultValue: "Restart Paperclip now?" });
    if (!window.confirm(warning)) return;

    setRestartPending(true);
    try {
      await healthApi.requestDevServerRestart();
    } catch (error) {
      setRestartPending(false);
      window.alert(
        error instanceof Error
          ? error.message
          : t("devRestart.alert.failed", { defaultValue: "Failed to request restart" }),
      );
    }
  }

  return (
    <div className="border-b border-amber-300/60 bg-amber-50 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="flex flex-col gap-3 px-3 py-2.5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-(--tracking-caps)">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{t("devRestart.title", { defaultValue: "Restart Required" })}</span>
            {devServer.autoRestartEnabled ? (
              <Badge variant="ghost" className="bg-amber-900/10 text-(length:--text-nano) tracking-(--tracking-eyebrow) dark:bg-amber-100/10">
                {t("devRestart.autoRestartOn", { defaultValue: "Auto-Restart On" })}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm">
            {describeReason(devServer)}
            {changedAt
              ? ` · ${t("devRestart.updatedSuffix", { value: changedAt, defaultValue: `updated ${changedAt}` })}`
              : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-900/80 dark:text-amber-100/75">
            {sample.length > 0 ? (
              <span>
                {t("devRestart.changedPaths", { defaultValue: "Changed:" })}{" "}
                {sample.join(", ")}
                {devServer.changedPathCount > sample.length
                  ? ` ${t("devRestart.moreCount", {
                      count: devServer.changedPathCount - sample.length,
                      defaultValue: `+${devServer.changedPathCount - sample.length} more`,
                    })}`
                  : ""}
              </span>
            ) : null}
            {devServer.pendingMigrations.length > 0 ? (
              <span>
                {t("devRestart.pendingMigrations", { defaultValue: "Pending migrations:" })}{" "}
                {devServer.pendingMigrations.slice(0, 2).join(", ")}
                {devServer.pendingMigrations.length > 2
                  ? ` ${t("devRestart.moreCount", {
                      count: devServer.pendingMigrations.length - 2,
                      defaultValue: `+${devServer.pendingMigrations.length - 2} more`,
                    })}`
                  : ""}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-medium md:justify-end">
          {devServer.waitingForIdle ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-900/10 px-3 py-1.5 dark:bg-amber-100/10">
              <TimerReset className="h-3.5 w-3.5" />
              <span>
                {t("devRestart.waitingForIdle", {
                  activeRunLabel,
                  defaultValue: `Waiting for ${activeRunLabel} to finish`,
                })}
              </span>
            </div>
          ) : devServer.autoRestartEnabled ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-900/10 px-3 py-1.5 dark:bg-amber-100/10">
              <RotateCcw className="h-3.5 w-3.5" />
              <span>
                {t("devRestart.autoRestartWhenIdle", {
                  defaultValue: "Auto-restart will trigger when the instance is idle",
                })}
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-900/10 px-3 py-1.5 dark:bg-amber-100/10">
              <RotateCcw className="h-3.5 w-3.5" />
              <span>
                {t("devRestart.manualRestartHint", {
                  command: "pnpm dev:once",
                  interpolation: { escapeValue: false },
                  defaultValue: "Restart pnpm dev:once after the active work is safe to interrupt",
                }).split("pnpm dev:once").map((part, index, parts) => (
                  <span key={index}>
                    {part}
                    {index < parts.length - 1 ? <code>pnpm dev:once</code> : null}
                  </span>
                ))}
              </span>
            </div>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md bg-amber-950 px-3 py-1.5 text-xs font-semibold text-amber-50 transition-colors hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
            onClick={() => {
              void requestRestartNow();
            }}
            disabled={restartPending}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>
              {restartPending
                ? t("devRestart.button.restartRequested", { defaultValue: "Restart requested" })
                : t("devRestart.button.restartNow", { defaultValue: "Restart now" })}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
