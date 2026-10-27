import { describe, expect, it } from "vitest";
import { isRoutineExecutionUniqueViolation } from "../services/routine-execution-errors.ts";

/**
 * Minimal stand-ins for the two error shapes the helper must recognize:
 *   - postgres.js (the driver wired in this repo) wraps SQLSTATE 23505 with
 *     `constraint_name` (the wire-protocol field name).
 *   - node-pg (and any other driver following its convention) uses `constraint`.
 * Both end up nested under `DrizzleQueryError.cause` in production because
 * drizzle-orm wraps driver errors before surfacing them. OOP-2711 / OOP-2715
 * shipped because the original guard only matched the top-level node-pg shape.
 */
function drizzleWrapped() {
  return new Error("Failed query: insert into \"issues\" ...") as Error & { cause?: unknown };
}

function attachCause<T extends Error>(err: T, cause: unknown): T {
  (err as Error & { cause?: unknown }).cause = cause;
  return err;
}

describe("isRoutineExecutionUniqueViolation", () => {
  it("matches a postgres.js 23505 wrapped under DrizzleQueryError.cause", () => {
    const driverError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint_name: "issues_open_routine_execution_uq",
    });
    const drizzleError = attachCause(drizzleWrapped(), driverError);

    expect(isRoutineExecutionUniqueViolation(drizzleError)).toBe(true);
  });

  it("matches a node-pg 23505 wrapped under DrizzleQueryError.cause", () => {
    const driverError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "issues_open_routine_execution_uq",
    });
    const drizzleError = attachCause(drizzleWrapped(), driverError);

    expect(isRoutineExecutionUniqueViolation(drizzleError)).toBe(true);
  });

  it("walks deeper cause chains", () => {
    const driverError = Object.assign(new Error("..."), {
      code: "23505",
      constraint_name: "issues_open_routine_execution_uq",
    });
    const middle = { cause: driverError };
    const top = attachCause(drizzleWrapped(), middle);

    expect(isRoutineExecutionUniqueViolation(top)).toBe(true);
  });

  it("returns false when the constraint name does not match", () => {
    const driverError = Object.assign(new Error("..."), {
      code: "23505",
      constraint_name: "some_other_index_uq",
    });
    const drizzleError = attachCause(drizzleWrapped(), driverError);

    expect(isRoutineExecutionUniqueViolation(drizzleError)).toBe(false);
  });

  it("returns false for non-23505 SQLSTATEs even when the constraint matches", () => {
    const driverError = Object.assign(new Error("..."), {
      code: "23503",
      constraint_name: "issues_open_routine_execution_uq",
    });
    const drizzleError = attachCause(drizzleWrapped(), driverError);

    expect(isRoutineExecutionUniqueViolation(drizzleError)).toBe(false);
  });

  it("returns false for unrelated errors", () => {
    expect(isRoutineExecutionUniqueViolation(new Error("boom"))).toBe(false);
    expect(isRoutineExecutionUniqueViolation(null)).toBe(false);
    expect(isRoutineExecutionUniqueViolation(undefined)).toBe(false);
    expect(isRoutineExecutionUniqueViolation("23505")).toBe(false);
  });
});
