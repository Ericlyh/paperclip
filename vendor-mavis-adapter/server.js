// @paperclipai/adapter-mavis-local — server-side execute function
// Drives the mavis daemon (MiniMax Code's engine) via its CLI:
//   1. mavis session new <agent> --from root --prompt <task>   (start a session)
//   2. poll `mavis session info <sid>` until status=finished
//   3. mavis session messages <sid>                              (read result)
//   4. mavis usage session <sid>                                 (read token counts)
// Returns a Paperclip AdapterExecutionResult.

import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------
function cfgString(v) {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function cfgNumber(v) {
  return typeof v === "number" ? v : undefined;
}
function cfgStringOr(v, fallback) {
  return cfgString(v) || fallback;
}
function cfgNumberOr(v, fallback) {
  return typeof v === "number" ? v : fallback;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const DEFAULT_BIN = "/host-mavis/bin/minimax";
const DEFAULT_AGENT = "general";
const DEFAULT_TIMEOUT_SEC = 600;          // 10 min total (create + poll + reads)
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_CREATE_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_TIMEOUT_MS = 10_000;
const TERMINAL_STATUSES = new Set(["finished", "error", "aborted", "cancelled"]);
const PROVIDER = "minimax";
const MODEL = "MiniMax-M3";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseSessionId(output) {
  // mavis CLI output looks like: "Root session created: mvs_<32hex>\n{...json...}"
  // Try the regex first (works on human-readable output), then JSON.
  const sidMatch = output.match(/mvs_[a-f0-9]{32}/);
  if (sidMatch) return sidMatch[0];
  try {
    const parsed = JSON.parse(output);
    return parsed.sessionId || parsed.session_id || null;
  } catch {
    return null;
  }
}

function runMavis(bin, args, timeoutMs) {
  return execFileSync(bin, args, {
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024, // 16 MB; messages can be large
  });
}

// ---------------------------------------------------------------------------
// Main execute
// ---------------------------------------------------------------------------
export async function execute(ctx) {
  const config = ctx.agent?.adapterConfig ?? {};
  const mmcBin = cfgStringOr(config.mmcBin, DEFAULT_BIN);
  const mmcAgent = cfgStringOr(config.mmcAgent, DEFAULT_AGENT);
  const timeoutSec = cfgNumberOr(config.timeoutSec, DEFAULT_TIMEOUT_SEC);
  const pollIntervalMs = cfgNumberOr(
    config.paperclip_cli_poll_interval_ms,
    DEFAULT_POLL_INTERVAL_MS,
  );
  const useStdin = config.skip_quote_on_prompt === true;

  // Build the prompt. Paperclip provides the task in ctx.config (set by
  // the heartbeat service). Match the same field names the hermes adapter
  // uses so future migrations between adapters don't change the prompt.
  const task = String(
    ctx.config?.taskBody
      ?? ctx.config?.description
      ?? ctx.config?.body
      ?? ctx.issue?.description
      ?? ctx.issue?.body
      ?? ctx.issue?.title
      ?? ctx.task
      ?? ctx.prompt
      ?? "",
  ).trim();
  if (!task) {
    return {
      exitCode: 2,
      provider: PROVIDER,
      model: MODEL,
      errorMessage: "mavis_local: empty task (no issue body, description, or prompt found)",
    };
  }

  await safeLog(ctx, "stdout", `[mmc] Spawning mavis session on agent '${mmcAgent}'\n`);

  // ── Step 1: Create the session ─────────────────────────────────────────
  const createArgs = ["session", "new", mmcAgent, "--from", "root", "--prompt", task];
  let createOut;
  try {
    createOut = runMavis(mmcBin, createArgs, DEFAULT_CREATE_TIMEOUT_MS);
  } catch (err) {
    return {
      exitCode: 1,
      provider: PROVIDER,
      model: MODEL,
      errorMessage: `mavis session new failed: ${err.message}`,
    };
  }

  const sessionId = parseSessionId(createOut);
  if (!sessionId) {
    return {
      exitCode: 1,
      provider: PROVIDER,
      model: MODEL,
      errorMessage: `mavis_local: could not parse sessionId from: ${createOut.slice(0, 300)}`,
    };
  }
  await safeLog(ctx, "stdout", `[mmc] Session: ${sessionId}\n`);

  // ── Step 2: Poll for completion ────────────────────────────────────────
  const pollStart = Date.now();
  const pollBudgetMs = timeoutSec * 1000;
  let lastStatus = "started";
  let lastError = null;
  while (Date.now() - pollStart < pollBudgetMs) {
    await sleep(pollIntervalMs);
    let infoOut;
    try {
      infoOut = runMavis(mmcBin, ["session", "info", sessionId], DEFAULT_POLL_TIMEOUT_MS);
    } catch {
      continue; // transient — try again
    }
    let info;
    try { info = JSON.parse(infoOut); } catch { continue; }
    lastStatus = info?.status?.type ?? "unknown";
    lastError = info?.status?.message ?? null;
    if (TERMINAL_STATUSES.has(lastStatus)) break;
  }

  if (lastStatus !== "finished") {
    return {
      exitCode: 1,
      provider: PROVIDER,
      model: MODEL,
      sessionId,
      errorMessage: `mavis_local: session ${sessionId} did not finish (last status: ${lastStatus}${lastError ? `; ${lastError}` : ""})`,
    };
  }

  // ── Step 3: Read messages ──────────────────────────────────────────────
  let messages = [];
  let lastAssistantContent = "";
  try {
    const messagesOut = runMavis(mmcBin, ["session", "messages", sessionId], DEFAULT_POLL_TIMEOUT_MS);
    const parsed = JSON.parse(messagesOut);
    messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch (err) {
    await safeLog(ctx, "stdout", `[mmc] WARNING: could not parse messages: ${err.message}\n`);
  }
  // The last assistant message with msg_content is the response we want.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "assistant" && typeof m.msg_content === "string" && m.msg_content.length > 0) {
      lastAssistantContent = m.msg_content;
      break;
    }
  }
  if (!lastAssistantContent) {
    await safeLog(ctx, "stdout", `[mmc] WARNING: no assistant content in messages\n`);
  }

  // ── Step 4: Read usage (optional) ─────────────────────────────────────
  let usage = null;
  try {
    const usageOut = runMavis(mmcBin, ["usage", "session", sessionId], DEFAULT_POLL_TIMEOUT_MS);
    const parsed = JSON.parse(usageOut);
    // mavis's `usage session` shape varies; the most reliable fields are
    // totalInputTokens and totalOutputTokens at the top level.
    const inputTokens = Number(
      parsed.totalInputTokens
        ?? parsed.inputTokens
        ?? parsed.total_tokens
        ?? 0,
    );
    const outputTokens = Number(
      parsed.totalOutputTokens
        ?? parsed.outputTokens
        ?? parsed.completion_tokens
        ?? 0,
    );
    const cachedInputTokens = Number(
      parsed.totalCacheReadTokens
        ?? parsed.cacheReadInputTokens
        ?? parsed.cachedInputTokens
        ?? 0,
    );
    if (inputTokens > 0 || outputTokens > 0) {
      usage = {
        inputTokens,
        outputTokens,
        cachedInputTokens,
      };
    }
  } catch {
    // non-fatal
  }

  return {
    exitCode: 0,
    provider: PROVIDER,
    model: MODEL,
    sessionId,
    response: lastAssistantContent,
    summary: lastAssistantContent.slice(0, 2000),
    usage,
    messagesCount: messages.length,
  };
}

// ---------------------------------------------------------------------------
// testEnvironment — adapter self-check (Paperclip calls this on agent create)
// ---------------------------------------------------------------------------
export async function testEnvironment() {
  // We don't shell out here to avoid a 30s hang if mavis is down. The
  // Paperclip UI surfaces any spawn failure on the first real run.
  return { ok: true };
}

// ---------------------------------------------------------------------------
// listSkills — for adapter-catalog UI (return empty list; mavis has no
// Paperclip-discoverable skills of its own).
// ---------------------------------------------------------------------------
export async function listSkills() {
  return [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function safeLog(ctx, stream, msg) {
  try { await ctx.onLog?.(stream, msg); } catch { /* non-fatal */ }
}
