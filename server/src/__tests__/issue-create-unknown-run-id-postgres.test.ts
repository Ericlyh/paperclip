import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueWatchdogs,
  issues,
} from "@paperclipai/db";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres unknown-run-id issue-create tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

/**
 * Route-level proof that a caller-supplied run id which does not exist cannot
 * half-write an issue.
 *
 * `activity_log.run_id` and `issue_watchdogs.created_by_run_id` are foreign
 * keys to `heartbeat_runs`, and the run id arrives from the caller
 * (`x-paperclip-run-id`). Before the fix, `POST /api/companies/:id/issues`
 * committed the issue row and only then failed the activity-log insert on the
 * foreign key: the caller saw a 500 for a write that had already succeeded,
 * and the issue was left on the board with no activity row at all — no record
 * of who filed it.
 *
 * These tests need the real routes, real services, and a real database: the
 * mocked route harness cannot prove a foreign-key outcome.
 */
describeEmbeddedPostgres("issue create with an unknown run id (routes + postgres)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-unknown-run-id-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    const cleanups = [
      () => db.delete(issueWatchdogs),
      () => db.delete(activityLog),
      () => db.delete(heartbeatRuns),
      () => db.delete(issues),
      () => db.delete(agents),
      () => db.delete(companies),
    ];
    for (const cleanup of cleanups) await cleanup().catch(() => undefined);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function app(actor: Record<string, unknown>) {
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    testApp.use("/api", issueRoutes(db, {} as any, {}));
    testApp.use(errorHandler);
    return testApp;
  }

  function agentActor(companyId: string, agentId: string, runId: string | null) {
    return { type: "agent", source: "agent_key", companyId, agentId, runId };
  }

  async function seedCompanyAndAgent(prefix: string) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const watchdogAgentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: `${prefix} Company`,
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: agentId,
        companyId,
        name: `${prefix} Agent`,
        role: "engineer",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: watchdogAgentId,
        companyId,
        name: `${prefix} Watchdog Agent`,
        role: "engineer",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    return { companyId, agentId, watchdogAgentId };
  }

  it("files the issue and records the creator when the run id does not exist", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent("UNKRUN");
    const unknownRunId = randomUUID();

    const response = await request(app(agentActor(companyId, agentId, unknownRunId)))
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "Filed with a synthetic run id", description: "Body" });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeTruthy();

    const created = await db
      .select({ id: issues.id, originRunId: issues.originRunId })
      .from(issues)
      .where(eq(issues.id, response.body.id));
    expect(created).toHaveLength(1);

    const activity = await db
      .select({
        action: activityLog.action,
        actorType: activityLog.actorType,
        actorId: activityLog.actorId,
        agentId: activityLog.agentId,
        runId: activityLog.runId,
      })
      .from(activityLog)
      .where(eq(activityLog.entityId, response.body.id));
    expect(activity).toHaveLength(1);
    expect(activity[0].action).toBe("issue.created");
    expect(activity[0].actorType).toBe("agent");
    expect(activity[0].actorId).toBe(agentId);
    expect(activity[0].agentId).toBe(agentId);
    // The unknown run id is dropped rather than failing the insert.
    expect(activity[0].runId).toBeNull();
  });

  it("keeps run attribution when the run id does exist", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent("KNOWNRUN");
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
    });

    const response = await request(app(agentActor(companyId, agentId, runId)))
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "Filed with a real run id", description: "Body" });

    expect(response.status).toBe(201);

    const activity = await db
      .select({ action: activityLog.action, runId: activityLog.runId })
      .from(activityLog)
      .where(eq(activityLog.entityId, response.body.id));
    expect(activity).toHaveLength(1);
    expect(activity[0].action).toBe("issue.created");
    expect(activity[0].runId).toBe(runId);
  });

  it("files an issue carrying a watchdog when the run id does not exist", async () => {
    const { companyId, agentId, watchdogAgentId } = await seedCompanyAndAgent("UNKRUNWD");
    const unknownRunId = randomUUID();

    const response = await request(app(agentActor(companyId, agentId, unknownRunId)))
      .post(`/api/companies/${companyId}/issues`)
      .send({
        title: "Watchdog issue filed with a synthetic run id",
        description: "Body",
        watchdog: { agentId: watchdogAgentId, instructions: "Watch it" },
      });

    expect(response.status).toBe(201);

    const created = await db
      .select({ id: issues.id })
      .from(issues)
      .where(eq(issues.id, response.body.id));
    expect(created).toHaveLength(1);

    const watchdogs = await db
      .select({
        createdByRunId: issueWatchdogs.createdByRunId,
        updatedByRunId: issueWatchdogs.updatedByRunId,
      })
      .from(issueWatchdogs)
      .where(eq(issueWatchdogs.issueId, response.body.id));
    expect(watchdogs).toHaveLength(1);
    expect(watchdogs[0].createdByRunId).toBeNull();
    expect(watchdogs[0].updatedByRunId).toBeNull();
  });
});
