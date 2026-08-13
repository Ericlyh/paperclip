import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  workspaceContextQuerySchema,
  type WorkspaceContextBundle,
  type WorkspaceContextMembers,
} from "@paperclipai/shared";
import { workspaceContextService } from "../services/workspace-context.js";
import { assertCompanyAccess } from "./authz.js";
import { notFound } from "../errors.js";
import { issueService } from "../services/issues.js";

/**
 * Workspace context HTTP routes (X-1 / OOP-3448).
 *
 * Three read-only endpoints expose the project-scoped institutional-memory
 * bundle to both the Paperclip UI and external coding agents via MCP:
 *
 * - GET /api/companies/:companyId/projects/:projectId/workspace-context
 * - GET /api/companies/:companyId/projects/:projectId/workspace-members
 * - GET /api/issues/:id/workspace-context  (scoped to the issue's project)
 *
 * All routes follow the v0.1 read-only contract; write-back is deferred.
 */

function parseQuery(req: Request): ReturnType<typeof workspaceContextQuerySchema.parse> {
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) {
      merged[key] = value[value.length - 1];
    } else if (typeof value === "string") {
      merged[key] = value;
    }
  }
  return workspaceContextQuerySchema.parse(merged);
}

export function workspaceContextRoutes(db: Db) {
  const router = Router();
  const svc = workspaceContextService(db);
  const issuesSvc = issueService(db);

  async function resolveIssueByRef(rawId: string) {
    const trimmed = rawId.trim();
    if (!trimmed) return null;
    // Identifier form: e.g. "OOP-3448" (letter prefix, dash, digits).
    const isIdentifier = /^[A-Z][A-Z0-9]*-\d+$/i.test(trimmed);
    if (isIdentifier) {
      return issuesSvc.getByIdentifier(trimmed.toUpperCase());
    }
    return issuesSvc.getById(trimmed);
  }

  router.get("/companies/:companyId/projects/:projectId/workspace-context", async (req, res) => {
    const companyId = req.params.companyId as string;
    const projectId = req.params.projectId as string;
    assertCompanyAccess(req, companyId);
    const query = parseQuery(req);
    const bundle: WorkspaceContextBundle = await svc.getBundleForProject(
      companyId,
      projectId,
      query,
    );
    if (!bundle.project) {
      throw notFound("Project not found");
    }
    res.json(bundle);
  });

  router.get("/companies/:companyId/projects/:projectId/workspace-members", async (req, res) => {
    const companyId = req.params.companyId as string;
    const projectId = req.params.projectId as string;
    assertCompanyAccess(req, companyId);
    const members: WorkspaceContextMembers = await svc.getMembersForProject(companyId, projectId);
    res.json(members);
  });

  router.get("/issues/:id/workspace-context", async (req, res) => {
    const rawId = req.params.id as string;
    const issue = await resolveIssueByRef(rawId);
    if (!issue) {
      throw notFound("Issue not found");
    }
    assertCompanyAccess(req, issue.companyId);

    if (!issue.projectId) {
      res.status(404).json({ error: "issue_has_no_project" });
      return;
    }

    const query = parseQuery(req);
    const bundle: WorkspaceContextBundle = await svc.getBundleForProject(
      issue.companyId,
      issue.projectId,
      query,
    );
    res.json(bundle);
  });

  return router;
}
