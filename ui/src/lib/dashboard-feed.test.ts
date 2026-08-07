// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ActivityEvent, Issue } from "@paperclipai/shared";
import {
  DASHBOARD_VISIBLE_FEED_LIMIT,
  getRecentDashboardActivity,
  getRecentDashboardIssues,
  isLintResidualTaskActivity,
} from "./dashboard-feed";

function makeIssue(id: string, title: string, updatedAt = "2026-08-07T00:00:00.000Z"): Issue {
  return {
    id,
    companyId: "company-1",
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    title,
    description: null,
    status: "done",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: 1,
    identifier: `PAP-${id}`,
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    labels: [],
    labelIds: [],
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    workMode: "standard",
  };
}

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: overrides.id ?? "event-1",
    companyId: "company-1",
    actorType: "system",
    actorId: "system",
    action: "issue.updated",
    entityType: "issue",
    entityId: "issue-1",
    agentId: null,
    runId: null,
    details: null,
    createdAt: new Date("2026-08-07T00:00:00.000Z"),
    ...overrides,
  };
}

describe("dashboard feed helpers", () => {
  it("identifies generated-task activity through an issue reference or event title", () => {
    const lintIssue = makeIssue("lint", "Paperclip: Close lint residuals on PR merge");
    const issuesById = new Map([[lintIssue.id, lintIssue]]);

    expect(isLintResidualTaskActivity(makeEvent({ entityId: lintIssue.id }), issuesById)).toBe(true);
    expect(isLintResidualTaskActivity(
      makeEvent({ entityType: "environment_lease", details: { issueId: lintIssue.id } }),
      issuesById,
    )).toBe(true);
    expect(isLintResidualTaskActivity(
      makeEvent({ details: { issueTitle: "Paperclip: Close lint residuals on PR merge" } }),
      new Map(),
    )).toBe(true);
  });

  it("fills the dashboard activity window after excluded events", () => {
    const lintIssue = makeIssue("lint", "Paperclip: Close lint residuals on PR merge");
    const visibleEvent = makeEvent({ id: "visible", entityId: "visible-issue" });
    const events = [
      makeEvent({ id: "lint", entityId: lintIssue.id }),
      visibleEvent,
    ];

    expect(getRecentDashboardActivity(events, new Map([[lintIssue.id, lintIssue]]), true)).toEqual([visibleEvent]);
    expect(getRecentDashboardActivity(events, new Map([[lintIssue.id, lintIssue]]), false)).toHaveLength(2);
  });

  it("sorts and caps recent tasks at the expanded dashboard limit", () => {
    const issues = Array.from({ length: DASHBOARD_VISIBLE_FEED_LIMIT + 1 }, (_, index) =>
      makeIssue(`issue-${index}`, `Task ${index}`, `2026-08-07T00:${String(index).padStart(2, "0")}:00.000Z`),
    );

    const recent = getRecentDashboardIssues(issues, false);
    expect(recent).toHaveLength(DASHBOARD_VISIBLE_FEED_LIMIT);
    expect(recent[0]?.title).toBe(`Task ${DASHBOARD_VISIBLE_FEED_LIMIT}`);
  });
});
