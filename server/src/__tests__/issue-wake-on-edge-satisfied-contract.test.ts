import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  agentWakeupRequests,
  companies,
  createDb,
  heartbeatRuns,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { applyEdgeWakeMonitorSuppression, issueService } from "../services/issues.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres WOE contract tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

async function waitForCondition(fn: () => Promise<boolean>, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return fn();
}

async function seedCompanyPlusAgent(
  db: ReturnType<typeof createDb>,
  fields: { companyId?: string; agentId?: string } = {},
) {
  const companyId = fields.companyId ?? randomUUID();
  const agentId = fields.agentId ?? randomUUID();
  await db.insert(companies).values({
    id: companyId,
    name: "Paperclip",
    issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    requireBoardApprovalForNewAgents: false,
  });
  await db.insert(agents).values({
    id: agentId,
    companyId,
    name: "TestAgent",
    role: "engineer",
    status: "active",
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: {},
  });
  return { companyId, agentId };
}

async function clearAll(db: ReturnType<typeof createDb>) {
  await db.delete(agentWakeupRequests);
  await db.delete(heartbeatRuns);
  await db.delete(issueRelations);
  await db.delete(issues);
  await db.delete(agents);
  await db.delete(companies);
}

describeEmbeddedPostgres("wake-on-edge-satisfied contract (OOP-3058)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-woe-contract-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await clearAll(db);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("D1: lists wakeable dependents when blocker is done and no monitor schedule is pending", async () => {
    const { companyId, agentId } = await seedCompanyPlusAgent(db);
    const blockerId = randomUUID();
    const dependentId = randomUUID();
    await db.insert(issues).values([
      { id: blockerId, companyId, title: "Blocker", status: "done", priority: "high" },
      { id: dependentId, companyId, title: "Dependent", status: "todo", priority: "medium", assigneeAgentId: agentId },
    ]);
    await db.insert(issueRelations).values({
      companyId, issueId: blockerId, relatedIssueId: dependentId, type: "blocks",
    });

    const svc = issueService(db);
    const dependents = await svc.listWakeableBlockedDependents(blockerId);
    expect(dependents).toHaveLength(1);
    expect(dependents[0].id).toBe(dependentId);
    expect(dependents[0].assigneeAgentId).toBe(agentId);
    expect(dependents[0].blockerIssueIds).toContain(blockerId);
  });

  it("D3: applyEdgeWakeMonitorSuppression pushes monitorNextCheckAt forward by EDGE_WAKE_MONITOR_MIN_GAP_MS", async () => {
    const { companyId } = await seedCompanyPlusAgent(db);
    const id = randomUUID();
    const futureMonitor = new Date(Date.now() + 30 * 60_000); // 30 min from now
    const lastTriggered = new Date(Date.now() - 5 * 60_000);
    await db.insert(issues).values({
      id,
      companyId,
      title: "Has monitor",
      status: "todo",
      priority: "medium",
      monitorNextCheckAt: futureMonitor,
      monitorLastTriggeredAt: lastTriggered,
    });

    const before = await db.select({
      monitorNextCheckAt: issues.monitorNextCheckAt,
      monitorLastTriggeredAt: issues.monitorLastTriggeredAt,
    }).from(issues).where(eq(issues.id, id)).then((rows) => rows[0]);
    expect(before?.monitorNextCheckAt).toEqual(futureMonitor);

    const beforeMs = Date.now();
    await applyEdgeWakeMonitorSuppression(db, companyId, [id]);
    const afterMs = Date.now();

    const after = await db.select({
      monitorNextCheckAt: issues.monitorNextCheckAt,
      monitorLastTriggeredAt: issues.monitorLastTriggeredAt,
    }).from(issues).where(eq(issues.id, id)).then((rows) => rows[0]);
    expect(after).toBeTruthy();
    const pushed = after!.monitorNextCheckAt!;
    // Pushed by exactly 60s from `now` (EDGE_WAKE_MONITOR_MIN_GAP_MS).
    const expectedPushedMin = new Date(beforeMs + 60_000);
    const expectedPushedMax = new Date(afterMs + 60_000);
    expect(pushed.getTime()).toBeGreaterThanOrEqual(expectedPushedMin.getTime());
    expect(pushed.getTime()).toBeLessThanOrEqual(expectedPushedMax.getTime());
    // monitorLastTriggeredAt bumped to now (within tolerance).
    expect(after!.monitorLastTriggeredAt!.getTime()).toBeGreaterThanOrEqual(beforeMs);
    expect(after!.monitorLastTriggeredAt!.getTime()).toBeLessThanOrEqual(afterMs);
  });

  it("D3: suppression is a no-op when the dependent list is empty", async () => {
    const { companyId } = await seedCompanyPlusAgent(db);
    // Should not throw and should not mutate any rows.
    await expect(applyEdgeWakeMonitorSuppression(db, companyId, [])).resolves.toBeUndefined();
    await expect(applyEdgeWakeMonitorSuppression(db, companyId, [randomUUID()])).resolves.toBeUndefined();
  });

  it("CANCELLED: blocker status cancelled does NOT satisfy the contract", async () => {
    const { companyId, agentId } = await seedCompanyPlusAgent(db);
    const blockerId = randomUUID();
    const dependentId = randomUUID();
    await db.insert(issues).values([
      { id: blockerId, companyId, title: "Cancelled blocker", status: "cancelled", priority: "high" },
      // dependent must be status=blocked to be a root in blockerAttention; the
      // wake-on-edge contract's "cancelled does not satisfy" is independently
      // tested via listWakeableBlockedDependents returning [].
      { id: dependentId, companyId, title: "Dependent", status: "blocked", priority: "medium", assigneeAgentId: agentId },
    ]);
    await db.insert(issueRelations).values({
      companyId, issueId: blockerId, relatedIssueId: dependentId, type: "blocks",
    });

    const svc = issueService(db);
    const dependents = await svc.listWakeableBlockedDependents(blockerId);
    expect(dependents).toHaveLength(0);

    // Invariant: a blocked dependent with a cancelled blocker reports
    // blockerAttention state != "uncovered" (the unresolved blocker is
    // covered/attention, not silently "none").
    const blockerAttention = await svc.listBlockerAttention(companyId, [
      { id: dependentId, companyId, status: "blocked", parentId: null, identifier: "T-1", title: "Dependent", executionRunId: null, assigneeAgentId: agentId, assigneeUserId: null },
    ]);
    const attn = blockerAttention.get(dependentId);
    expect(attn).toBeTruthy();
    expect(attn!.state).not.toBe("none");
  });

  it("PARTIAL: blocker status todo does NOT satisfy the contract", async () => {
    const { companyId, agentId } = await seedCompanyPlusAgent(db);
    const blockerId = randomUUID();
    const dependentId = randomUUID();
    await db.insert(issues).values([
      { id: blockerId, companyId, title: "Still in flight", status: "in_progress", priority: "high" },
      { id: dependentId, companyId, title: "Dependent", status: "todo", priority: "medium", assigneeAgentId: agentId },
    ]);
    await db.insert(issueRelations).values({
      companyId, issueId: blockerId, relatedIssueId: dependentId, type: "blocks",
    });

    const svc = issueService(db);
    const dependents = await svc.listWakeableBlockedDependents(blockerId);
    expect(dependents).toHaveLength(0);
  });

  it("ENO_BLOCKER: listWakeableBlockedDependents returns empty when no blockers exist", async () => {
    const { companyId } = await seedCompanyPlusAgent(db);
    const someUnrelatedIssueId = randomUUID();
    await db.insert(issues).values({
      id: someUnrelatedIssueId, companyId, title: "Unrelated", status: "done", priority: "low",
    });
    const svc = issueService(db);
    const dependents = await svc.listWakeableBlockedDependents(someUnrelatedIssueId);
    expect(dependents).toHaveLength(0);
  });

  it("BACKLOG_DEPENDENT: dependent in backlog is NOT wakeable (correctness of the wakeable filter)", async () => {
    const { companyId, agentId } = await seedCompanyPlusAgent(db);
    const blockerId = randomUUID();
    const dependentId = randomUUID();
    await db.insert(issues).values([
      { id: blockerId, companyId, title: "Blocker", status: "done", priority: "high" },
      { id: dependentId, companyId, title: "Backlog dependent", status: "backlog", priority: "medium", assigneeAgentId: agentId },
    ]);
    await db.insert(issueRelations).values({
      companyId, issueId: blockerId, relatedIssueId: dependentId, type: "blocks",
    });

    const svc = issueService(db);
    const dependents = await svc.listWakeableBlockedDependents(blockerId);
    expect(dependents).toHaveLength(0);
  });

  it("CHAIN: deeply nested descendants are NOT enumerated by listWakeableBlockedDependents (only direct reverse edges)", async () => {
    // A -> B -> C: only B is a direct reverse-blocker of A. listWakeableBlockedDependents(A.id)
    // returns only B, not C. This is the documented contract: enumerate direct
    // reverse `blocks` edges; downstream propagation is B's responsibility.
    const { companyId, agentId } = await seedCompanyPlusAgent(db);
    const aId = randomUUID();
    const bId = randomUUID();
    const cId = randomUUID();
    await db.insert(issues).values([
      { id: aId, companyId, title: "A", status: "done", priority: "high" },
      { id: bId, companyId, title: "B", status: "todo", priority: "medium", assigneeAgentId: agentId },
      { id: cId, companyId, title: "C", status: "todo", priority: "medium", assigneeAgentId: agentId },
    ]);
    await db.insert(issueRelations).values([
      { companyId, issueId: aId, relatedIssueId: bId, type: "blocks" },
      { companyId, issueId: bId, relatedIssueId: cId, type: "blocks" },
    ]);

    const svc = issueService(db);
    const dependents = await svc.listWakeableBlockedDependents(aId);
    expect(dependents).toHaveLength(1);
    expect(dependents[0].id).toBe(bId);
  });
});
