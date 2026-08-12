import type { ActivityEvent, Issue } from "@paperclipai/shared";
import {
  isHourlyLogRotationTask,
  isHourlyLogRotationTaskTitle,
  isLintResidualTask,
  isLintResidualTaskTitle,
  isProductivityReviewIssue,
  PRODUCTIVITY_REVIEW_ORIGIN_KIND,
} from "./issue-filters";

export const DASHBOARD_VISIBLE_FEED_LIMIT = 20;
export const DASHBOARD_ACTIVITY_FETCH_LIMIT = 100;
export const DASHBOARD_ISSUE_FETCH_LIMIT = 500;

const ACTIVITY_ISSUE_ID_KEYS = [
  "issueId",
  "sourceIssueId",
  "createdIssueId",
  "linkedIssueId",
  "executionIssueId",
] as const;

function detailString(details: Record<string, unknown> | null, key: string): string | null {
  const value = details?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function activityIssueId(event: Pick<ActivityEvent, "entityType" | "entityId" | "details">): string | null {
  if (event.entityType === "issue") return event.entityId;
  for (const key of ACTIVITY_ISSUE_ID_KEYS) {
    const issueId = detailString(event.details, key);
    if (issueId) return issueId;
  }
  return null;
}

export function isLintResidualTaskActivity(
  event: Pick<ActivityEvent, "entityType" | "entityId" | "details">,
  issuesById: ReadonlyMap<string, Issue>,
): boolean {
  const issueId = activityIssueId(event);
  const issue = issueId ? issuesById.get(issueId) : undefined;
  if (issue) return isLintResidualTask(issue);

  return ["issueTitle", "title"]
    .map((key) => detailString(event.details, key))
    .some((title) => isLintResidualTaskTitle(title));
}

export function isHourlyLogRotationTaskActivity(
  event: Pick<ActivityEvent, "entityType" | "entityId" | "details">,
  issuesById: ReadonlyMap<string, Issue>,
): boolean {
  const issueId = activityIssueId(event);
  const issue = issueId ? issuesById.get(issueId) : undefined;
  if (issue) return isHourlyLogRotationTask(issue);

  return ["issueTitle", "title"]
    .map((key) => detailString(event.details, key))
    .some((title) => isHourlyLogRotationTaskTitle(title));
}

export function isProductivityReviewActivity(
  event: Pick<ActivityEvent, "entityType" | "entityId" | "details">,
  issuesById: ReadonlyMap<string, Issue>,
): boolean {
  const issueId = activityIssueId(event);
  const issue = issueId ? issuesById.get(issueId) : undefined;
  if (issue) return isProductivityReviewIssue(issue);
  return event.details?.originKind === PRODUCTIVITY_REVIEW_ORIGIN_KIND;
}

export function getRecentDashboardActivity(
  events: ActivityEvent[],
  issuesById: ReadonlyMap<string, Issue>,
  hideLintResidualTasks: boolean,
  hideProductivityReviewIssues: boolean,
  hideHourlyLogRotationTasks = false,
): ActivityEvent[] {
  return events
    .filter((event) => !hideLintResidualTasks || !isLintResidualTaskActivity(event, issuesById))
    .filter(
      (event) => !hideHourlyLogRotationTasks || !isHourlyLogRotationTaskActivity(event, issuesById),
    )
    .filter(
      (event) => !hideProductivityReviewIssues || !isProductivityReviewActivity(event, issuesById),
    )
    .slice(0, DASHBOARD_VISIBLE_FEED_LIMIT);
}

export function getRecentDashboardIssues(
  issues: Issue[],
  hideLintResidualTasks: boolean,
  hideProductivityReviewIssues: boolean,
  hideHourlyLogRotationTasks = false,
): Issue[] {
  return issues
    .filter((issue) => !hideLintResidualTasks || !isLintResidualTask(issue))
    .filter((issue) => !hideHourlyLogRotationTasks || !isHourlyLogRotationTask(issue))
    .filter(
      (issue) => !hideProductivityReviewIssues || !isProductivityReviewIssue(issue),
    )
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, DASHBOARD_VISIBLE_FEED_LIMIT);
}
