import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repoRoot, "scripts", "run-vitest-stable.mjs");

// A stub `pnpm` that records every invocation and fails the first N of them.
// The runner resolves `pnpm` from PATH, so stubbing it exercises the runner's
// failure handling without paying for a real vitest run.
function createFakePnpm(dir) {
  const binDir = path.join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const pnpmPath = path.join(binDir, "pnpm");
  writeFileSync(
    pnpmPath,
    [
      "#!/bin/sh",
      'echo "$@" >> "$FAKE_PNPM_LOG"',
      'count=$(wc -l < "$FAKE_PNPM_LOG" | tr -d " ")',
      'if [ "$count" -le "$FAKE_PNPM_FAIL_COUNT" ]; then',
      '  echo "fake pnpm: simulated failure" >&2',
      "  exit 1",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(pnpmPath, 0o755);
  return { binDir, logPath: path.join(dir, "invocations.log") };
}

function runRunner(args, failCount) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pcvt-fake-pnpm-"));
  const { binDir, logPath } = createFakePnpm(dir);
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      FAKE_PNPM_LOG: logPath,
      FAKE_PNPM_FAIL_COUNT: String(failCount),
    },
  });
  const invocations = existsSync(logPath)
    ? readFileSync(logPath, "utf8").split("\n").filter((line) => line.length > 0)
    : [];
  return { ...result, invocations };
}

function dryRunJson(args) {
  const result = spawnSync(process.execPath, [script, ...args, "--dry-run"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `expected success for ${args.join(" ")}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

// general-server is a single invocation; the two workspaces groups run one
// invocation per project.
function expectedGeneralInvocationCount() {
  const workspacesA = dryRunJson(["--mode", "general", "--group", "general-workspaces-a"]);
  const workspacesB = dryRunJson(["--mode", "general", "--group", "general-workspaces-b"]);
  return 1 + workspacesA.workspaceProjects.length + workspacesB.workspaceProjects.length;
}

test("a failing general group does not stop the groups after it", () => {
  const expected = expectedGeneralInvocationCount();
  const result = runRunner(["--mode", "general"], 1);

  assert.equal(result.status, 1, "the run must still fail");
  assert.equal(
    result.invocations.length,
    expected,
    "every general group must run even after an earlier group failed",
  );
  assert.match(result.stderr, /1 invocation\(s\) failed/, "the failures must be summarized");
  assert.match(result.stderr, /general-server/, "the summary must name the failing group");
});

test("a failing general group does not hide a later group's failures", () => {
  const workspacesB = dryRunJson(["--mode", "general", "--group", "general-workspaces-b"]);
  const laterProject = workspacesB.workspaceProjects[0];
  const result = runRunner(["--mode", "general"], 1);

  assert.ok(
    result.invocations.some((invocation) => invocation.includes(`--project ${laterProject}`)),
    `${laterProject} must still run after general-server failed`,
  );
});

test("an all-green general run exits 0 and summarizes nothing", () => {
  const expected = expectedGeneralInvocationCount();
  const result = runRunner(["--mode", "general"], 0);

  assert.equal(result.status, 0, `expected a green run: ${result.stderr}`);
  assert.equal(result.invocations.length, expected);
  assert.doesNotMatch(result.stderr, /invocation\(s\) failed/);
});

test("the serialized lane still stops at the first failing suite", () => {
  const result = runRunner(["--mode", "serialized"], 1);

  assert.equal(result.status, 1, "the shard must still fail");
  assert.equal(
    result.invocations.length,
    1,
    "serialized suites run one at a time, so a failing suite must end the shard",
  );
});
