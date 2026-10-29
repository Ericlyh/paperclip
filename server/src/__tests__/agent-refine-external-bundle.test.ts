import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { agents, companies, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { agentRefineService } from "../services/agent-refine.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres agent refine external bundle tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const HOST_SECRET = "host-only-instruction-secret";

/**
 * An agent whose instruction bundle points outside the instance root holds
 * host files. The refine subsystem captures the bundle into a snapshot that is
 * readable over the API, so it must never read an external bundle — not even
 * for an instance admin, and not even transiently.
 */
describeEmbeddedPostgres("agent refine external instruction bundle", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let externalRoot: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-refine-external-bundle-");
    db = createDb(tempDb.connectionString);
    externalRoot = await mkdtemp(path.join(tmpdir(), "paperclip-external-bundle-"));
    await writeFile(path.join(externalRoot, "AGENTS.md"), `# Host instructions\n${HOST_SECRET}\n`);
  }, 30_000);

  afterEach(async () => {
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("captures no host files for an external instructions bundle", async () => {
    const [company] = await db
      .insert(companies)
      .values({ name: "Refine External Bundle Co", issuePrefix: "REX" })
      .returning();
    const [agent] = await db
      .insert(agents)
      .values({
        companyId: company.id,
        name: "External Bundle Agent",
        role: "engineer",
        adapterType: "claude_local",
        adapterConfig: {
          instructionsBundleMode: "external",
          instructionsRootPath: externalRoot,
          instructionsEntryFile: "AGENTS.md",
        },
      })
      .returning();

    const svc = agentRefineService(db);
    const result = await svc.propose(
      agent.id,
      {
        proposedDelta: JSON.stringify({ files: { "AGENTS.md": "# new\n" } }),
        evidence: [{ issueId: "OOP-1", snippet: "from prior run" }],
      },
      { userId: null, agentId: null },
    );

    const content = result.snapshot.content as {
      rootPath: string | null;
      entryFile: string;
      mode: string | null;
      files: Record<string, string>;
    };
    expect(content.mode).toBe("external");
    expect(content.files).toEqual({});
    expect(content.rootPath).toBeNull();
    expect(JSON.stringify(result.snapshot)).not.toContain(HOST_SECRET);
    expect(JSON.stringify(result.snapshot)).not.toContain(externalRoot);
  });
});
