import { parseSetupTokenPrompt, type SetupTokenPrompt } from "./setup-token-parse.js";

// The Claude `setup-token` login runner. It starts `claude setup-token` through
// an injected {@link SetupTokenPtyDriver}, surfaces the sign-in prompt one time
// in memory, accepts one browser code, and sends the code to the matched prompt.
// It handles a timeout and a cancellation, and it stops the child for every
// terminal state. This phase delivers no token.
//
// Security (secret handling): the runner treats every byte of the terminal
// stream as secret-bearing, untrusted input. It parses the stream in an in-memory
// buffer only. It drops the buffer as soon as it finds the prompt. It never
// forwards the raw text to a log or an artifact, and it never stores the raw text
// on the result. The runner reports only a fixed, non-secret status. It passes
// the prompt one time through the in-memory `onPrompt` callback. It reads the
// browser code one time through the in-memory `provideCode` callback and writes
// the code only to the child, only after it matches the prompt. The runner keeps
// the URL, the code, and any token byte out of every log line and every thrown
// error.
//
// Token delivery is a later phase. The `onCredential` seam stays closed behind
// {@link SETUP_TOKEN_CREDENTIAL_RELEASE_GATE}. While the gate is closed the runner
// never reads a credential and never invokes `onCredential`. A later phase binds
// the token parser and opens the gate.

/** The fixed Claude setup-token command. The login flow needs a PTY. */
export const CLAUDE_SETUP_TOKEN_COMMAND = "claude setup-token";

/**
 * The submission terminator for the browser code. The interactive login UI reads
 * the code on a PTY and submits it on a carriage return. So the runner appends a
 * carriage return to the code.
 */
export const CODE_SUBMISSION_TERMINATOR = "\r";

/**
 * The maximum number of characters the runner keeps for the next chunk. The
 * login prompt is small and puts the URL and the prompt line close together. A
 * sandbox can stream a large volume of output before the prompt. So after each
 * parse the runner keeps only the most recent characters up to this limit. The
 * retained buffer cannot grow without a bound across many chunks. The limit is
 * far larger than the prompt, so the trailing window never drops a real prompt
 * that spans a chunk boundary.
 */
export const CLAUDE_SETUP_TOKEN_MAX_BUFFER_CHARS = 64 * 1024;

/**
 * The release gate for the credential seam. This phase keeps the gate closed, so
 * the runner delivers no token. A later phase binds the setup-token parser and
 * opens the gate. The annotation keeps the type `boolean`, so the disabled seam
 * stays reachable to the type checker.
 */
export const SETUP_TOKEN_CREDENTIAL_RELEASE_GATE: boolean = false;

/**
 * The child side of the setup-token run. The runner never spawns the PTY
 * directly; a caller injects a concrete driver. A production driver binds these
 * methods to a PTY child that runs {@link CLAUDE_SETUP_TOKEN_COMMAND}.
 */
export interface SetupTokenPtyDriver {
  /**
   * Starts `command` in a PTY and streams the terminal output to `onData` in
   * memory. Resolves with the child exit code when the child ends. A driver must
   * not persist the raw output to any durable log.
   */
  start(command: string, onData: (chunk: string) => void): Promise<{ exitCode: number | null }>;
  /**
   * Writes `input` to the child PTY. The runner writes the browser code plus the
   * submission terminator one time, only after it matches the prompt.
   */
  write(input: string): void;
  /**
   * Stops the child process with a direct child stop. The characterization showed
   * that the child needs `SIGKILL`. The method must be safe to call before start
   * and safe to call more than one time.
   */
  stop(): void;
  /** Releases the driver resources. */
  dispose(): Promise<void>;
}

/** Receives the parsed prompt one time in memory. The caller displays it. */
export type SetupTokenPromptSink = (prompt: SetupTokenPrompt) => void;

/**
 * Returns the one browser code the user pastes from the sign-in page. The runner
 * calls it one time, only after it surfaces the prompt. The runner passes an
 * abort signal, so the provider can stop when the runner cancels or times out.
 */
export type SetupTokenCodeProvider = (signal: AbortSignal) => Promise<string>;

/**
 * Receives the credential bytes one time in memory on success. The seam stays
 * closed in this phase behind {@link SETUP_TOKEN_CREDENTIAL_RELEASE_GATE}.
 */
export type SetupTokenCredentialSink = (authBytes: Buffer) => void | Promise<void>;

export type SetupTokenOutcome = "success" | "failure" | "timeout" | "cancelled";

/** The runner result. It never carries a URL, a code, or a token byte. */
export interface SetupTokenLoginResult {
  outcome: SetupTokenOutcome;
  exitCode: number | null;
  promptSurfaced: boolean;
  codeSubmitted: boolean;
  /** Always false in this phase. The credential seam stays closed. */
  credentialDelivered: boolean;
}

export interface RunSetupTokenLoginOptions {
  /** The login command. Defaults to {@link CLAUDE_SETUP_TOKEN_COMMAND}. */
  command?: string;
  /** Receives the parsed prompt one time in memory. The caller displays it. */
  onPrompt: SetupTokenPromptSink;
  /** Returns the one browser code. The runner writes it to the matched prompt. */
  provideCode: SetupTokenCodeProvider;
  /** The closed credential seam. The runner never invokes it in this phase. */
  onCredential?: SetupTokenCredentialSink;
  /** The host-side timeout in milliseconds. */
  timeoutMs: number;
  /** An optional cancellation signal. */
  signal?: AbortSignal;
  /** A non-leaking progress sink. It receives only fixed status lines. */
  log?: (line: string) => void;
}

type RaceResult =
  | { kind: "exit"; exitCode: number | null }
  | { kind: "timeout" }
  | { kind: "cancelled" };

/**
 * Races the streaming start against the timeout and the cancellation signal. The
 * start result resolves the race; the timeout and the signal resolve the race
 * with a terminal status. A driver error rejects the race, so the caller can
 * convert it to a fixed, non-secret error. A late start rejection after the race
 * already settled is consumed here, so it never becomes an unhandled rejection.
 */
function raceStart(
  start: Promise<{ exitCode: number | null }>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<RaceResult> {
  return new Promise<RaceResult>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      run();
    };
    const timer = setTimeout(() => finish(() => resolve({ kind: "timeout" })), timeoutMs);
    const onAbort = () => finish(() => resolve({ kind: "cancelled" }));
    signal.addEventListener("abort", onAbort, { once: true });
    start.then(
      (value) => finish(() => resolve({ kind: "exit", exitCode: value.exitCode })),
      (error) => finish(() => reject(error)),
    );
  });
}

/**
 * Stops the child and releases the driver for a terminal state. The runner calls
 * this on every exit path: a normal exit, a non-zero exit, a timeout, a
 * cancellation, and an error. It first runs a direct child stop, then it disposes
 * the driver. A stop error or a dispose error must not leak or mask the result,
 * so the function swallows each error and logs a fixed line.
 */
async function stopAndDispose(driver: SetupTokenPtyDriver, log: (line: string) => void): Promise<void> {
  try {
    driver.stop();
  } catch {
    log("[paperclip] Setup-token login: the process stop step errored.");
  }
  try {
    await driver.dispose();
  } catch {
    log("[paperclip] Setup-token login: the driver dispose step errored.");
  }
}

/**
 * Runs the setup-token login through `driver`. Surfaces the prompt one time
 * through `onPrompt`. Reads the browser code one time through `provideCode` and
 * writes it to the matched prompt. Returns a fixed status. Stops the child and
 * disposes the driver for every terminal state. Never logs the raw stream, and
 * never puts a URL, a code, or a token into a log line, the result, or a thrown
 * error. Delivers no token in this phase.
 */
export async function runSetupTokenLogin(
  driver: SetupTokenPtyDriver,
  options: RunSetupTokenLoginOptions,
): Promise<SetupTokenLoginResult> {
  const { onPrompt, provideCode, onCredential, timeoutMs, signal } = options;
  const command = options.command ?? CLAUDE_SETUP_TOKEN_COMMAND;
  const log = options.log ?? (() => {});

  // A private controller that fans a timeout or a cancellation into the
  // code-input routine, so a pending `provideCode` stops when the run ends.
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  let promptSurfaced = false;
  let codeSubmitted = false;
  let submitStarted = false;
  // The code-input routine runs beside the race. It is self-guarding and never
  // rejects, so an unresolved provider cannot become an unhandled rejection.
  let submitPromise: Promise<void> = Promise.resolve();

  // The in-memory parse buffer. The runner drops it as soon as it finds the
  // prompt, so the secret-bearing stream never lives longer than one parse. The
  // runner parses the full buffer, and it includes the whole new chunk. So a
  // prompt at the start of one large chunk still parses. The runner bounds only
  // the buffer that it keeps for the next chunk to
  // {@link CLAUDE_SETUP_TOKEN_MAX_BUFFER_CHARS}. The runner keeps the trailing
  // window and drops the oldest characters.
  let buffer = "";

  // Reads the browser code and writes it to the matched prompt one time. The
  // routine never throws: it logs a fixed line on a provider error or a write
  // error, so the code never reaches a log or a thrown error.
  const submitCode = async (): Promise<void> => {
    let code: string;
    try {
      code = await provideCode(controller.signal);
    } catch {
      log("[paperclip] Setup-token login: the code input step errored.");
      return;
    }
    if (controller.signal.aborted) return;
    try {
      driver.write(code + CODE_SUBMISSION_TERMINATOR);
      codeSubmitted = true;
      log("[paperclip] Setup-token login: sent the browser code to the prompt.");
    } catch {
      log("[paperclip] Setup-token login: the code input step errored.");
    }
  };

  const onData = (chunk: string): void => {
    if (promptSurfaced) return;
    // Parse the full buffer before any truncation. This order finds an early
    // prompt inside one large chunk, so the runner never drops it.
    buffer += chunk;
    const prompt = parseSetupTokenPrompt(buffer);
    if (prompt) {
      promptSurfaced = true;
      buffer = "";
      onPrompt(prompt);
      log("[paperclip] Setup-token login: surfaced the sign-in prompt.");
      if (!submitStarted) {
        submitStarted = true;
        submitPromise = submitCode();
      }
      return;
    }
    if (buffer.length > CLAUDE_SETUP_TOKEN_MAX_BUFFER_CHARS) {
      buffer = buffer.slice(buffer.length - CLAUDE_SETUP_TOKEN_MAX_BUFFER_CHARS);
    }
  };

  const result = (outcome: SetupTokenOutcome, exitCode: number | null): SetupTokenLoginResult => ({
    outcome,
    exitCode,
    promptSurfaced,
    codeSubmitted,
    credentialDelivered: false,
  });

  try {
    if (signal?.aborted) {
      log("[paperclip] Setup-token login cancelled before start.");
      return result("cancelled", null);
    }

    const start = driver.start(command, onData);
    const raced = await raceStart(start, timeoutMs, controller.signal);
    // Release a pending code-input routine, then let it settle. The routine is
    // self-guarding, so this await never rejects.
    controller.abort();
    await submitPromise;

    if (raced.kind === "timeout") {
      log("[paperclip] Setup-token login timed out; stopping the process.");
      return result("timeout", null);
    }
    if (raced.kind === "cancelled") {
      log("[paperclip] Setup-token login cancelled; stopping the process.");
      return result("cancelled", null);
    }

    const exitCode = raced.exitCode;
    if (exitCode !== 0) {
      log("[paperclip] Setup-token login command ended with a non-zero exit code.");
      return result("failure", exitCode);
    }

    if (SETUP_TOKEN_CREDENTIAL_RELEASE_GATE && onCredential) {
      // The closed credential seam. A later phase binds the setup-token parser
      // and reads the credential here, then it invokes `onCredential`. This phase
      // keeps the gate closed, so the runner delivers no token.
    }

    log("[paperclip] Setup-token login command ended successfully.");
    return result("success", exitCode);
  } catch {
    // Convert any driver error to a fixed, non-secret error. The original error
    // may embed streamed bytes, so the runner never propagates its message.
    throw new Error("setup-token login failed: the sandbox login command errored.");
  } finally {
    if (signal) signal.removeEventListener("abort", onExternalAbort);
    // Stop a pending code-input routine, then stop the child and dispose.
    controller.abort();
    await stopAndDispose(driver, log);
  }
}
