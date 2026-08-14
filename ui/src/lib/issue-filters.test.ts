// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { Issue } from "@paperclipai/shared";
import {
  applyIssueFilters,
  countActiveIssueFilters,
  defaultIssueFilterState,
  isHourlyLogRotationTask,
  isHourlyLogRotationTaskTitle,
  isLintResidualTask,
  isLintResidualTaskTitle,
  isProductivityReviewIssue,
  resolveIssueFilterWorkspaceId,
  shouldIncludeIssueFilterWorkspaceOption,
} from "./issue-filters";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: overrides.id ?? "issue-1",
    companyId: "company-1",
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    title: "Issue",
    description: null,
    status: "todo",
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
    identifier: "PAP-1",
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
    createdAt: new Date("2026-04-15T00:00:00.000Z"),
    updatedAt: new Date("2026-04-15T00:00:00.000Z"),
    ...overrides,
    workMode: overrides.workMode ?? "standard",
  };
}

describe("issue filters", () => {
  it("filters issues by creator across agents and users", () => {
    const issues = [
      makeIssue({ id: "agent-match", createdByAgentId: "agent-1" }),
      makeIssue({ id: "user-match", createdByUserId: "user-1" }),
      makeIssue({ id: "excluded", createdByAgentId: "agent-2", createdByUserId: "user-2" }),
    ];

    const filtered = applyIssueFilters(issues, {
      ...defaultIssueFilterState,
      creators: ["agent:agent-1", "user:user-1"],
    });

    expect(filtered.map((issue) => issue.id)).toEqual(["agent-match", "user-match"]);
  });

  it("matches lint-residual task title variants without matching unrelated titles", () => {
    // Canonical prefix (still matches as substring).
    expect(isLintResidualTaskTitle("Paperclip: Close lint residuals on PR merge")).toBe(true);
    expect(isLintResidualTaskTitle(" paperclip: close lint residuals on PR merge — PR 123 ")).toBe(true);
    expect(isLintResidualTaskTitle("Close lint residuals on PR merge")).toBe(true);
    expect(isLintResidualTask(makeIssue({ title: "Paperclip: Close lint residuals on PR merge (follow-up)" }))).toBe(true);
    // Hyphenated follow-ups (the issue type shown in OOP-3094 screenshot).
    expect(isLintResidualTaskTitle("lint-residual-prune: escalation triage surface")).toBe(true);
    expect(isLintResidualTaskTitle("[lint-residual-prune] docker daemon unresponsive on tick-20260805T1100Z (OOP-3064)")).toBe(true);
    expect(isLintResidualTaskTitle("Lint residual prune escalation from OOP-3247")).toBe(true);
    // Unrelated titles still don't match.
    expect(isLintResidualTaskTitle("Paperclip: Hourly Log Rotation")).toBe(false);
    expect(isLintResidualTaskTitle("Review productivity for OOP-1")).toBe(false);
    expect(isLintResidualTaskTitle(null)).toBe(false);
    expect(isLintResidualTaskTitle(undefined)).toBe(false);
  });

  it("hides lint-residual tasks only when the dedicated filter is enabled", () => {
    const manualIssue = makeIssue({ id: "manual", title: "Manual issue" });
    const lintIssue = makeIssue({ id: "lint", title: "Paperclip: Close lint residuals on PR merge" });
    const state = { ...defaultIssueFilterState, hideLintResidualTasks: true };

    expect(applyIssueFilters([manualIssue, lintIssue], state)).toEqual([manualIssue, lintIssue]);
    expect(applyIssueFilters([manualIssue, lintIssue], state, null, false, undefined, {}, true)).toEqual([manualIssue]);
    expect(countActiveIssueFilters(state, false, true)).toBe(1);
  });

  it("matches hourly-log-rotation task title variants without matching unrelated titles", () => {
    // Canonical prefix (still matches as substring).
    expect(isHourlyLogRotationTaskTitle("Paperclip: Hourly Log Rotation")).toBe(true);
    expect(isHourlyLogRotationTaskTitle(" paperclip: hourly log rotation — tick 2026-08-12T11:00Z ")).toBe(true);
    expect(isHourlyLogRotationTaskTitle("Hourly Log Rotation")).toBe(true);
    expect(isHourlyLogRotationTask(makeIssue({ title: "Paperclip: Hourly Log Rotation (follow-up)" }))).toBe(true);
    // Hyphenated follow-ups.
    expect(isHourlyLogRotationTaskTitle("hourly-log-rotation: stuck on docker volume cleanup")).toBe(true);
    expect(isHourlyLogRotationTaskTitle("[hourly-log-rotation] lease TTL expired on tick-20260805T1100Z (OOP-3064)")).toBe(true);
    expect(isHourlyLogRotationTaskTitle("Hourly log rotation stuck from OOP-3247")).toBe(true);
    // Unrelated titles still don't match.
    expect(isHourlyLogRotationTaskTitle("Paperclip: Close lint residuals on PR merge")).toBe(false);
    expect(isHourlyLogRotationTaskTitle("Review productivity for OOP-1")).toBe(false);
    expect(isHourlyLogRotationTaskTitle(null)).toBe(false);
    expect(isHourlyLogRotationTaskTitle(undefined)).toBe(false);
  });

  it("hides hourly-log-rotation tasks only when the dedicated filter is enabled", () => {
    const manualIssue = makeIssue({ id: "manual", title: "Manual issue" });
    const hourlyIssue = makeIssue({ id: "hourly", title: "Paperclip: Hourly Log Rotation" });
    const state = { ...defaultIssueFilterState, hideHourlyLogRotationTasks: true };

    expect(applyIssueFilters([manualIssue, hourlyIssue], state)).toEqual([manualIssue, hourlyIssue]);
    // 8 trailing positional args: currentUserId=null, enableRoutineVisibilityFilter=false,
    // liveIssueIds=undefined, workspaceContext={}, enableLintResidualTaskFilter=false,
    // enableProductivityReviewFilter=false, enableHourlyLogRotationTaskFilter=true.
    expect(applyIssueFilters(
      [manualIssue, hourlyIssue],
      state,
      null,
      false,
      undefined,
      {},
      false,
      false,
      true,
    )).toEqual([manualIssue]);
    expect(countActiveIssueFilters(state, false, false, false, true)).toBe(1);
  });

  it("identifies productivity-review issues by originKind and defaults the filter to ON", () => {
    const reviewIssue = makeIssue({ id: "review", originKind: "issue_productivity_review" });
    const manualIssue = makeIssue({ id: "manual" });

    expect(isProductivityReviewIssue(reviewIssue)).toBe(true);
    expect(isProductivityReviewIssue(manualIssue)).toBe(false);
    expect(defaultIssueFilterState.hideProductivityReviewIssues).toBe(true);
  });

  it("hides productivity-review issues only when the dedicated filter is enabled", () => {
    const reviewIssue = makeIssue({ id: "review", originKind: "issue_productivity_review" });
    const manualIssue = makeIssue({ id: "manual" });
    const state = { ...defaultIssueFilterState, hideProductivityReviewIssues: true };

    expect(applyIssueFilters([manualIssue, reviewIssue], state)).toEqual([manualIssue, reviewIssue]);
    expect(
      applyIssueFilters([manualIssue, reviewIssue], state, null, false, undefined, {}, false, true),
    ).toEqual([manualIssue]);
    expect(countActiveIssueFilters(state, false, false, true)).toBe(1);
  });

  it("counts creator filters as an active filter group", () => {
    expect(countActiveIssueFilters({
      ...defaultIssueFilterState,
      creators: ["user:user-1"],
    })).toBe(1);
  });

  it("filters issues to live issue ids when live-only is enabled", () => {
    const issues = [
      makeIssue({ id: "live-issue" }),
      makeIssue({ id: "idle-issue" }),
    ];

    const filtered = applyIssueFilters(
      issues,
      { ...defaultIssueFilterState, liveOnly: true },
      null,
      false,
      new Set(["live-issue"]),
    );

    expect(filtered.map((issue) => issue.id)).toEqual(["live-issue"]);
  });

  it("counts the live-only filter as an active filter group", () => {
    expect(countActiveIssueFilters({
      ...defaultIssueFilterState,
      liveOnly: true,
    })).toBe(1);
  });

  it("does not treat default project workspaces as workspace filter matches", () => {
    const issue = makeIssue({
      id: "default-workspace-issue",
      projectId: "project-1",
      projectWorkspaceId: "workspace-default",
    });
    const workspaceContext = {
      defaultProjectWorkspaceIdByProjectId: new Map([["project-1", "workspace-default"]]),
    };

    expect(resolveIssueFilterWorkspaceId(issue, workspaceContext)).toBeNull();
    expect(applyIssueFilters(
      [issue],
      { ...defaultIssueFilterState, workspaces: ["workspace-default"] },
      null,
      false,
      undefined,
      workspaceContext,
    )).toEqual([]);
  });

  it("does not treat shared default execution workspaces as workspace filter matches", () => {
    const issue = makeIssue({
      id: "shared-default-issue",
      projectId: "project-1",
      projectWorkspaceId: "workspace-default",
      executionWorkspaceId: "execution-shared-default",
    });
    const workspaceContext = {
      executionWorkspaceById: new Map([[
        "execution-shared-default",
        { mode: "shared_workspace", projectWorkspaceId: "workspace-default" },
      ]]),
      defaultProjectWorkspaceIdByProjectId: new Map([["project-1", "workspace-default"]]),
    };

    expect(resolveIssueFilterWorkspaceId(issue, workspaceContext)).toBeNull();
    expect(shouldIncludeIssueFilterWorkspaceOption(
      { id: "execution-shared-default", mode: "shared_workspace", projectWorkspaceId: "workspace-default" },
      new Set(["workspace-default"]),
    )).toBe(false);
  });

  it("keeps non-default project and isolated execution workspaces filterable", () => {
    const featureIssue = makeIssue({
      id: "feature-issue",
      projectId: "project-1",
      projectWorkspaceId: "workspace-feature",
    });
    const executionIssue = makeIssue({
      id: "execution-issue",
      projectId: "project-1",
      projectWorkspaceId: "workspace-default",
      executionWorkspaceId: "execution-isolated",
    });
    const workspaceContext = {
      executionWorkspaceById: new Map([[
        "execution-isolated",
        { mode: "isolated_workspace", projectWorkspaceId: "workspace-default" },
      ]]),
      defaultProjectWorkspaceIdByProjectId: new Map([["project-1", "workspace-default"]]),
    };

    expect(resolveIssueFilterWorkspaceId(featureIssue, workspaceContext)).toBe("workspace-feature");
    expect(resolveIssueFilterWorkspaceId(executionIssue, workspaceContext)).toBe("execution-isolated");
    expect(shouldIncludeIssueFilterWorkspaceOption({ id: "workspace-feature" }, new Set(["workspace-default"]))).toBe(true);
    expect(shouldIncludeIssueFilterWorkspaceOption(
      { id: "execution-isolated", mode: "isolated_workspace", projectWorkspaceId: "workspace-default" },
      new Set(["workspace-default"]),
    )).toBe(true);
  });
});
