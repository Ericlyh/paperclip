import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { pluginOperationalReadCompanyIds } from "../routes/plugins.js";

/**
 * Plugin operational rows (logs, job runs, webhook deliveries) are keyed by
 * plugin or job id, which carries no company scope of its own. These routes
 * must therefore scope the read to the caller's companies, otherwise a board
 * member of one company can read another company's rows.
 *
 * The DB-backed counterpart lives in plugin-tenant-isolation.test.ts and is
 * skipped on hosts without embedded Postgres, so the scope decision is
 * asserted here directly.
 */
function boardRequest(actor: {
  companyIds?: string[];
  source?: string;
  isInstanceAdmin?: boolean;
}): Request {
  return {
    actor: {
      type: "board",
      userId: "user-1",
      source: actor.source ?? "session",
      companyIds: actor.companyIds ?? [],
      memberships: [],
      ...(actor.isInstanceAdmin === undefined ? {} : { isInstanceAdmin: actor.isInstanceAdmin }),
    },
  } as unknown as Request;
}

describe("pluginOperationalReadCompanyIds", () => {
  it("scopes a board member to its own companies", () => {
    expect(pluginOperationalReadCompanyIds(boardRequest({ companyIds: ["company-a"] }))).toEqual([
      "company-a",
    ]);
  });

  it("returns no companies for a board member with none, so the query must return no rows", () => {
    expect(pluginOperationalReadCompanyIds(boardRequest({ companyIds: [] }))).toEqual([]);
  });

  it("treats a board member with no companyIds as readable by no company", () => {
    expect(pluginOperationalReadCompanyIds(boardRequest({}))).toEqual([]);
  });

  it("returns null (all companies) for an instance admin", () => {
    expect(
      pluginOperationalReadCompanyIds(
        boardRequest({ companyIds: ["company-a"], isInstanceAdmin: true }),
      ),
    ).toBeNull();
  });

  it("returns null (all companies) for a local implicit actor", () => {
    expect(
      pluginOperationalReadCompanyIds(
        boardRequest({ companyIds: ["company-a"], source: "local_implicit" }),
      ),
    ).toBeNull();
  });

  it("returns no companies for an agent actor", () => {
    const req = {
      actor: { type: "agent", agentId: "agent-1", companyId: "company-a" },
    } as unknown as Request;
    expect(pluginOperationalReadCompanyIds(req)).toEqual([]);
  });
});
