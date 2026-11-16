type HotRestartShutdownPreparation = {
  skipDrain: boolean;
};

type ShutdownLogger = {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
};

/**
 * The teardown of the application services awaits the cancellation of every
 * live session. A session whose underlying query is wedged never settles, and
 * an unbounded await there keeps the process alive after it has given up the
 * HTTP listener — the board then refuses connections while the server is still
 * running (OOP-7541). The default deadline keeps the common case orderly and
 * bounds the pathological one.
 */
export const DEFAULT_SHUTDOWN_DEADLINE_MS = 30_000;

function positiveMsFromEnv(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/** Deadline for the application-service teardown. */
export function shutdownDeadlineMs(env: NodeJS.ProcessEnv = process.env): number {
  return positiveMsFromEnv(env.PAPERCLIP_SHUTDOWN_DEADLINE_MS, DEFAULT_SHUTDOWN_DEADLINE_MS);
}

/**
 * Deadline for the whole coordinated shutdown. When it expires the process
 * exits anyway, so the listener is released and the supervisor can start a
 * fresh instance.
 */
export function shutdownHardDeadlineMs(env: NodeJS.ProcessEnv = process.env): number {
  return positiveMsFromEnv(env.PAPERCLIP_SHUTDOWN_HARD_DEADLINE_MS, 120_000);
}

export type ShutdownDeadlineResult<T> =
  | { status: "completed"; value: T }
  | { status: "timed_out" }
  | { status: "failed"; error: unknown };

/**
 * Races a teardown step against a deadline. A step that overruns is reported
 * as `timed_out` rather than thrown, so the caller continues with the rest of
 * the ordered teardown instead of stalling the exit path.
 *
 * The step keeps running after the deadline; its rejection is captured by the
 * `settled` branch, so a late failure can never surface as an unhandled
 * rejection.
 */
export async function withShutdownDeadline<T>(input: {
  task: Promise<T> | undefined;
  deadlineMs: number;
}): Promise<ShutdownDeadlineResult<T>> {
  if (!input.task) return { status: "completed", value: undefined as T };

  const settled = input.task.then(
    (value) => ({ status: "completed" as const, value }),
    (error: unknown) => ({ status: "failed" as const, error }),
  );
  const timedOut = new Promise<{ status: "timed_out" }>((resolve) => {
    const timer = setTimeout(() => resolve({ status: "timed_out" }), input.deadlineMs);
    timer.unref?.();
  });

  return Promise.race([settled, timedOut]);
}

/**
 * Runs the final, ordered teardown of the server. It awaits the application
 * service cleanup first, so a live setup-token login session stops and releases
 * its sandbox lease before the database and the provider stop. The caller runs
 * `process.exit(0)` only after this helper resolves, so an orderly shutdown
 * never leaves a sandbox lease or confidential login state alive past the
 * process exit.
 *
 * A step that rejects does not stop the teardown. The helper logs the error and
 * continues to the next step. A failed setup-token lease release stays a
 * durable record for the startup reaper; the helper surfaces it in the log
 * instead of blocking the exit path.
 */
export async function finalizeServerShutdown(input: {
  signal: "SIGINT" | "SIGTERM";
  shutdownAppServices: (() => Promise<void>) | undefined;
  stopEmbeddedPostgres: (() => Promise<void>) | null;
  shutdownInstrumentation: () => Promise<void>;
  log: ShutdownLogger;
}): Promise<void> {
  const { signal } = input;

  // Await the application service cleanup, so a live setup-token login session
  // releases its sandbox lease before the database and the provider stop. A
  // rejected cleanup stays durable for the reaper; it does not block the exit.
  // A cleanup that never settles is bounded by the shutdown deadline, so a
  // wedged session cannot keep the process alive with its listener closed.
  const appServices = await withShutdownDeadline({
    task: input.shutdownAppServices?.(),
    deadlineMs: shutdownDeadlineMs(),
  });
  if (appServices.status === "timed_out") {
    input.log.error(
      { signal, deadlineMs: shutdownDeadlineMs() },
      "Application service shutdown exceeded its deadline; continuing with the teardown",
    );
  } else if (appServices.status === "failed") {
    input.log.error({ err: appServices.error, signal }, "Application service shutdown failed");
  }

  if (input.stopEmbeddedPostgres) {
    input.log.info({ signal }, "Stopping embedded PostgreSQL");
    try {
      await input.stopEmbeddedPostgres();
    } catch (err) {
      input.log.error({ err }, "Failed to stop embedded PostgreSQL cleanly");
    }
  }

  // Flush buffered OTel spans before the process goes away; without this await
  // the exporter's final batch is dropped on exit.
  await input.shutdownInstrumentation();
}

const COORDINATED_SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

type ShutdownSignalTarget = {
  rawListeners(eventName: string): Function[];
  removeListener(eventName: string, listener: (...args: any[]) => void): unknown;
};

/**
 * Some dependencies eagerly install process signal handlers as an import side
 * effect. Paperclip must remain the sole owner of SIGINT/SIGTERM ordering: its
 * handler first snapshots live heartbeat runs and only then stops embedded
 * infrastructure. Remove only listeners added by the supplied import, while
 * preserving every listener that was already registered.
 */
export async function loadWithoutCoordinatedShutdownSignalHooks<T>(
  load: () => Promise<T>,
  signalTarget: ShutdownSignalTarget = process,
) {
  const listenersBeforeLoad = new Map(
    COORDINATED_SHUTDOWN_SIGNALS.map((signal) => [
      signal,
      signalTarget.rawListeners(signal),
    ]),
  );

  let loaded: T;
  try {
    loaded = await load();
  } finally {
    for (const signal of COORDINATED_SHUTDOWN_SIGNALS) {
      const remainingBeforeLoad = [...(listenersBeforeLoad.get(signal) ?? [])];
      for (const listener of signalTarget.rawListeners(signal)) {
        const existingIndex = remainingBeforeLoad.indexOf(listener);
        if (existingIndex >= 0) {
          remainingBeforeLoad.splice(existingIndex, 1);
          continue;
        }
        signalTarget.removeListener(signal, listener as (...args: any[]) => void);
      }
    }
  }

  return loaded;
}

export async function coordinateHeartbeatSchedulerShutdown<
  TPreparation extends HotRestartShutdownPreparation,
>(input: {
  signal: "SIGINT" | "SIGTERM";
  prepareHotRestartShutdown: ((signal: "SIGINT" | "SIGTERM") => Promise<TPreparation>) | null;
  waitForHeartbeatSchedulerIdle: () => Promise<void>;
}): Promise<{
  hotRestart: TPreparation | null;
  preparationError: unknown;
  waitedForSchedulerIdle: boolean;
}> {
  let hotRestart: TPreparation | null = null;
  let preparationError: unknown = null;

  // The signal handler stops the scheduler before entering this coordinator.
  // Quiesce any callback that was already in flight before querying running
  // rows for the shutdown snapshot, otherwise a late queue claim can create a
  // run that is absent from both the snapshot and the selective drain set.
  await input.waitForHeartbeatSchedulerIdle();

  if (input.prepareHotRestartShutdown) {
    try {
      hotRestart = await input.prepareHotRestartShutdown(input.signal);
    } catch (err) {
      preparationError = err;
    }
  }

  return {
    hotRestart,
    preparationError,
    waitedForSchedulerIdle: true,
  };
}
