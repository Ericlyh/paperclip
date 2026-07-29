/**
 * Detect a Postgres unique-constraint violation (SQLSTATE 23505) raised
 * against the partial index `issues_open_routine_execution_uq` that gates
 * open routine execution issues.
 *
 * Two shape hazards, both hit in production (OOP-2711 / OOP-2715):
 *  1. Drizzle wraps driver errors in `DrizzleQueryError` and hangs the
 *     original error off `.cause`, so the fields are not top-level.
 *  2. postgres.js exposes the constraint as `constraint_name` (the wire
 *     protocol field), while node-pg calls it `constraint`.
 * Walk the cause chain and accept either spelling.
 */
export function isRoutineExecutionUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (typeof current !== "object") break;
    const candidate = current as {
      code?: string;
      constraint?: string;
      constraint_name?: string;
      cause?: unknown;
    };
    const constraint = candidate.constraint ?? candidate.constraint_name;
    if (candidate.code === "23505" && constraint === "issues_open_routine_execution_uq") {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
