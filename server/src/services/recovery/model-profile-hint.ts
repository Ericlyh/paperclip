export const RECOVERY_MODEL_PROFILE_KEY = "cheap" as const;

export type RecoveryModelProfileWorkClass = "status_only" | "normal_model";

export const STATUS_ONLY_RECOVERY_GUARD_CONTEXT = {
  recoveryIntent: "status_only",
  allowDeliverableWork: false,
  allowDocumentUpdates: false,
  resumeRequiresNormalModel: true,
} as const;

const RECOVERY_MODEL_PROFILE_HINT_KEYS = [
  "modelProfile",
  "paperclipModelProfile",
  "recoveryIntent",
  "allowDeliverableWork",
  "allowDocumentUpdates",
  "resumeRequiresNormalModel",
] as const;

type RecoveryModelProfileHintKey = (typeof RECOVERY_MODEL_PROFILE_HINT_KEYS)[number];
type WithoutRecoveryModelProfileHints<T> = Omit<T, RecoveryModelProfileHintKey>;

export function scrubRecoveryModelProfileHints<T extends Record<string, unknown>>(
  input: T,
): WithoutRecoveryModelProfileHints<T> {
  const output: Record<string, unknown> = { ...input };
  for (const key of RECOVERY_MODEL_PROFILE_HINT_KEYS) {
    delete output[key];
  }
  return output as WithoutRecoveryModelProfileHints<T>;
}

export function withRecoveryModelProfileHint<T extends Record<string, unknown>>(
  input: T,
  workClass: "normal_model",
): WithoutRecoveryModelProfileHints<T>;
export function withRecoveryModelProfileHint<T extends Record<string, unknown>>(
  input: T,
  workClass: "status_only",
): WithoutRecoveryModelProfileHints<T> & typeof STATUS_ONLY_RECOVERY_GUARD_CONTEXT & {
  modelProfile: typeof RECOVERY_MODEL_PROFILE_KEY;
};
export function withRecoveryModelProfileHint<T extends Record<string, unknown>>(
  input: T,
  workClass: RecoveryModelProfileWorkClass,
):
  | WithoutRecoveryModelProfileHints<T>
  | (WithoutRecoveryModelProfileHints<T> & typeof STATUS_ONLY_RECOVERY_GUARD_CONTEXT & {
    modelProfile: typeof RECOVERY_MODEL_PROFILE_KEY;
  });
export function withRecoveryModelProfileHint<T extends Record<string, unknown>>(
  input: T,
  workClass: RecoveryModelProfileWorkClass,
):
  | WithoutRecoveryModelProfileHints<T>
  | (WithoutRecoveryModelProfileHints<T> & typeof STATUS_ONLY_RECOVERY_GUARD_CONTEXT & {
    modelProfile: typeof RECOVERY_MODEL_PROFILE_KEY;
  }) {
  if (workClass === "normal_model") {
    return scrubRecoveryModelProfileHints(input);
  }

  return {
    ...scrubRecoveryModelProfileHints(input),
    ...STATUS_ONLY_RECOVERY_GUARD_CONTEXT,
    modelProfile: RECOVERY_MODEL_PROFILE_KEY,
  };
}

export function recoveryAssigneeAdapterOverrides(_workClass: Extract<RecoveryModelProfileWorkClass, "status_only">) {
  return { modelProfile: RECOVERY_MODEL_PROFILE_KEY };
}

const CONTEXT_OVERFLOW_ERROR_PATTERNS = [
  "context window exceeds limit",
  "context_length_exceeded",
  "prompt is too long",
] as const;

/**
 * True when a run died because its own working set exceeded the model's
 * context window (the provider's 400/2013, surfaced verbatim by the acpx
 * engine and by the claude_local adapter's `claude_context_overflow` code).
 *
 * This is not a transport failure and not a quota refusal: nothing was
 * killed and no server restarted, so nothing about the run is recoverable by
 * retrying it as-is.
 */
export function isContextOverflowRunError(error: unknown): boolean {
  const text = typeof error === "string" ? error : "";
  if (!text) return false;
  const haystack = text.toLowerCase();
  return CONTEXT_OVERFLOW_ERROR_PATTERNS.some((pattern) => haystack.includes(pattern));
}

/**
 * Which recovery lane a retry of the original run belongs in.
 *
 * A recovery that continues the original run's work inherits the original
 * run's model. Downgrading a run that is already carrying an accumulated
 * context onto a model with a smaller context window guarantees the retry
 * dies of the same context overflow that produced the recovery, and the retry
 * inherits the overflowed session on top of that.
 *
 * The cheap lane is therefore used only when the original run ran on it AND
 * failed for a reason a cheap retry can plausibly clear. A run that died of a
 * context overflow escalates to the normal model, whose window is larger.
 */
export function resolveRecoveryWorkClass(input: {
  originalModelProfile: string | null | undefined;
  originalRunError: unknown;
}): RecoveryModelProfileWorkClass {
  if (input.originalModelProfile !== RECOVERY_MODEL_PROFILE_KEY) return "normal_model";
  if (isContextOverflowRunError(input.originalRunError)) return "normal_model";
  return "status_only";
}
