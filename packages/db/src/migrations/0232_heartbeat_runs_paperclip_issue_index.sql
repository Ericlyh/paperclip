-- Cover the second branch of the redactForIssue OR predicate.
--
-- server/src/services/run-secret-redaction.ts valuesForIssue() filters
-- heartbeat_runs with
--   (context_snapshot->>'issueId' = $1 OR context_snapshot->'paperclipIssue'->>'id' = $1)
-- The 'issueId' branch is covered by heartbeat_runs_company_ctx_issue_created_idx,
-- but the 'paperclipIssue'->>'id' branch had no index, so the OR could not be
-- served by a BitmapOr and the planner fell back to a full seq scan.
--
-- Measured on the live board before this index: seq scan over 19,093 rows,
-- 99.9 ms, 13,206 buffers (103 MB read) for a single issue lookup. It fires on
-- every comment fetch (server/src/routes/issues.ts getComment, triggered by
-- LiveUpdatesProvider on issue.comment_added) and on every incoming agent
-- comment.
--
-- CONCURRENTLY is unavailable because Drizzle migrations run transactionally
-- (packages/db/src/client.ts applyPendingMigrationsManually wraps each
-- migration in runInTransaction). The live index was therefore created out of
-- band with CREATE INDEX CONCURRENTLY, so no write lock was taken on
-- heartbeat_runs; this statement is IF NOT EXISTS and is a no-op there.

-- paperclip:migration-safety-ignore large-create-index-not-concurrently: Drizzle migrations run transactionally, so CONCURRENTLY is unavailable; the live index was created out of band with CONCURRENTLY and this statement is IF NOT EXISTS.
CREATE INDEX IF NOT EXISTS "heartbeat_runs_company_ctx_paperclip_issue_created_idx"
  ON "heartbeat_runs" USING btree ("company_id", (("context_snapshot" -> 'paperclipIssue') ->> 'id'), "created_at" DESC);
