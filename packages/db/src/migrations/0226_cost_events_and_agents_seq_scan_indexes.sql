-- OOP-3114: cover the two cost_events predicates that the seq-scan counters
-- show running unindexed, plus the one agents predicate that had no index.
--
-- cost_events.heartbeat_run_id is 100% distinct (pg_stats n_distinct = -1) and
-- services/status-cards.ts selects it without company_id, so the existing
-- (company_id, heartbeat_run_id) index could only be used by scanning its whole
-- extent. Measured on the live board: 0.774 ms -> 0.036 ms (21.5x), and the
-- planner moves from cost_events_company_heartbeat_run_idx to this index.
--
-- cost_events.issue_id is ~99.7% distinct (n_distinct = -0.2887) and had no
-- index at all, so every per-issue cost lookup seq-scanned all 12,426 rows.
-- Measured on the live board: 0.993 ms (full seq scan) -> 0.018 ms (55x).
--
-- agents.role had no index. The board indexes (company_id, status),
-- (company_id, reports_to) and (company_id, default_environment_id), but the
-- recovery sweep picks escalation candidates with
-- WHERE company_id = $1 AND role IN ('cto','ceo').
--
-- CONCURRENTLY is unavailable because Drizzle migrations run transactionally.
-- The build cost is milliseconds: the two cost_events indexes build at 232 kB
-- and 400 kB over 12,426 rows, and the agents index at 16 kB over 22 rows.
CREATE INDEX IF NOT EXISTS "cost_events_heartbeat_run_id_idx" ON "cost_events" USING btree ("heartbeat_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_events_issue_id_idx" ON "cost_events" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_company_role_idx" ON "agents" USING btree ("company_id","role");
