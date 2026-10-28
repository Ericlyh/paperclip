import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { environmentLeaseReadCompanyIds } from "../routes/environments.js";

/**
 * Environment rows are instance-level (no company_id), but every
 * environment_leases row belongs to exactly one company
 * (environment_leases.company_id is NOT NULL). Reading leases without a
 * company filter let a board member of any company read every other
 * company's lease rows.
 *
 * The scope decision is asserted here directly; the DB-backed behaviour is
 * covered by the environment route tests.
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

describe("environmentLeaseReadCompanyIds", () => {
  it("scopes a board member to its own companies", () => {
    expect(environmentLeaseReadCompanyIds(boardRequest({ companyIds: ["company-a"] }))).toEqual([
      "company-a",
    ]);
  });

  it("returns no companies for a board member with none, so no leases are readable", () => {
    expect(environmentLeaseReadCompanyIds(boardRequest({ companyIds: [] }))).toEqual([]);
  });

  it("returns null (every company) for an instance admin", () => {
    expect(
      environmentLeaseReadCompanyIds(
        boardRequest({ companyIds: ["company-a"], isInstanceAdmin: true }),
      ),
    ).toBeNull();
  });

  it("returns null (every company) for a local implicit actor", () => {
    expect(
      environmentLeaseReadCompanyIds(
        boardRequest({ companyIds: ["company-a"], source: "local_implicit" }),
      ),
    ).toBeNull();
  });

  it("returns no companies for an agent actor", () => {
    const req = {
      actor: { type: "agent", agentId: "agent-1", companyId: "company-a" },
    } as unknown as Request;
    expect(environmentLeaseReadCompanyIds(req)).toEqual([]);
  });
});
