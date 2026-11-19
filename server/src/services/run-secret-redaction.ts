import { createHash } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns } from "@paperclipai/db";
import { REDACTED_EVENT_VALUE } from "../redaction.js";
import { getSecretProvider } from "../secrets/provider-registry.js";
import type { StoredSecretVersionMaterial } from "../secrets/types.js";

const REGISTRY_KEY = "paperclipSecretRedactions";

/**
 * The registry slice on its own.
 *
 * Selecting the whole `context_snapshot` drags the wake payload and the issue
 * snapshot along with it — heartbeat_runs is a few hundred MB — and the
 * redaction only ever reads this one key.
 */
const registrySlice = sql`${heartbeatRuns.contextSnapshot} -> ${REGISTRY_KEY}`;

type RegistryEntry = {
  fingerprintSha256: string;
  material: StoredSecretVersionMaterial;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function registryEntriesFromList(raw: unknown): RegistryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    const entry = asRecord(value);
    const material = asRecord(entry?.material);
    return typeof entry?.fingerprintSha256 === "string" && material
      ? [{ fingerprintSha256: entry.fingerprintSha256, material }]
      : [];
  });
}

function registryEntries(contextSnapshot: unknown): RegistryEntry[] {
  const context = asRecord(contextSnapshot);
  return registryEntriesFromList(context?.[REGISTRY_KEY]);
}

function redactText(input: string, values: string[]) {
  return values.reduce(
    (result, value) => value.length > 0 ? result.split(value).join(REDACTED_EVENT_VALUE) : result,
    input,
  );
}

export function redactRegisteredSecretValues<T>(input: T, values: string[]): T {
  if (typeof input === "string") return redactText(input, values) as T;
  if (Array.isArray(input)) return input.map((value) => redactRegisteredSecretValues(value, values)) as T;
  // Dates carry no redactable text; rebuilding them via Object.entries would
  // collapse them to `{}` and break every timestamp in redacted responses.
  if (input instanceof Date) return input;
  const record = asRecord(input);
  if (!record) return input;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => key !== REGISTRY_KEY)
      .map(([key, value]) => [key, redactRegisteredSecretValues(value, values)]),
  ) as T;
}

export function createRunSecretRedactionRegistry(db: Db) {
  const provider = getSecretProvider("local_encrypted");

  async function valuesForRuns(rows: Array<{ registry: unknown }>) {
    const entries = rows.flatMap((row) => registryEntriesFromList(row.registry));
    const unique = new Map(entries.map((entry) => [entry.fingerprintSha256, entry]));
    const values = await Promise.all(
      [...unique.values()].map((entry) => provider.resolveVersion({
        material: entry.material,
        externalRef: null,
      })),
    );
    return values.sort((left, right) => right.length - left.length);
  }

  async function valuesForRun(companyId: string, runId: string) {
    const rows = await db.select({ registry: registrySlice })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)));
    return valuesForRuns(rows);
  }

  async function valuesForIssue(companyId: string, issueId: string) {
    const rows = await db.select({ registry: registrySlice })
      .from(heartbeatRuns)
      .where(and(
        eq(heartbeatRuns.companyId, companyId),
        or(
          sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`,
          sql`${heartbeatRuns.contextSnapshot} -> 'paperclipIssue' ->> 'id' = ${issueId}`,
        ),
      ));
    return valuesForRuns(rows);
  }

  /**
   * Secret values per run id, from a single query.
   *
   * The list routes used to call redactForRun per run, and each call ran its
   * own `SELECT context_snapshot` — 200 of them for a company-wide list, each
   * pulling a large JSONB blob.
   */
  async function valuesByRunId(companyId: string, runIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (runIds.length === 0) return result;
    const rows = await db.select({ id: heartbeatRuns.id, registry: registrySlice })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.id, runIds)));

    const entriesByRun = new Map<string, RegistryEntry[]>();
    const allEntries: RegistryEntry[] = [];
    for (const row of rows) {
      const entries = registryEntriesFromList(row.registry);
      entriesByRun.set(row.id, entries);
      allEntries.push(...entries);
    }
    const unique = new Map(allEntries.map((entry) => [entry.fingerprintSha256, entry]));
    const decrypted = await Promise.all(
      [...unique.entries()].map(async ([fingerprint, entry]) => {
        const value = await provider.resolveVersion({ material: entry.material, externalRef: null });
        return [fingerprint, value] as const;
      }),
    );
    const valueByFingerprint = new Map(decrypted);
    for (const [runId, entries] of entriesByRun) {
      const values = entries
        .map((entry) => valueByFingerprint.get(entry.fingerprintSha256))
        .filter((value): value is string => typeof value === "string");
      result.set(runId, values.sort((left, right) => right.length - left.length));
    }
    return result;
  }

  return {
    register: async (companyId: string, runId: string, value: string) => {
      const fingerprintSha256 = createHash("sha256").update(value).digest("hex");
      await db.transaction(async (tx) => {
        const row = await tx.select({ contextSnapshot: heartbeatRuns.contextSnapshot })
          .from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)))
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!row) throw new Error("Heartbeat run redaction registration failed");
        if (registryEntries(row.contextSnapshot).some((entry) => entry.fingerprintSha256 === fingerprintSha256)) {
          return;
        }
        const prepared = await provider.createSecret({ value });
        const entry: RegistryEntry = { fingerprintSha256, material: prepared.material };
        const contextSnapshot = asRecord(row.contextSnapshot) ?? {};
        const currentEntries = Array.isArray(contextSnapshot[REGISTRY_KEY])
          ? contextSnapshot[REGISTRY_KEY]
          : [];
        await tx.update(heartbeatRuns)
          .set({
            contextSnapshot: { ...contextSnapshot, [REGISTRY_KEY]: [...currentEntries, entry] },
            updatedAt: new Date(),
          })
          .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)));
      });
    },
    redactForRun: async <T>(companyId: string, runId: string, value: T): Promise<T> =>
      redactRegisteredSecretValues(value, await valuesForRun(companyId, runId)),
    /**
     * Redact a list of runs with one query.
     *
     * Each run is redacted with the secret values registered against that run,
     * exactly as redactForRun did — the difference is that the values are
     * fetched for the whole list at once instead of once per run.
     */
    redactRuns: async <T extends { id: string }>(companyId: string, runs: T[]): Promise<T[]> => {
      const valuesByRun = await valuesByRunId(companyId, runs.map((run) => run.id));
      return runs.map((run) =>
        redactRegisteredSecretValues(run, valuesByRun.get(run.id) ?? []),
      );
    },
    redactForIssue: async <T>(companyId: string, issueId: string, value: T): Promise<T> =>
      redactRegisteredSecretValues(value, await valuesForIssue(companyId, issueId)),
  };
}
