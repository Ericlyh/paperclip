import type { ActivityEvent, Issue } from "@paperclipai/shared";
import { isLintResidualTask, isLintResidualTaskTitle } from "./issue-filters";

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

export function getRecentDashboardActivity(
  events: ActivityEvent[],
  issuesById: ReadonlyMap<string, Issue>,
  hideLintResidualTasks: boolean,
): ActivityEvent[] {
  const visibleEvents = hideLintResidualTasks
    ? events.filter((event) => !isLintResidualTaskActivity(event, issuesById))
    : events;
  return visibleEvents.slice(0, DASHBOARD_VISIBLE_FEED_LIMIT);
}

export function getRecentDashboardIssues(
  issues: Issue[],
  hideLintResidualTasks: boolean,
): Issue[] {
  return issues
    .filter((issue) => !hideLintResidualTasks || !isLintResidualTask(issue))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, DASHBOARD_VISIBLE_FEED_LIMIT);
}
