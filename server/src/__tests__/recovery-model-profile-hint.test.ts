import { describe, expect, it } from "vitest";
import {
  isContextOverflowRunError,
  resolveRecoveryWorkClass,
} from "../services/recovery/model-profile-hint.ts";

const OVERFLOW_ERROR =
  "Internal error: API Error: 400 invalid params, context window exceeds limit (2013)";

describe("isContextOverflowRunError", () => {
  it("recognises the provider's context-window rejection", () => {
    expect(isContextOverflowRunError(OVERFLOW_ERROR)).toBe(true);
    expect(
      isContextOverflowRunError("Internal error: API Error: context_length_exceeded"),
    ).toBe(true);
  });

  it("does not treat transport or quota failures as context overflow", () => {
    expect(isContextOverflowRunError("ACP agent disconnected during request")).toBe(false);
    expect(isContextOverflowRunError("Internal error: 429 rate limit exceeded")).toBe(false);
    expect(isContextOverflowRunError("process_lost")).toBe(false);
    expect(isContextOverflowRunError("")).toBe(false);
    expect(isContextOverflowRunError(undefined)).toBe(false);
  });
});

describe("resolveRecoveryWorkClass", () => {
  it("keeps a cheap original run on the cheap lane when the failure is not an overflow", () => {
    expect(
      resolveRecoveryWorkClass({
        originalModelProfile: "cheap",
        originalRunError: "process_lost",
      }),
    ).toBe("status_only");
  });

  it("escalates a cheap original run that died of a context overflow to the normal model", () => {
    expect(
      resolveRecoveryWorkClass({
        originalModelProfile: "cheap",
        originalRunError: OVERFLOW_ERROR,
      }),
    ).toBe("normal_model");
  });

  it("never downgrades a normal-model original run onto the cheap lane", () => {
    // The regression this guards: the missing-comment retry used to force
    // `cheap` unconditionally, handing an already-accumulated context to a
    // model with a smaller window and reproducing the overflow.
    expect(
      resolveRecoveryWorkClass({
        originalModelProfile: null,
        originalRunError: "ACP agent disconnected during request",
      }),
    ).toBe("normal_model");
    expect(
      resolveRecoveryWorkClass({
        originalModelProfile: undefined,
        originalRunError: OVERFLOW_ERROR,
      }),
    ).toBe("normal_model");
  });
});
