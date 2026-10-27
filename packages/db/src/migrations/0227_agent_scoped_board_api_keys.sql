ALTER TABLE "board_api_keys" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "board_api_keys" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'board_api_keys_agent_id_agents_id_fk') THEN
  ALTER TABLE "board_api_keys" ADD CONSTRAINT "board_api_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'board_api_keys_one_owner_chk') THEN
  ALTER TABLE "board_api_keys" ADD CONSTRAINT "board_api_keys_one_owner_chk" CHECK ((user_id IS NULL) <> (agent_id IS NULL));
 END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_api_keys_agent_idx" ON "board_api_keys" USING btree ("agent_id");
