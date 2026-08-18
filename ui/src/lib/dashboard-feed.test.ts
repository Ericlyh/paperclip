// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ActivityEvent, Issue } from "@paperclipai/shared";
import {
  DASHBOARD_VISIBLE_FEED_LIMIT,
  getRecentDashboardActivity,
  getRecentDashboardIssues,
  isHourlyLogRotationTaskActivity,
  isLintResidualTaskActivity,
  isPrefixedTaskActivity,
  isProductivityReviewActivity,
} from "./dashboard-feed";

function makeIssue(
  id: string,
  title: string,
  updatedAt = "2026-08-07T00:00:00.000Z",
  originKind?: string,
): Issue {
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
    originKind: originKind as Issue["originKind"],
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
    // Hyphenated follow-ups match too (broadened filter scope).
    expect(isLintResidualTaskActivity(
      makeEvent({ details: { issueTitle: "lint-residual-prune: escalation triage surface" } }),
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

    expect(getRecentDashboardActivity(events, new Map([[lintIssue.id, lintIssue]]), true, false)).toEqual([visibleEvent]);
    expect(getRecentDashboardActivity(events, new Map([[lintIssue.id, lintIssue]]), false, false)).toHaveLength(2);
  });

  it("identifies hourly-log-rotation activity through an issue reference or event title", () => {
    const hourlyIssue = makeIssue("hourly", "Paperclip: Hourly Log Rotation");
    const issuesById = new Map([[hourlyIssue.id, hourlyIssue]]);

    expect(isHourlyLogRotationTaskActivity(makeEvent({ entityId: hourlyIssue.id }), issuesById)).toBe(true);
    expect(isHourlyLogRotationTaskActivity(
      makeEvent({ entityType: "environment_lease", details: { issueId: hourlyIssue.id } }),
      issuesById,
    )).toBe(true);
    expect(isHourlyLogRotationTaskActivity(
      makeEvent({ details: { issueTitle: "Paperclip: Hourly Log Rotation" } }),
      new Map(),
    )).toBe(true);
    // Hyphenated follow-ups match too (mirrors lint-residual pattern).
    expect(isHourlyLogRotationTaskActivity(
      makeEvent({ details: { issueTitle: "hourly-log-rotation: stuck on docker volume cleanup" } }),
      new Map(),
    )).toBe(true);
  });

  it("excludes hourly-log-rotation events when the dedicated dashboard toggle is on", () => {
    const hourlyIssue = makeIssue("hourly", "Paperclip: Hourly Log Rotation");
    const visibleEvent = makeEvent({ id: "visible", entityId: "visible-issue" });
    const hourlyEvent = makeEvent({ id: "hourly", entityId: hourlyIssue.id });
    const events = [hourlyEvent, visibleEvent];
    const issuesById = new Map([[hourlyIssue.id, hourlyIssue]]);

    expect(getRecentDashboardActivity(events, issuesById, false, false, true)).toEqual([visibleEvent]);
    expect(getRecentDashboardActivity(events, issuesById, false, false, false)).toEqual([hourlyEvent, visibleEvent]);
  });

  it("excludes hourly-log-rotation issues from the recent-tasks list when the toggle is on", () => {
    const hourlyIssue = makeIssue("hourly", "Paperclip: Hourly Log Rotation", "2026-08-07T01:00:00.000Z");
    const manualIssue = makeIssue("manual", "Manual task", "2026-08-07T02:00:00.000Z");

    expect(getRecentDashboardIssues([hourlyIssue, manualIssue], false, false, true)).toEqual([manualIssue]);
    expect(getRecentDashboardIssues([hourlyIssue, manualIssue], false, false, false)).toEqual([manualIssue, hourlyIssue]);
  });

  it("identifies productivity-review activity via issue reference or originKind details", () => {
    const reviewIssue = makeIssue("review", "Review productivity for OOP-1", "2026-08-07T00:00:00.000Z", "issue_productivity_review");
    const issuesById = new Map([[reviewIssue.id, reviewIssue]]);

    expect(isProductivityReviewActivity(makeEvent({ entityId: reviewIssue.id }), issuesById)).toBe(true);
    expect(isProductivityReviewActivity(
      makeEvent({ entityType: "run", details: { issueId: reviewIssue.id, originKind: "issue_productivity_review" } }),
      issuesById,
    )).toBe(true);
    expect(isProductivityReviewActivity(
      makeEvent({ details: { originKind: "issue_productivity_review" } }),
      new Map(),
    )).toBe(true);
    expect(isProductivityReviewActivity(makeEvent({ entityId: "other" }), new Map())).toBe(false);
  });

  it("filters productivity-review events independently of the lint-residual toggle", () => {
    const reviewIssue = makeIssue("review", "Review productivity", "2026-08-07T00:00:00.000Z", "issue_productivity_review");
    const visibleEvent = makeEvent({ id: "visible", entityId: "visible-issue" });
    const reviewEvent = makeEvent({ id: "review", entityId: reviewIssue.id });
    const events = [reviewEvent, visibleEvent];
    const issuesById = new Map([[reviewIssue.id, reviewIssue]]);

    expect(getRecentDashboardActivity(events, issuesById, false, true)).toEqual([visibleEvent]);
    expect(getRecentDashboardActivity(events, issuesById, false, false)).toEqual([reviewEvent, visibleEvent]);
  });

  it("identifies Paperclip:/Lint: prefixed activity through an issue reference or event title", () => {
    const paperclipIssue = makeIssue("paperclip", "Paperclip: Some routine task");
    const lintIssue = makeIssue("lint", "Lint: residual review");
    const issuesById = new Map([
      [paperclipIssue.id, paperclipIssue],
      [lintIssue.id, lintIssue],
    ]);

    expect(isPrefixedTaskActivity(makeEvent({ entityId: paperclipIssue.id }), issuesById)).toBe(true);
    expect(isPrefixedTaskActivity(makeEvent({ entityId: lintIssue.id }), issuesById)).toBe(true);
    expect(isPrefixedTaskActivity(
      makeEvent({ details: { issueTitle: "Paperclip: Hourly Log Rotation" } }),
      new Map(),
    )).toBe(true);
    expect(isPrefixedTaskActivity(
      makeEvent({ details: { issueTitle: "Lint: prune residuals" } }),
      new Map(),
    )).toBe(true);
    // Unrelated titles still don't match.
    expect(isPrefixedTaskActivity(
      makeEvent({ details: { issueTitle: "Manual task for the team" } }),
      new Map(),
    )).toBe(false);
  });

  it("excludes Paperclip:/Lint: prefixed events from recent activity when the toggle is on", () => {
    const paperclipIssue = makeIssue("paperclip", "Paperclip: Some routine task");
    const lintIssue = makeIssue("lint", "Lint: residual review");
    const visibleEvent = makeEvent({ id: "visible", entityId: "visible-issue" });
    const paperclipEvent = makeEvent({ id: "paperclip", entityId: paperclipIssue.id });
    const lintEvent = makeEvent({ id: "lint", entityId: lintIssue.id });
    const events = [paperclipEvent, lintEvent, visibleEvent];
    const issuesById = new Map([
      [paperclipIssue.id, paperclipIssue],
      [lintIssue.id, lintIssue],
    ]);

    // hidePrefixedTasks=false (last positional arg) keeps the events.
    expect(getRecentDashboardActivity(events, issuesById, false, false, false, false)).toEqual([
      paperclipEvent,
      lintEvent,
      visibleEvent,
    ]);
    // hidePrefixedTasks=true hides both prefixed events.
    expect(getRecentDashboardActivity(events, issuesById, false, false, false, true)).toEqual([visibleEvent]);
  });

  it("excludes Paperclip:/Lint: prefixed issues from the recent-tasks list when the toggle is on", () => {
    const paperclipIssue = makeIssue("paperclip", "Paperclip: Some routine task", "2026-08-07T01:00:00.000Z");
    const lintIssue = makeIssue("lint", "Lint: residual review", "2026-08-07T02:00:00.000Z");
    const manualIssue = makeIssue("manual", "Manual task", "2026-08-07T03:00:00.000Z");

    // hidePrefixedTasks=false (last positional arg) keeps both prefixed issues.
    expect(getRecentDashboardIssues([paperclipIssue, lintIssue, manualIssue], false, false, false, false))
      .toEqual([manualIssue, lintIssue, paperclipIssue]);
    // hidePrefixedTasks=true hides both prefixed issues, sorted descending by
    // updatedAt so manualIssue comes first.
    expect(getRecentDashboardIssues([paperclipIssue, lintIssue, manualIssue], false, false, false, true))
      .toEqual([manualIssue]);
  });

  it("sorts and caps recent tasks at the expanded dashboard limit", () => {
    const issues = Array.from({ length: DASHBOARD_VISIBLE_FEED_LIMIT + 1 }, (_, index) =>
      makeIssue(`issue-${index}`, `Task ${index}`, `2026-08-07T00:${String(index).padStart(2, "0")}:00.000Z`),
    );

    const recent = getRecentDashboardIssues(issues, false, true);
    expect(recent).toHaveLength(DASHBOARD_VISIBLE_FEED_LIMIT);
    expect(recent[0]?.title).toBe(`Task ${DASHBOARD_VISIBLE_FEED_LIMIT}`);
  });
});
