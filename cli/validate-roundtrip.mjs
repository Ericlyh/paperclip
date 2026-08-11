// Validate CLI company import/export round-trip
import { execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DB_URL = "postgresql://paperclip:81e7f95753028853029ca6a3fa31becbebdc7a566e9824360fc76ab361434023@127.0.0.1:5432/paperclip";

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate port")));
        return;
      }
      const { port } = address;
      server.close((e) => (e ? reject(e) : resolve(port)));
    });
  });
}

async function waitForServer(apiBase, child, output, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error("Server exited early:\nSTDOUT:\n" + output.stdout.join("") + "\nSTDERR:\n" + output.stderr.join(""));
    try {
      const r = await fetch(`${apiBase}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Timeout waiting for " + apiBase + "/api/health\nSTDOUT:\n" + output.stdout.join("") + "\nSTDERR:\n" + output.stderr.join(""));
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "paperclip-validate-rt-"));
const configPath = path.join(tempRoot, "config.json");
const exportDir = path.join(tempRoot, "exported-company");
const paperclipHome = path.join(tempRoot, "paperclip-home");
const cliShellHome = path.join(tempRoot, "shell-home");
mkdirSync(paperclipHome, { recursive: true });
mkdirSync(cliShellHome, { recursive: true });

const port = await getAvailablePort();
const config = {
  $meta: { version: 1, updatedAt: new Date().toISOString(), source: "doctor" },
  database: { mode: "postgres", connectionString: DB_URL },
  logging: { mode: "file", logDir: path.join(tempRoot, "logs") },
  server: { deploymentMode: "local_trusted", exposure: "private", host: "127.0.0.1", port, allowedHostnames: [], serveUi: false },
  auth: { baseUrlMode: "auto", disableSignUp: false },
  storage: { provider: "local_disk", localDisk: { baseDir: path.join(tempRoot, "storage") }, s3: { bucket: "p", region: "us-east-1", prefix: "", forcePathStyle: false } },
  secrets: { provider: "local_encrypted", strictMode: false, localEncrypted: { keyFilePath: path.join(tempRoot, "secrets", "master.key") } },
};
mkdirSync(path.dirname(configPath), { recursive: true });
writeFileSync(configPath, JSON.stringify(config, null, 2));

const apiBase = `http://127.0.0.1:${port}`;
const repoRoot = "/Users/molt/.paperclip/paperclip-src";
const output = { stdout: [], stderr: [] };

const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith("PAPERCLIP_")) delete env[k];
env.PAPERCLIP_CONFIG = configPath;
env.PAPERCLIP_HOME = paperclipHome;
env.PAPERCLIP_INSTANCE_ID = "company-cli-validate";
env.PAPERCLIP_CONTEXT = path.join(paperclipHome, "context.json");
env.PAPERCLIP_AUTH_STORE = path.join(paperclipHome, "auth.json");
env.HOME = cliShellHome;
env.DATABASE_URL = DB_URL;
env.HOST = "127.0.0.1";
env.PORT = String(port);
env.SERVE_UI = "false";
env.PAPERCLIP_DB_BACKUP_ENABLED = "false";
env.HEARTBEAT_SCHEDULER_ENABLED = "false";
env.PAPERCLIP_MIGRATION_AUTO_APPLY = "true";
env.PAPERCLIP_UI_DEV_MIDDLEWARE = "false";
env.PAPERCLIP_AGENT_JWT_SECRET = "test-secret-for-validation-only-32chars";

const child = spawn("pnpm", ["--silent", "paperclipai", "run", "--config", configPath], {
  cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"],
});
child.stdout?.on("data", (c) => output.stdout.push(String(c)));
child.stderr?.on("data", (c) => output.stderr.push(String(c)));

const log = (msg) => console.log(msg);

let exitCode = 1;
try {
  log("[STEP] Waiting for server at " + apiBase);
  await waitForServer(apiBase, child, output);
  log("[OK] Server started at " + apiBase);

  // Create unique company to avoid collisions
  const stamp = Date.now();
  const created = await (await fetch(`${apiBase}/api/companies`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `CLI Validate ${stamp}` }),
  })).json();
  log(`[OK] Created source company: ${created.id} (${created.name})`);

  const project = await (await fetch(`${apiBase}/api/companies/${created.id}/projects`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `Verify Round-Trip ${stamp}`, status: "in_progress" }),
  })).json();
  log(`[OK] Created project: ${project.id} (${project.name})`);

  const issue = await (await fetch(`${apiBase}/api/companies/${created.id}/issues`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Round-trip validation issue",
      // Use the same large description that surfaced the truncation bug so the
      // validation script would catch a regression on its own.
      description: "Round-trip the company package through the CLI.\n\n" + "portable-data ".repeat(12_000),
      status: "todo",
      projectId: project.id,
    }),
  })).json();
  log(`[OK] Created issue: ${issue.identifier} (description=${issue.description?.length ?? "n/a"} chars)`);

  log("[STEP] Running CLI export");
  const exportRes = await execFileAsync(
    "pnpm", ["--silent", "paperclipai", "company", "export", created.id, "--out", exportDir, "--include", "company,projects,issues", "--api-base", apiBase, "--config", configPath, "--json"],
    { cwd: repoRoot, env, maxBuffer: 50 * 1024 * 1024 }
  );
  const startIdx = exportRes.stdout.search(/[\[{]/);
  const exportJson = JSON.parse(exportRes.stdout.slice(startIdx));
  if (!exportJson.ok) throw new Error("Export failed: " + JSON.stringify(exportJson));
  log(`[OK] Exported ${exportJson.filesWritten} files to ${exportJson.out}`);

  const files = readdirSync(exportDir);
  log(`[OK] Export directory contains: ${files.join(", ")}`);

  // Verify exported files contain expected content
  const companyMd = readFileSync(path.join(exportDir, "COMPANY.md"), "utf8");
  if (!companyMd.includes(created.name)) throw new Error("Exported COMPANY.md does not contain source name");
  log("[OK] COMPANY.md contains source company name");

  const paperclipYaml = readFileSync(path.join(exportDir, ".paperclip.yaml"), "utf8");
  if (!paperclipYaml.includes("paperclip")) throw new Error(".paperclip.yaml missing");
  log("[OK] .paperclip.yaml present");

  // Verify the full description round-tripped through export.
  const tasksDir = path.join(exportDir, "tasks");
  if (existsSync(tasksDir)) {
    const taskEntries = readdirSync(tasksDir);
    let taskMarkdown = null;
    for (const entry of taskEntries) {
      const entryPath = path.join(tasksDir, entry);
      if (statSync(entryPath).isDirectory()) {
        for (const sub of readdirSync(entryPath)) {
          if (sub.endsWith(".md")) {
            taskMarkdown = readFileSync(path.join(entryPath, sub), "utf8");
            break;
          }
        }
      } else if (entry.endsWith(".md")) {
        taskMarkdown = readFileSync(entryPath, "utf8");
      }
      if (taskMarkdown) break;
    }
    if (!taskMarkdown) throw new Error("No TASK.md found in tasks directory");
    const portableCount = (taskMarkdown.match(/portable-data/g) ?? []).length;
    log(`[OK] Exported task markdown is ${taskMarkdown.length} bytes with ${portableCount} portable-data occurrences`);
    if (portableCount < 12_000) {
      throw new Error(`Expected 12000 portable-data occurrences in exported task, got ${portableCount}`);
    }
  } else {
    throw new Error("Expected tasks/ directory in export");
  }

  log("[STEP] Running CLI import to new company");
  const importRes = await execFileAsync(
    "pnpm", ["--silent", "paperclipai", "company", "import", exportDir, "--target", "new", "--new-company-name", `Round-trip ${created.name}`, "--include", "company,projects,issues", "--yes", "--api-base", apiBase, "--config", configPath, "--json"],
    { cwd: repoRoot, env, maxBuffer: 10 * 1024 * 1024 }
  );
  const istart = importRes.stdout.search(/[\[{]/);
  const importJson = JSON.parse(importRes.stdout.slice(istart));
  log(`[OK] Imported to new company: ${importJson.company.id} (action: ${importJson.company.action})`);
  log(`[OK] Projects imported: ${importJson.projects?.length || 0}`);

  // Verify imported company exists with right data
  const importedCompanies = await (await fetch(`${apiBase}/api/companies`)).json();
  const importedCompany = importedCompanies.find(c => c.id === importJson.company.id);
  if (!importedCompany) throw new Error("Imported company not found in list");
  log(`[OK] Verified imported company: ${importedCompany.name}`);

  const importedProjects = await (await fetch(`${apiBase}/api/companies/${importJson.company.id}/projects`)).json();
  const foundProject = importedProjects.find((p) => p.name === project.name);
  if (!foundProject) throw new Error("Imported project not found");
  log(`[OK] Verified imported project: ${foundProject.name}`);

  const importedIssues = await (await fetch(`${apiBase}/api/companies/${importJson.company.id}/issues`)).json();
  const foundIssue = importedIssues.find((i) => i.title === issue.title);
  if (!foundIssue) throw new Error("Imported issue not found");
  log(`[OK] Verified imported issue: ${foundIssue.identifier}`);

  // Verify the imported issue retained the full description.
  const importedIssueDetail = await (await fetch(`${apiBase}/api/issues/${foundIssue.id}`)).json();
  if (!importedIssueDetail.description || !importedIssueDetail.description.includes("Round-trip the company package")) {
    throw new Error("Imported issue lost description");
  }
  const importedPortableCount = (importedIssueDetail.description.match(/portable-data/g) ?? []).length;
  log(`[OK] Imported issue description is ${importedIssueDetail.description.length} chars with ${importedPortableCount} portable-data occurrences`);
  if (importedPortableCount < 12_000) {
    throw new Error(`Expected 12000 portable-data occurrences in imported issue, got ${importedPortableCount}`);
  }

  log("[STEP] Running CLI import preview against existing company");
  const previewRes = await execFileAsync(
    "pnpm", ["--silent", "paperclipai", "company", "import", exportDir, "--target", "existing", "--company-id", importJson.company.id, "--include", "company,projects,issues", "--collision", "rename", "--dry-run", "--api-base", apiBase, "--config", configPath, "--json"],
    { cwd: repoRoot, env, maxBuffer: 10 * 1024 * 1024 }
  );
  const pstart = previewRes.stdout.search(/[\[{]/);
  const previewJson = JSON.parse(previewRes.stdout.slice(pstart));
  if (previewJson.errors && previewJson.errors.length > 0) {
    throw new Error("Preview reported errors: " + previewJson.errors.join("; "));
  }
  log(`[OK] Preview OK: company=${previewJson.plan?.companyAction}, projects=${previewJson.plan?.projectPlans?.length}, issues=${previewJson.plan?.issuePlans?.length}`);

  log("[STEP] Running CLI apply to existing company");
  const applyRes = await execFileAsync(
    "pnpm", ["--silent", "paperclipai", "company", "import", exportDir, "--target", "existing", "--company-id", importJson.company.id, "--include", "company,projects,issues", "--collision", "rename", "--yes", "--api-base", apiBase, "--config", configPath, "--json"],
    { cwd: repoRoot, env, maxBuffer: 10 * 1024 * 1024 }
  );
  const astart = applyRes.stdout.search(/[\[{]/);
  const applyJson = JSON.parse(applyRes.stdout.slice(astart));
  log(`[OK] Applied to existing company: company=${applyJson.company.action}, projects created=${applyJson.projects?.filter(p => p.action === 'created').length}`);

  // Verify collision handling created duplicates with rename strategy
  const finalProjects = await (await fetch(`${apiBase}/api/companies/${importJson.company.id}/projects`)).json();
  log(`[OK] Final project count after rename import: ${finalProjects.length} (expected 2)`);
  if (finalProjects.length !== 2) throw new Error("Expected 2 projects after rename collision, got " + finalProjects.length);

  console.log("\n=== ROUND-TRIP VALIDATION PASSED ===");
  console.log(`Source: ${created.id} ${created.name}`);
  console.log(`Imported (new): ${importJson.company.id} ${importJson.company.name}`);
  console.log(`Applied to existing: ${importJson.company.id} (${applyJson.company.action})`);
  console.log(`Final project count: ${finalProjects.length}`);
  exitCode = 0;
} catch (err) {
  console.error("\n=== VALIDATION FAILED ===");
  console.error(err.message || err);
  if (output.stdout.length) console.error("\n--- Server stdout ---\n" + output.stdout.join(""));
  if (output.stderr.length) console.error("--- Server stderr ---\n" + output.stderr.join(""));
  exitCode = 1;
} finally {
  try { child.kill("SIGTERM"); } catch {}
  await new Promise((r) => setTimeout(r, 2000));
  try { if (child.exitCode === null) child.kill("SIGKILL"); } catch {}
  rmSync(tempRoot, { recursive: true, force: true });
  process.exit(exitCode);
}
