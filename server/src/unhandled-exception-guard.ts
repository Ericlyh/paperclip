/**
 * A single database-driver fault must not take the whole control plane down.
 *
 * postgres.js writes a chunk with `socket.write()` from a `setImmediate` timer
 * (`connection.js` -> `nextWrite`). When the connection is torn down first,
 * `socket` is already null and the write raises
 * `TypeError: Cannot read properties of null (reading 'write')` from inside the
 * timer callback — outside any promise the server awaits. Node treats an
 * uncaught exception as fatal, so the board dies with its HTTP listener closed
 * and every agent and watchdog sees "connection refused" until a human
 * restarts it (OOP-7541).
 *
 * The guard keeps the process alive for exactly that signature. The driver
 * has already destroyed the connection, so the pool replaces it on the next
 * query; the cost of the fault is one lost write, not a dead board. Every
 * other uncaught exception keeps Node's default fatal behaviour, because
 * swallowing an arbitrary error would hide real bugs behind a wedged server.
 */

export type UncaughtExceptionLogger = {
  error(obj: object, msg: string): void;
};

// The null-socket write: `socket` is null while `nextWrite` still runs.
const NULL_SOCKET_WRITE = /Cannot read properties of null \(reading ['"]write['"]\)/;

// The frame that proves the fault came from the postgres.js driver rather than
// from application code that happened to read a property named `write`.
const DRIVER_FRAME = /postgres[^\s:]*[/\\]src[/\\]connection\.js/;

/**
 * True only for the known postgres.js null-socket write fault. Anything else
 * — including a TypeError with the same message raised by application code —
 * stays fatal.
 */
export function isRecoverableDriverFault(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  if (!NULL_SOCKET_WRITE.test(err.message ?? "")) return false;
  const stack = typeof err.stack === "string" ? err.stack : "";
  return DRIVER_FRAME.test(stack);
}

/**
 * Installs the `uncaughtException` handler. Returns a disposer so a test can
 * remove it again; the server keeps it for the life of the process.
 */
export function installUnhandledExceptionGuard(
  log: UncaughtExceptionLogger,
  options?: { onFatal?: (err: unknown) => void; exit?: (code: number) => void },
): () => void {
  const exit = options?.exit ?? ((code: number) => process.exit(code));

  const handler = (err: unknown) => {
    if (isRecoverableDriverFault(err)) {
      log.error(
        { err },
        "Recovered from a database driver fault (null socket write); the pool reconnects on the next query",
      );
      return;
    }
    log.error({ err }, "Uncaught exception; exiting");
    options?.onFatal?.(err);
    exit(1);
  };

  process.on("uncaughtException", handler);
  return () => process.off("uncaughtException", handler);
}
