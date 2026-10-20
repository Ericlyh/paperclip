import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, afterEach } from "vitest";
import postgres from "postgres";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const cleanups: Array<() => Promise<void>> = [];
const support = await getEmbeddedPostgresTestSupport();
const d = support.supported ? describe : describe.skip;

const MIGRATION_FILE = "./migrations/0226_cost_events_and_agents_seq_scan_indexes.sql";

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

d("cost_events and agents seq-scan index migration", () => {
  it("covers the unindexed cost_events and agents predicates", async () => {
    const dbh = await startEmbeddedPostgresTestDatabase("pap3114-idx-");
    cleanups.push(() => dbh.cleanup());
    const sql = postgres(dbh.connectionString, { max: 1 });
    cleanups.push(async () => { await sql.end(); });

    const idx = await sql`SELECT indexname FROM pg_indexes WHERE tablename IN ('cost_events','agents')`;
    const names = idx.map((r) => r.indexname as string);
    expect(names).toContain("cost_events_heartbeat_run_id_idx");
    expect(names).toContain("cost_events_issue_id_idx");
    expect(names).toContain("agents_company_role_idx");

    // The company-wide cost aggregates group by provider/biller/billing_type/model
    // over every row of the company, so they still seq-scan; what this migration
    // fixes are the point lookups that used to fall back to a full scan.
    await sql`INSERT INTO companies (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'Acme')`;
    await sql`INSERT INTO agents (id, company_id, name, role) VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Root', 'cto')`;
    await sql`INSERT INTO issues (id, company_id, title) VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', 'An issue')`;
    await sql`
      INSERT INTO cost_events (company_id, agent_id, issue_id, provider, model, cost_cents, occurred_at)
      VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1',
              '00000000-0000-0000-0000-0000000000b1', 'anthropic', 'claude', 5, now())
    `;

    // A small table makes the planner prefer a seq scan, so assert the indexes
    // are usable for the predicates that previously had none. This mirrors the
    // OOP-3109 migration test (0209) rather than asserting a cost preference.
    await sql.unsafe("SET enable_seqscan = off");

    const runPlan = await sql.unsafe(
      "EXPLAIN SELECT id FROM cost_events WHERE heartbeat_run_id = '00000000-0000-0000-0000-0000000000c1'",
    );
    const runText = runPlan.map((r) => Object.values(r)[0]).join("\n");
    expect(runText).toContain("cost_events_heartbeat_run_id_idx");

    const issuePlan = await sql.unsafe(
      "EXPLAIN SELECT id FROM cost_events WHERE issue_id = '00000000-0000-0000-0000-0000000000b1'",
    );
    const issueText = issuePlan.map((r) => Object.values(r)[0]).join("\n");
    expect(issueText).toContain("cost_events_issue_id_idx");

    const rolePlan = await sql.unsafe(
      "EXPLAIN SELECT id FROM agents WHERE company_id = '00000000-0000-0000-0000-000000000001' AND role = 'cto'",
    );
    const roleText = rolePlan.map((r) => Object.values(r)[0]).join("\n");
    expect(roleText).toContain("agents_company_role_idx");

    // Idempotency: re-running the migration statements against an already
    // migrated database must be a no-op, not an error.
    const migrationSql = await readFile(fileURLToPath(new URL(MIGRATION_FILE, import.meta.url)), "utf8");
    const statements = migrationSql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      await sql.unsafe(statement);
    }
  }, 240_000);
});
