-- 0095: heartbeat_runs context_snapshot JSONB indexes (OOP-3109)
--
-- Heartbeat-tick queries repeatedly look up heartbeat_runs by issue / task /
-- comment ids stored inside the JSONB context_snapshot column, e.g.
--   WHERE company_id = $1
--     AND context_snapshot ->> 'issueId' = $X
--     [OR context_snapshot ->> 'taskId' = $X]
--     [OR context_snapshot ->> 'commentId' = $X]
--
-- Without an index, each lookup is a ~180 ms seq scan on a 13 MB table that
-- is 10 500+ rows wide and growing. With 10+ concurrent heartbeat ticks each
-- firing ~6 of these queries, the cumulative load saturates the connection
-- pool and every other Paperclip API consumer (including GET
-- /api/companies/{id}/issues) queues behind it, producing the 47-150 s p50
-- seen in the OOP-3109 reproducer.
--
-- The pre-existing btree indexes (heartbeat_runs_company_*) cannot help
-- because (context_snapshot->>'issueId') is a JSON path expression, not a
-- column.
--
-- This migration adds three btree functional indexes — one per JSONB path the
-- heartbeat code reads. We deliberately use a btree on the ->> text
-- expression (not GIN on the jsonb) because:
--   1. All three access patterns are equality lookups against a short text
--      path; btree functional indexes handle that in O(log n) page reads
--      whereas GIN would need a bitmap scan with much higher per-page CPU.
--   2. The expressions are pure and IMMUTABLE, so the planner can fold them
--      into statistics.
--   3. The expressions are not parameterized through a JSONB function that
--      GIN can accelerate (we want `->> 'issueId' = X`, not
--      `context @> '{"issueId":"X"}'`), so GIN's container ops don't help.
--
-- We deliberately exclude company_id from the index key. In multi-tenant
-- paperclipai deployments, n_distinct(company_id) collapses toward 1 in any
-- single customer's database, and Postgres's cost model then rates a
-- (company_id, jsonb_path) btree as less selective than a full seq scan
-- because the leading column matches every row. Without company_id the
-- planner picks the index (verified on the OOP-3109 reproducer: 0.024 ms
-- index scan vs 173 ms seq scan; 200 concurrent lookups drop from 2.0 s to
-- 47 ms). Tenant isolation still holds because the existing
-- heartbeat_runs_company_status_process_started_idx remains the access path
-- for queries that don't have a JSONB filter.
--
-- Index sizes observed on the live DB: 216 kB each (~10k rows). They pay for
-- themselves on the first heartbeat tick that hits the planner.
--
-- After this migration applies, EXPLAIN ANALYZE on the heartbeat-tick issue
-- lookup drops from ~173 ms (Seq Scan, 42 284 buffer pages) to ~0.025 ms
-- (Index Scan, 3 buffer pages).
CREATE INDEX IF NOT EXISTS "heartbeat_runs_context_snapshot_issue_idx"
  ON "heartbeat_runs" ((("context_snapshot" ->> 'issueId')));--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "heartbeat_runs_context_snapshot_task_idx"
  ON "heartbeat_runs" ((("context_snapshot" ->> 'taskId')));--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "heartbeat_runs_context_snapshot_comment_idx"
  ON "heartbeat_runs" ((("context_snapshot" ->> 'commentId')));
