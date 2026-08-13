// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { WorkspaceContextBundle } from "@paperclipai/shared";
import { IssueWorkspaceContextTab } from "./IssueWorkspaceContextTab";
import { ApiError } from "../api/client";

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const { forIssue } = vi.hoisted(() => ({ forIssue: vi.fn() }));

vi.mock("../api/workspaceContext", () => ({
  workspaceContextApi: { forIssue },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

const ISSUE_ID = "cba3d8d0-91c8-4f7e-983f-4ee3f0f52003";

const bundleFixture: WorkspaceContextBundle = {
  project: {
    id: "9b6e5a6a-1111-4111-8111-111111111111",
    companyId: "ed30ea86-a66e-434b-b307-6776a59f7698",
    name: "Xirp + Premium Agent + Paperclip",
    description: "Comparison + adaptability project",
    status: "planned",
    urlKey: "xirp-premium-agent-paperclip",
  },
  recentIssues: [
    {
      id: "issue-1",
      identifier: "OOP-3395",
      title: "Xirp",
      status: "done",
      priority: "medium",
      assigneeAgentId: null,
      assigneeUserId: null,
    },
  ],
  recentDecisions: [
    {
      id: "decision-1",
      title: "Borrow 2-3 Workspace patterns, not the whole Xirp product",
      status: "accepted",
      executionStatus: "completed",
      originIssueId: "cba3d8d0-91c8-4f7e-983f-4ee3f0f52003",
      originIssueIdentifier: "OOP-3395",
    },
  ],
  recentDocuments: [
    {
      id: "doc-1",
      title: "Xirp vs Paperclip — Comparison & Adaptability",
      format: "markdown",
      latestRevisionNumber: 3,
    },
  ],
  recentRuns: [
    {
      runId: "run-1",
      agentId: "agent-1",
      agentName: "Claude Code (host)",
      status: "completed",
      startedAt: "2026-08-13T10:00:00.000Z",
      createdAt: "2026-08-13T10:00:00.000Z",
    },
  ],
  members: {
    users: [{ id: "user-1", name: "Molt", role: "owner" }],
    agents: [{ id: "agent-1", name: "Claude Code (host)", role: "executor" }],
  },
  summary: {
    issueCount: 5,
    openIssueCount: 2,
    decisionCount: 1,
    documentCount: 1,
    runCount: 1,
    memberCount: 2,
    generatedAt: "2026-08-13T15:00:00.000Z",
  },
};

describe("IssueWorkspaceContextTab", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(async () => {
    const currentRoot = root;
    if (currentRoot) {
      await act(async () => {
        currentRoot.unmount();
      });
    }
    queryClient.clear();
    container.remove();
    document.body.innerHTML = "";
    forIssue.mockReset();
  });

  async function renderTab() {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <IssueWorkspaceContextTab issueId={ISSUE_ID} />
        </QueryClientProvider>,
      );
    });
    await flushReact();
  }

  it("renders the bundle sections when the endpoint returns a project", async () => {
    forIssue.mockResolvedValue(bundleFixture);
    await renderTab();
    expect(container.textContent).toContain("Xirp + Premium Agent + Paperclip");
    expect(container.textContent).toContain("Summary");
    expect(container.textContent).toContain("Recent issues");
    expect(container.textContent).toContain("Recent decisions");
    expect(container.textContent).toContain("Recent documents");
    expect(container.textContent).toContain("Recent runs");
    expect(container.textContent).toContain("Members");
    expect(container.textContent).toContain("OOP-3395");
    expect(container.textContent).toContain("Borrow 2-3 Workspace patterns");
    expect(container.textContent).toContain("Xirp vs Paperclip");
    expect(container.textContent).toContain("Claude Code (host)");
  });

  it("renders the no-project placeholder when the server returns 404 issue_has_no_project", async () => {
    const apiError = new ApiError("issue_has_no_project", 404, {
      error: "issue_has_no_project",
    });
    forIssue.mockRejectedValue(apiError);
    await renderTab();
    expect(container.textContent).toContain("No project linkage");
    expect(container.textContent).toContain("isn't assigned to a project");
  });

  it("renders an empty-state message for sections with no entries", async () => {
    const emptyBundle: WorkspaceContextBundle = {
      ...bundleFixture,
      recentIssues: [],
      recentDecisions: [],
      recentDocuments: [],
      recentRuns: [],
      members: { users: [], agents: [] },
      summary: {
        ...bundleFixture.summary,
        issueCount: 0,
        openIssueCount: 0,
        decisionCount: 0,
        documentCount: 0,
        runCount: 0,
        memberCount: 0,
      },
    };
    forIssue.mockResolvedValue(emptyBundle);
    await renderTab();
    expect(container.textContent).toContain("No recent project issues.");
    expect(container.textContent).toContain("No recent decisions.");
    expect(container.textContent).toContain("No recent documents.");
    expect(container.textContent).toContain("No recent heartbeat runs.");
    expect(container.textContent).toContain("No members associated with this project yet.");
  });
});
