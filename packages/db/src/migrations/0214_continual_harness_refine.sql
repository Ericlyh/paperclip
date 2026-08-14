-- OOP-3490 P-1: Continual Harness /refine — append-only instruction-set snapshots
-- + evidence-backed proposals with rollback.
--
-- Two tables: agent_instruction_snapshots (append-only version history) and
-- agent_refine_proposals (pending|approved|rejected|superseded|rolled_back).
-- Snapshot content stores the full bundle as jsonb; v0.1 has no diff storage.
-- Prior-snapshot FK on the proposal points to the pre-delta baseline.

CREATE TABLE IF NOT EXISTS "agent_instruction_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"source_proposal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_instruction_snapshots_version_positive_check" CHECK ("version" >= 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_instruction_snapshots_agent_version_idx"
  ON "agent_instruction_snapshots" USING btree ("agent_id","version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_instruction_snapshots_agent_created_idx"
  ON "agent_instruction_snapshots" USING btree ("agent_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_instruction_snapshots_agent_version_unique"
  ON "agent_instruction_snapshots" USING btree ("agent_id","version");
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_instruction_snapshots_company_id_companies_id_fk') THEN
		ALTER TABLE "agent_instruction_snapshots" ADD CONSTRAINT "agent_instruction_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_instruction_snapshots_agent_id_agents_id_fk') THEN
		ALTER TABLE "agent_instruction_snapshots" ADD CONSTRAINT "agent_instruction_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agent_refine_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"proposed_delta" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prior_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_agent_id" uuid,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" text,
	"decided_by_agent_id" uuid,
	"decision_note" text,
	CONSTRAINT "agent_refine_proposals_status_check"
	  CHECK ("status" in ('pending','approved','rejected','superseded','rolled_back')),
	CONSTRAINT "agent_refine_proposals_evidence_min_check"
	  CHECK (jsonb_array_length("evidence") >= 1),
	CONSTRAINT "agent_refine_proposals_proposed_delta_nonempty_check"
	  CHECK (length(btrim("proposed_delta")) > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_refine_proposals_agent_status_idx"
  ON "agent_refine_proposals" USING btree ("agent_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_refine_proposals_company_created_idx"
  ON "agent_refine_proposals" USING btree ("company_id","created_at" DESC);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_refine_proposals_company_id_companies_id_fk') THEN
		ALTER TABLE "agent_refine_proposals" ADD CONSTRAINT "agent_refine_proposals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_refine_proposals_agent_id_agents_id_fk') THEN
		ALTER TABLE "agent_refine_proposals" ADD CONSTRAINT "agent_refine_proposals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_refine_proposals_prior_snapshot_id_fk') THEN
		ALTER TABLE "agent_refine_proposals" ADD CONSTRAINT "agent_refine_proposals_prior_snapshot_id_fk" FOREIGN KEY ("prior_snapshot_id") REFERENCES "public"."agent_instruction_snapshots"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_refine_proposals_created_by_agent_id_fk') THEN
		ALTER TABLE "agent_refine_proposals" ADD CONSTRAINT "agent_refine_proposals_created_by_agent_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_refine_proposals_decided_by_agent_id_fk') THEN
		ALTER TABLE "agent_refine_proposals" ADD CONSTRAINT "agent_refine_proposals_decided_by_agent_id_fk" FOREIGN KEY ("decided_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
