-- Per-routine model profile. Lets a routine pin an agent model profile (currently
-- only "cheap") so scheduled fires resolve that profile instead of the assignee
-- agent's default adapter config. Nullable: NULL means "no pinned profile" and the
-- fire falls back to the agent's normal configuration, which is the behaviour of
-- every routine created before this migration.
ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "model_profile" text;
