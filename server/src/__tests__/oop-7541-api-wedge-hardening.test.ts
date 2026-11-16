import { describe, expect, it, vi } from "vitest";
import {
  installUnhandledExceptionGuard,
  isRecoverableDriverFault,
} from "../unhandled-exception-guard.js";
import { resolvePreferredApiUrl } from "../runtime-api.js";
import {
  DEFAULT_SHUTDOWN_DEADLINE_MS,
  shutdownDeadlineMs,
  shutdownHardDeadlineMs,
  withShutdownDeadline,
} from "../shutdown.js";

/**
 * The exact fault that took the board down on 2026-11-07: postgres.js wrote to
 * a socket it had already nulled, from a `setImmediate` callback, so nothing
 * awaited it (OOP-7541).
 */
function nullSocketWriteFault(): TypeError {
  const err = new TypeError("Cannot read properties of null (reading 'write')");
  err.stack = [
    "TypeError: Cannot read properties of null (reading 'write')",
    "    at nextWrite (postgres/src/connection.js:255:18)",
    "    at Timeout.processImmediate (node:internal/timers:478:21)",
  ].join("\n");
  return err;
}

describe("unhandled exception guard", () => {
  it("treats the postgres.js null-socket write as recoverable", () => {
    expect(isRecoverableDriverFault(nullSocketWriteFault())).toBe(true);
  });

  it("keeps an application TypeError with the same message fatal", () => {
    const err = new TypeError("Cannot read properties of null (reading 'write')");
    err.stack = "TypeError: Cannot read properties of null (reading 'write')\n    at handler (/app/routes/x.ts:10:3)";
    expect(isRecoverableDriverFault(err)).toBe(false);
  });

  it("keeps an unrelated error fatal", () => {
    expect(isRecoverableDriverFault(new Error("boom"))).toBe(false);
    expect(isRecoverableDriverFault("not an error")).toBe(false);
  });

  it("keeps the process alive for the driver fault and exits for anything else", () => {
    const error = vi.fn();
    const exit = vi.fn();
    const dispose = installUnhandledExceptionGuard({ error }, { exit });

    process.emit("uncaughtException", nullSocketWriteFault());
    expect(exit).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);

    process.emit("uncaughtException", new Error("unrelated"));
    expect(exit).toHaveBeenCalledWith(1);

    dispose();
  });
});

describe("advertised API URL", () => {
  it("replaces a stale loopback URL that names a port the server is not listening on", () => {
    expect(
      resolvePreferredApiUrl({
        inheritedApiUrl: "http://127.0.0.1:3100",
        runtimeApiUrl: "http://127.0.0.1:3101",
        listenPort: 3101,
      }),
    ).toEqual({ url: "http://127.0.0.1:3101", replacedStaleLoopbackUrl: true });
  });

  it("keeps a loopback URL that already names the bound port", () => {
    expect(
      resolvePreferredApiUrl({
        inheritedApiUrl: "http://127.0.0.1:3100",
        runtimeApiUrl: "http://127.0.0.1:3100",
        listenPort: 3100,
      }),
    ).toEqual({ url: "http://127.0.0.1:3100", replacedStaleLoopbackUrl: false });
  });

  it("never rewrites a public or proxied URL", () => {
    expect(
      resolvePreferredApiUrl({
        inheritedApiUrl: "https://paperclip.example.com",
        runtimeApiUrl: "http://127.0.0.1:3101",
        listenPort: 3101,
      }),
    ).toEqual({ url: "https://paperclip.example.com", replacedStaleLoopbackUrl: false });
  });

  it("falls back to the runtime URL when nothing is inherited", () => {
    expect(
      resolvePreferredApiUrl({
        inheritedApiUrl: undefined,
        runtimeApiUrl: "http://127.0.0.1:3101",
        listenPort: 3101,
      }),
    ).toEqual({ url: "http://127.0.0.1:3101", replacedStaleLoopbackUrl: false });
  });
});

describe("shutdown deadline", () => {
  it("reports a completed teardown", async () => {
    const result = await withShutdownDeadline({
      task: Promise.resolve("done"),
      deadlineMs: 1000,
    });
    expect(result).toEqual({ status: "completed", value: "done" });
  });

  it("reports a teardown that never settles as timed out", async () => {
    const result = await withShutdownDeadline({
      task: new Promise<void>(() => {}),
      deadlineMs: 20,
    });
    expect(result).toEqual({ status: "timed_out" });
  });

  it("reports a failed teardown without an unhandled rejection", async () => {
    const result = await withShutdownDeadline({
      task: Promise.reject(new Error("teardown failed")),
      deadlineMs: 1000,
    });
    expect(result.status).toBe("failed");
  });

  it("reads its deadline from the environment and falls back to the default", () => {
    expect(shutdownDeadlineMs({} as NodeJS.ProcessEnv)).toBe(DEFAULT_SHUTDOWN_DEADLINE_MS);
    expect(shutdownDeadlineMs({ PAPERCLIP_SHUTDOWN_DEADLINE_MS: "5000" } as NodeJS.ProcessEnv)).toBe(5000);
    expect(shutdownDeadlineMs({ PAPERCLIP_SHUTDOWN_DEADLINE_MS: "nonsense" } as NodeJS.ProcessEnv)).toBe(
      DEFAULT_SHUTDOWN_DEADLINE_MS,
    );
    expect(shutdownHardDeadlineMs({} as NodeJS.ProcessEnv)).toBe(120_000);
  });
});
