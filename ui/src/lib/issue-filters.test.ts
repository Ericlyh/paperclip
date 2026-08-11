// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { Issue } from "@paperclipai/shared";
import {
  applyIssueFilters,
  countActiveIssueFilters,
  defaultIssueFilterState,
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
