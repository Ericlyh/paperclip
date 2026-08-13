import type { WorkspaceContextBundle } from "@paperclipai/shared";
import { api } from "./client";

/**
 * Workspace context HTTP helpers (X-1 / OOP-3448 / OOP-3462).
 *
 * Read-only v0.1 surface. The issue-scoped endpoint resolves the
 * `{ error: "issue_has_no_project" }` 404 case (the UI swallows this and
 * renders an inline placeholder instead of an error banner).
 */
export const workspaceContextApi = {
  forIssue: (issueId: string) =>
    api.get<WorkspaceContextBundle>(`/issues/${encodeURIComponent(issueId)}/workspace-context`),
  forProject: (companyId: string, projectId: string) =>
    api.get<WorkspaceContextBundle>(
      `/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/workspace-context`,
    ),
};
