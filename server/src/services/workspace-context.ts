import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  authUsers,
  companyMemberships,
  decisions,
  documents,
  heartbeatRuns,
  issueDocuments,
  issues,
  agentMemberships,
} from "@paperclipai/db";
import {
  WORKSPACE_CONTEXT_DEFAULTS,
  type WorkspaceContextBundle,
  type WorkspaceContextIssueSummary,
  type WorkspaceContextMembers,
  type WorkspaceContextProject,
  type WorkspaceContextQuery,
  type WorkspaceContextRunSummary,
  type WorkspaceContextDecisionSummary,
  type WorkspaceContextDocumentSummary,
  type WorkspaceContextMember,
} from "@paperclipai/shared";
import { projectService } from "./projects.js";

/**
 * Workspace context aggregator (X-1 / OOP-3448).
 *
 * Aggregates the project-scoped institutional-memory bundle surfaced by the
 * Workspace HTTP routes and MCP tools. The implementation intentionally uses
 * direct table reads rather than composing existing service endpoints so each
 * query can be shaped for the bundle's sort + limit contract.
 */

const OPEN_ISSUE_STATUSES: ReadonlyArray<string> = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
];

function pickLimit(
  query: WorkspaceContextQuery | undefined,
  key: "issueLimit" | "decisionLimit" | "documentLimit" | "runLimit",
  fallback: number,
): number {
  if (!query) return fallback;
  const value = query[key];
  return typeof value === "number" && value > 0 ? value : fallback;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

async function listProjectIssueIds(
  db: Db,
  companyId: string,
  projectId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.companyId, companyId), eq(issues.projectId, projectId)));
  return rows.map((row) => row.id);
}

function issueIdInAnySql(column: typeof heartbeatRuns.contextSnapshot, ids: string[]) {
  if (ids.length === 0) return sql`FALSE`;
  const literals = ids.map((id) => sql`${id}::uuid`);
  return sql`${column} ->> 'issueId' IN (${sql.join(literals, sql`, `)})`;
}

export function workspaceContextService(db: Db) {
  const projectsSvc = projectService(db);

  async function getProjectRecord(
    companyId: string,
    projectId: string,
  ): Promise<WorkspaceContextProject | null> {
    const project = await projectsSvc.getById(projectId);
    if (!project || project.companyId !== companyId) return null;
    return {
      id: project.id,
      companyId: project.companyId,
      name: project.name,
      description: project.description ?? null,
      status: project.status,
      color: project.color ?? null,
      icon: project.icon ?? null,
      leadAgentId: project.leadAgentId ?? null,
      urlKey: project.urlKey ?? null,
      goalIds: project.goalIds ?? [],
      goals: (project.goals ?? []).map((goal) => ({
        id: goal.id,
        title: goal.title ?? null,
      })),
      updatedAt: toIso(project.updatedAt as Date | string | null | undefined),
      createdAt: toIso(project.createdAt as Date | string | null | undefined),
    };
  }

  async function listRecentIssues(
    companyId: string,
    projectId: string,
    limit: number,
  ): Promise<WorkspaceContextIssueSummary[]> {
    const rows = await db
      .select({
        id: issues.id,
        identifier: issues.identifier,
        title: issues.title,
        status: issues.status,
        priority: issues.priority,
        assigneeAgentId: issues.assigneeAgentId,
        assigneeUserId: issues.assigneeUserId,
        updatedAt: issues.updatedAt,
        createdAt: issues.createdAt,
      })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), eq(issues.projectId, projectId)))
      .orderBy(desc(issues.updatedAt), desc(issues.createdAt), desc(issues.id))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      identifier: row.identifier ?? null,
      title: row.title,
      status: row.status,
      priority: row.priority ?? null,
      assigneeAgentId: row.assigneeAgentId ?? null,
      assigneeUserId: row.assigneeUserId ?? null,
      updatedAt: toIso(row.updatedAt),
      createdAt: toIso(row.createdAt),
    }));
  }

  async function listRecentDecisions(
    companyId: string,
    projectIssueIds: string[],
    limit: number,
  ): Promise<WorkspaceContextDecisionSummary[]> {
    if (projectIssueIds.length === 0 || limit === 0) return [];
    const rows = await db
      .select({
        id: decisions.id,
        bundleId: decisions.bundleId,
        originIssueId: decisions.originIssueId,
        originIssueIdentifier: issues.identifier,
        title: decisions.title,
        status: decisions.status,
        executionStatus: decisions.executionStatus,
        createdAt: decisions.createdAt,
        updatedAt: decisions.updatedAt,
      })
      .from(decisions)
      .innerJoin(issues, eq(issues.id, decisions.originIssueId))
      .where(
        and(eq(decisions.companyId, companyId), inArray(decisions.originIssueId, projectIssueIds)),
      )
      .orderBy(desc(decisions.updatedAt), desc(decisions.createdAt), desc(decisions.id))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      bundleId: row.bundleId ?? null,
      originIssueId: row.originIssueId ?? null,
      originIssueIdentifier: row.originIssueIdentifier ?? null,
      title: row.title,
      status: row.status ?? null,
      executionStatus: row.executionStatus ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    }));
  }

  async function listRecentDocuments(
    companyId: string,
    projectIssueIds: string[],
    limit: number,
  ): Promise<WorkspaceContextDocumentSummary[]> {
    if (projectIssueIds.length === 0 || limit === 0) return [];
    const rows = await db
      .selectDistinct({
        id: documents.id,
        title: documents.title,
        format: documents.format,
        latestRevisionNumber: documents.latestRevisionNumber,
        updatedAt: documents.updatedAt,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .innerJoin(issueDocuments, eq(issueDocuments.documentId, documents.id))
      .where(and(eq(documents.companyId, companyId), inArray(issueDocuments.issueId, projectIssueIds)))
      .orderBy(desc(documents.updatedAt), desc(documents.createdAt), desc(documents.id))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      title: row.title ?? null,
      format: row.format ?? null,
      latestRevisionNumber: row.latestRevisionNumber ?? null,
      updatedAt: toIso(row.updatedAt),
      createdAt: toIso(row.createdAt),
    }));
  }

  async function listRecentRuns(
    companyId: string,
    projectIssueIds: string[],
    limit: number,
  ): Promise<WorkspaceContextRunSummary[]> {
    if (projectIssueIds.length === 0 || limit === 0) return [];
    const rows = await db
      .select({
        runId: heartbeatRuns.id,
        agentId: heartbeatRuns.agentId,
        agentName: agents.name,
        adapterType: agents.adapterType,
        status: heartbeatRuns.status,
        startedAt: heartbeatRuns.startedAt,
        finishedAt: heartbeatRuns.finishedAt,
        createdAt: heartbeatRuns.createdAt,
        invocationSource: heartbeatRuns.invocationSource,
        errorCode: heartbeatRuns.errorCode,
      })
      .from(heartbeatRuns)
      .innerJoin(agents, and(eq(agents.id, heartbeatRuns.agentId), eq(agents.companyId, heartbeatRuns.companyId)))
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          isNotNull(heartbeatRuns.contextSnapshot),
          issueIdInAnySql(heartbeatRuns.contextSnapshot, projectIssueIds),
        ),
      )
      .orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id))
      .limit(limit);
    return rows.map((row) => ({
      runId: row.runId,
      agentId: row.agentId ?? null,
      agentName: row.agentName ?? null,
      adapterType: row.adapterType ?? null,
      status: row.status ?? null,
      startedAt: toIso(row.startedAt),
      finishedAt: toIso(row.finishedAt),
      createdAt: toIso(row.createdAt),
      invocationSource: row.invocationSource ?? null,
      errorCode: row.errorCode ?? null,
    }));
  }

  async function listMembers(
    companyId: string,
    projectId: string,
  ): Promise<WorkspaceContextMembers> {
    const projectIssueIds = await listProjectIssueIds(db, companyId, projectId);

    const userRows = await db
      .select({
        userId: companyMemberships.principalId,
        role: companyMemberships.membershipRole,
        status: companyMemberships.status,
        createdAt: companyMemberships.createdAt,
      })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.status, "active"),
        ),
      )
      .orderBy(desc(companyMemberships.createdAt), desc(companyMemberships.principalId));

    const userMap = new Map<string, WorkspaceContextMember>();
    for (const row of userRows) {
      userMap.set(row.userId, { id: row.userId, name: row.userId, role: row.role ?? null });
    }

    if (projectIssueIds.length > 0) {
      const involvedUserRows = await db
        .selectDistinct({
          assigneeUserId: issues.assigneeUserId,
          creatorUserId: issues.createdByUserId,
        })
        .from(issues)
        .where(and(eq(issues.companyId, companyId), inArray(issues.id, projectIssueIds)));

      for (const row of involvedUserRows) {
        if (row.assigneeUserId && !userMap.has(row.assigneeUserId)) {
          userMap.set(row.assigneeUserId, { id: row.assigneeUserId, name: row.assigneeUserId, role: "assignee" });
        }
        if (row.creatorUserId && !userMap.has(row.creatorUserId)) {
          userMap.set(row.creatorUserId, { id: row.creatorUserId, name: row.creatorUserId, role: "creator" });
        }
      }

      const userIdList = Array.from(userMap.keys());
      if (userIdList.length > 0) {
        const userProfileRows = await db
          .select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
          .from(authUsers)
          .where(inArray(authUsers.id, userIdList));
        for (const profile of userProfileRows) {
          const existing = userMap.get(profile.id);
          if (existing) {
            userMap.set(profile.id, {
              ...existing,
              name: profile.name || profile.email || existing.name,
            });
          }
        }
      }
    }

    const agentRowsFromMemberships = await db
      .selectDistinct({
        agentId: agentMemberships.agentId,
        state: agentMemberships.state,
      })
      .from(agentMemberships)
      .where(and(eq(agentMemberships.companyId, companyId), eq(agentMemberships.state, "joined")));

    const agentIds = new Set(agentRowsFromMemberships.map((row) => row.agentId));

    if (projectIssueIds.length > 0) {
      const involvedAgentRows = await db
        .selectDistinct({ assigneeAgentId: issues.assigneeAgentId })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            inArray(issues.id, projectIssueIds),
            isNotNull(issues.assigneeAgentId),
          ),
        );
      for (const row of involvedAgentRows) {
        if (row.assigneeAgentId) agentIds.add(row.assigneeAgentId);
      }
    }

    const agentProfiles = agentIds.size
      ? await db
          .select({
            id: agents.id,
            name: agents.name,
            adapterType: agents.adapterType,
            role: agents.role,
          })
          .from(agents)
          .where(and(eq(agents.companyId, companyId), inArray(agents.id, Array.from(agentIds))))
      : [];

    const agentsList: WorkspaceContextMember[] = agentProfiles.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role ?? row.adapterType ?? null,
    }));

    const usersList: WorkspaceContextMember[] = Array.from(userMap.values());

    return { users: usersList, agents: agentsList };
  }

  async function getBundleForProject(
    companyId: string,
    projectId: string,
    query?: WorkspaceContextQuery,
  ): Promise<WorkspaceContextBundle> {
    const project = await getProjectRecord(companyId, projectId);
    const projectIssueIds = project
      ? await listProjectIssueIds(db, companyId, projectId)
      : [];

    const issueLimit = pickLimit(query, "issueLimit", WORKSPACE_CONTEXT_DEFAULTS.recentIssuesLimit);
    const decisionLimit = pickLimit(query, "decisionLimit", WORKSPACE_CONTEXT_DEFAULTS.recentDecisionsLimit);
    const documentLimit = pickLimit(query, "documentLimit", WORKSPACE_CONTEXT_DEFAULTS.recentDocumentsLimit);
    const runLimit = pickLimit(query, "runLimit", WORKSPACE_CONTEXT_DEFAULTS.recentRunsLimit);

    const [recentIssues, recentDecisions, recentDocuments, recentRuns, members] = await Promise.all([
      project ? listRecentIssues(companyId, projectId, issueLimit) : Promise.resolve([]),
      listRecentDecisions(companyId, projectIssueIds, decisionLimit),
      listRecentDocuments(companyId, projectIssueIds, documentLimit),
      listRecentRuns(companyId, projectIssueIds, runLimit),
      project ? listMembers(companyId, projectId) : Promise.resolve({ users: [], agents: [] } as WorkspaceContextMembers),
    ]);

    const openIssueCount = recentIssues.filter((row: WorkspaceContextIssueSummary) =>
      OPEN_ISSUE_STATUSES.includes(row.status),
    ).length;

    return {
      project,
      recentIssues,
      recentDecisions,
      recentDocuments,
      recentRuns,
      members,
      summary: {
        issueCount: recentIssues.length,
        openIssueCount,
        decisionCount: recentDecisions.length,
        documentCount: recentDocuments.length,
        runCount: recentRuns.length,
        memberCount: members.users.length + members.agents.length,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  async function getBundleForIssue(
    issueId: string,
    query?: WorkspaceContextQuery,
  ): Promise<WorkspaceContextBundle> {
    const issue = await db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        projectId: issues.projectId,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
    if (!issue) {
      return {
        project: null,
        recentIssues: [],
        recentDecisions: [],
        recentDocuments: [],
        recentRuns: [],
        members: { users: [], agents: [] },
        summary: {
          issueCount: 0,
          openIssueCount: 0,
          decisionCount: 0,
          documentCount: 0,
          runCount: 0,
          memberCount: 0,
          generatedAt: new Date().toISOString(),
        },
      };
    }
    if (!issue.projectId) {
      const err = new Error("issue_has_no_project");
      (err as Error & { code?: string }).code = "issue_has_no_project";
      throw err;
    }
    return getBundleForProject(issue.companyId, issue.projectId, query);
  }

  return {
    getBundleForProject,
    getBundleForIssue,
    getMembersForProject: listMembers,
  };
}

export const workspaceContextServiceIssueHasNoProjectErrorCode = "issue_has_no_project";
