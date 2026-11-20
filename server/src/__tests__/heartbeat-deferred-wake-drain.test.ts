import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  agentWakeupRequests,
  companies,
  costEvents,
  createDb,
  documentRevisions,
  documents,
  heartbeatRuns,
  issueComments,
  issueDocuments,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { runningProcesses } from "../adapters/index.ts";

// OOP-7956: a wake parked as `deferred_issue_execution` must be promoted when
// the issue's execution lock is released. The lock can be released by a finalizing
// run, by a queued run cancelled as stale, or by a sweeper — and every one of
// those paths has to drain the parked wake.

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Deferred-wake drain test run.",
    provider: "test",
    model: "test-model",
  })),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat deferred-wake drain tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

async function ensureIssueRelationsTable(db: ReturnType<typeof createDb>) {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "issue_relations" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "company_id" uuid NOT NULL,
      "issue_id" uuid NOT NULL,
      "related_issue_id" uuid NOT NULL,
      "type" text NOT NULL,
      "created_by_agent_id" uuid,
      "created_by_user_id" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `));
}

async function waitForCondition(fn: () => Promise<boolean>, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return fn();
}

async function cleanupDeferredWakeFixture(db: ReturnType<typeof createDb>) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await db.execute(sql.raw(`
        TRUNCATE TABLE
          "company_skills",
          "issue_comments",
          "issue_documents",
          "document_revisions",
          "documents",
          "issue_relations",
          "issue_tree_holds",
          "issues",
          "heartbeat_run_events",
          "cost_events",
          "activity_log",
          "heartbeat_runs",
          "agent_wakeup_requests",
          "agent_runtime_state",
          "agents",
          "companies"
        RESTART IDENTITY CASCADE
      `));
      return;
    } catch (error) {
      const isLateCommentRace =
        error instanceof Error &&
        error.message.includes("issue_comments_issue_id_issues_id_fk");
      if (!isLateCommentRace || attempt === 9) {
        throw error;
      }

      // Heartbeat completion can write issue-thread comments shortly after the
      // run leaves queued/running. Retry the dependent deletes once those land.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

describe("heartbeat deferred-wake drain", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-deferred-wake-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
    await ensureIssueRelationsTable(db);
  }, 20_000);

  afterEach(async () => {
    mockAdapterExecute.mockReset();
    mockAdapterExecute.mockImplementation(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      errorMessage: null,
      summary: "Deferred-wake drain test run.",
      provider: "test",
      model: "test-model",
    }));
    runningProcesses.clear();
    let idlePolls = 0;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const runs = await db
        .select({ status: heartbeatRuns.status })
        .from(heartbeatRuns);
      const hasActiveRun = runs.some((run) => run.status === "queued" || run.status === "running");
      if (!hasActiveRun) {
        idlePolls += 1;
        if (idlePolls >= 3) break;
      } else {
        idlePolls = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    await cleanupDeferredWakeFixture(db);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(input: { name?: string } = {}) {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      defaultResponsibleUserId: "responsible-user",
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function seedAgent(input: {
    companyId: string;
    name: string;
    status?: "active" | "idle";
    maxConcurrentRuns?: number;
  }) {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId: input.companyId,
      name: input.name,
      role: "engineer",
      status: input.status ?? "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: {
          wakeOnDemand: true,
          maxConcurrentRuns: input.maxConcurrentRuns ?? 1,
        },
      },
      permissions: {},
    });
    return agentId;
  }

  /** A queued run that holds the issue execution lock. */
  async function seedQueuedLockHolder(input: {
    companyId: string;
    agentId: string;
    issueId: string;
  }) {
    const wakeupRequestId = randomUUID();
    const runId = randomUUID();
    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId: input.companyId,
      agentId: input.agentId,
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId: input.issueId },
      status: "queued",
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: input.companyId,
      agentId: input.agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "queued",
      wakeupRequestId,
      contextSnapshot: { issueId: input.issueId, wakeReason: "issue_assigned" },
    });
    await db
      .update(agentWakeupRequests)
      .set({ runId })
      .where(eq(agentWakeupRequests.id, wakeupRequestId));
    await db
      .update(issues)
      .set({ executionRunId: runId })
      .where(eq(issues.id, input.issueId));
    return { runId, wakeupRequestId };
  }

  /** A wake parked because another agent held the issue execution lock. */
  async function seedDeferredWake(input: {
    companyId: string;
    agentId: string;
    issueId: string;
    wakeReason?: string;
  }) {
    const wakeupId = randomUUID();
    await db.insert(agentWakeupRequests).values({
      id: wakeupId,
      companyId: input.companyId,
      agentId: input.agentId,
      source: "automation",
      triggerDetail: "system",
      reason: "issue_execution_deferred",
      payload: {
        issueId: input.issueId,
        _paperclipWakeContext: {
          issueId: input.issueId,
          wakeReason: input.wakeReason ?? "execution_approval_requested",
        },
      },
      status: "deferred_issue_execution",
    });
    return wakeupId;
  }

  async function seedApprovalStageIssue(input: {
    companyId: string;
    assigneeAgentId: string;
    returnAssigneeAgentId: string;
    status?: "todo" | "in_progress" | "in_review";
  }) {
    const issueId = randomUUID();
    const stageId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId: input.companyId,
      title: "Approval-stage finding",
      status: input.status ?? "in_review",
      priority: "high",
      assigneeAgentId: input.assigneeAgentId,
      responsibleUserId: "responsible-user",
      executionState: {
        status: "pending",
        currentStageId: stageId,
        currentStageIndex: 0,
        currentStageType: "approval",
        currentParticipant: { type: "agent", agentId: input.assigneeAgentId, userId: null },
        returnAssignee: { type: "agent", agentId: input.returnAssigneeAgentId, userId: null },
        reviewRequest: null,
        completedStageIds: [],
        lastDecisionId: null,
        lastDecisionOutcome: null,
      },
    });
    return { issueId, stageId };
  }

  async function readWakeup(wakeupId: string) {
    return db
      .select({ status: agentWakeupRequests.status, runId: agentWakeupRequests.runId })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, wakeupId))
      .then((rows) => rows[0] ?? null);
  }

  describeEmbeddedPostgres("deferred wake promotion", () => {
    it("promotes the parked approval wake when the queued lock holder is cancelled as stale", async () => {
      const companyId = await seedCompany();
      const hostAgentId = await seedAgent({ companyId, name: "HostAgent" });
      const checkerAgentId = await seedAgent({ companyId, name: "CheckerAgent", status: "idle" });

      // The issue was re-routed to the checker while the host still held the
      // execution lock, so the checker's approval wake was parked.
      const { issueId } = await seedApprovalStageIssue({
        companyId,
        assigneeAgentId: checkerAgentId,
        returnAssigneeAgentId: hostAgentId,
      });
      const { runId } = await seedQueuedLockHolder({
        companyId,
        agentId: hostAgentId,
        issueId,
      });
      const deferredWakeupId = await seedDeferredWake({
        companyId,
        agentId: checkerAgentId,
        issueId,
      });

      expect((await readWakeup(deferredWakeupId))?.status).toBe("deferred_issue_execution");

      await heartbeat.resumeQueuedRuns();

      await waitForCondition(async () => {
        const wakeup = await readWakeup(deferredWakeupId);
        return wakeup?.status !== "deferred_issue_execution" && Boolean(wakeup?.runId);
      });

      const wakeup = await readWakeup(deferredWakeupId);
      expect(wakeup?.status).not.toBe("deferred_issue_execution");
      expect(wakeup?.runId).toBeTruthy();

      const promotedRun = wakeup?.runId
        ? await db
          .select({ agentId: heartbeatRuns.agentId, status: heartbeatRuns.status })
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.id, wakeup.runId))
          .then((rows) => rows[0] ?? null)
        : null;
      expect(promotedRun?.agentId).toBe(checkerAgentId);

      // The stale queued run was cancelled, not started.
      const staleRun = await db
        .select({ status: heartbeatRuns.status, errorCode: heartbeatRuns.errorCode })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId))
        .then((rows) => rows[0] ?? null);
      expect(staleRun?.status).toBe("cancelled");
      expect(staleRun?.errorCode).toBe("issue_assignee_changed");
    }, 30_000);

    it("drains the parked wake of a sibling issue whose lock the finalizing run released", async () => {
      const companyId = await seedCompany();
      const executorAgentId = await seedAgent({ companyId, name: "ExecutorAgent" });
      const peerAgentId = await seedAgent({ companyId, name: "PeerAgent", status: "idle" });

      // The finalizing run's context issue.
      const contextIssueId = randomUUID();
      await db.insert(issues).values({
        id: contextIssueId,
        companyId,
        title: "Context issue",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: executorAgentId,
      });

      // A sibling issue that the same run also held the lock on.
      const siblingIssueId = randomUUID();
      await db.insert(issues).values({
        id: siblingIssueId,
        companyId,
        title: "Sibling issue with a parked wake",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: peerAgentId,
      });

      const { runId } = await seedQueuedLockHolder({
        companyId,
        agentId: executorAgentId,
        issueId: contextIssueId,
      });
      await db
        .update(issues)
        .set({ executionRunId: runId })
        .where(eq(issues.id, siblingIssueId));

      const deferredWakeupId = await seedDeferredWake({
        companyId,
        agentId: peerAgentId,
        issueId: siblingIssueId,
        wakeReason: "issue_mention",
      });

      await heartbeat.resumeQueuedRuns();

      await waitForCondition(async () => {
        const wakeup = await readWakeup(deferredWakeupId);
        return wakeup?.status !== "deferred_issue_execution" && Boolean(wakeup?.runId);
      });

      const wakeup = await readWakeup(deferredWakeupId);
      expect(wakeup?.status).not.toBe("deferred_issue_execution");
      expect(wakeup?.runId).toBeTruthy();

      const promotedRun = wakeup?.runId
        ? await db
          .select({ agentId: heartbeatRuns.agentId })
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.id, wakeup.runId))
          .then((rows) => rows[0] ?? null)
        : null;
      expect(promotedRun?.agentId).toBe(peerAgentId);
    }, 30_000);
  });

  describeEmbeddedPostgres("deferred wake sweeper", () => {
    it("reclaims a parked wake whose issue lock is already clear", async () => {
      const companyId = await seedCompany();
      const checkerAgentId = await seedAgent({ companyId, name: "CheckerAgent", status: "idle" });

      const { issueId } = await seedApprovalStageIssue({
        companyId,
        assigneeAgentId: checkerAgentId,
        returnAssigneeAgentId: checkerAgentId,
      });
      const deferredWakeupId = await seedDeferredWake({
        companyId,
        agentId: checkerAgentId,
        issueId,
      });

      const swept = await heartbeat.sweepDeferredIssueExecutions();
      expect(swept.promoted).toBe(1);
      expect(swept.issueIds).toContain(issueId);

      const wakeup = await readWakeup(deferredWakeupId);
      expect(wakeup?.status).not.toBe("deferred_issue_execution");
      expect(wakeup?.runId).toBeTruthy();

      const promotedRun = wakeup?.runId
        ? await db
          .select({ agentId: heartbeatRuns.agentId })
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.id, wakeup.runId))
          .then((rows) => rows[0] ?? null)
        : null;
      expect(promotedRun?.agentId).toBe(checkerAgentId);
    });

    it("leaves a parked wake alone while the issue still holds its execution lock", async () => {
      const companyId = await seedCompany();
      const hostAgentId = await seedAgent({ companyId, name: "HostAgent" });
      const checkerAgentId = await seedAgent({ companyId, name: "CheckerAgent", status: "idle" });

      const { issueId } = await seedApprovalStageIssue({
        companyId,
        assigneeAgentId: checkerAgentId,
        returnAssigneeAgentId: hostAgentId,
      });
      await seedQueuedLockHolder({ companyId, agentId: hostAgentId, issueId });
      const deferredWakeupId = await seedDeferredWake({
        companyId,
        agentId: checkerAgentId,
        issueId,
      });

      const swept = await heartbeat.sweepDeferredIssueExecutions();
      expect(swept.promoted).toBe(0);

      const wakeup = await readWakeup(deferredWakeupId);
      expect(wakeup?.status).toBe("deferred_issue_execution");
      expect(wakeup?.runId).toBeNull();
    });
  });
});
