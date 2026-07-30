import { pgTable, uuid, text, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { authUsers } from "./auth.js";
import { agents } from "./agents.js";

export const boardApiKeys = pgTable(
  "board_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // OOP-2793: dual-owner. Either userId (board/cron caller) OR agentId (harness
    // on behalf of an agent) is set, never both. Enforced by the
    // board_api_keys_one_owner_chk CHECK constraint added in migration 0095.
    userId: text("user_id").references(() => authUsers.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyHashIdx: uniqueIndex("board_api_keys_key_hash_idx").on(table.keyHash),
    userIdx: index("board_api_keys_user_idx").on(table.userId),
    agentIdx: index("board_api_keys_agent_idx").on(table.agentId),
    oneOwnerChk: check(
      "board_api_keys_one_owner_chk",
      sql`(${table.userId} IS NULL) <> (${table.agentId} IS NULL)`,
    ),
  }),
);
