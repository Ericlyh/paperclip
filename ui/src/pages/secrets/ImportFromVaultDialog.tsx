import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  ExternalLink,
  Info,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  X,
  XCircle,
} from "lucide-react";
import type {
  CompanySecret,
  CompanySecretProviderConfig,
  RemoteSecretImportCandidate,
  RemoteSecretImportPreviewResult,
  RemoteSecretImportResult,
  RemoteSecretImportRowResult,
} from "@paperclipai/shared";
import { ApiError } from "../../api/client";
import {
  secretsApi,
  type RemoteImportInput,
  type RemoteImportSelectionInput,
} from "../../api/secrets";
import { useToastActions } from "../../context/ToastContext";
import { queryKeys } from "../../lib/queryKeys";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "../../components/EmptyState";
import { cn } from "../../lib/utils";
import { t as tModule, useTranslation } from "../../i18n";

type Step = "select" | "review" | "result";

interface ImportFromVaultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  providerConfigs: CompanySecretProviderConfig[];
  existingSecrets: CompanySecret[];
  initialProviderConfigId?: string | null;
  onImportComplete?: (result: RemoteSecretImportResult) => void;
  onManageVaults?: () => void;
}

interface DraftSelection {
  candidate: RemoteSecretImportCandidate;
  name: string;
  key: string;
  description: string;
}

const KEY_PATTERN = /^[a-z0-9_.-]+$/;
const PAGE_SIZE = 50;

function isAwsSelectable(config: CompanySecretProviderConfig) {
  if (config.provider !== "aws_secrets_manager") return false;
  return config.status === "ready" || config.status === "warning";
}

function eligibleVaults(configs: CompanySecretProviderConfig[]): CompanySecretProviderConfig[] {
  return configs.filter(isAwsSelectable);
}

function pickDefaultVault(
  configs: CompanySecretProviderConfig[],
  preferredId?: string | null,
): string | null {
  const eligible = eligibleVaults(configs);
  if (eligible.length === 0) return null;
  if (preferredId && eligible.some((vault) => vault.id === preferredId)) {
    return preferredId;
  }
  return (eligible.find((vault) => vault.isDefault) ?? eligible[0]).id;
}

function awsVaultOptions(configs: CompanySecretProviderConfig[]): CompanySecretProviderConfig[] {
  return configs.filter((vault) => vault.provider === "aws_secrets_manager");
}

function statusToneClasses(status: RemoteSecretImportCandidate["status"]) {
  switch (status) {
    case "duplicate":
      return "text-muted-foreground border-border/60";
    case "conflict":
      return "text-amber-600 border-amber-500/40 dark:text-amber-400";
    case "ready":
    default:
      return "text-emerald-600 border-emerald-500/40 dark:text-emerald-400";
  }
}

function statusBadgeLabel(status: RemoteSecretImportCandidate["status"]) {
  switch (status) {
    case "duplicate":
      return tModule("secrets.import.status.imported", { defaultValue: "Imported" });
    case "conflict":
      return tModule("secrets.import.status.conflict", { defaultValue: "Conflict" });
    case "ready":
    default:
      return tModule("secrets.import.status.ready", { defaultValue: "Ready" });
  }
}

function StatusBadge({
  status,
}: {
  status: RemoteSecretImportCandidate["status"];
}) {
  const Icon =
    status === "conflict"
      ? AlertTriangle
      : status === "duplicate"
        ? Link2
        : CheckCircle2;
  return (
    <Badge variant="outline" className={cn("gap-1 px-1.5 py-0 font-normal", statusToneClasses(status))}>
      <Icon className="h-3 w-3" />
      {statusBadgeLabel(status)}
    </Badge>
  );
}

function RowResultBadge({ status }: { status: RemoteSecretImportRowResult["status"] }) {
  const { t } = useTranslation();
  switch (status) {
    case "imported":
      return (
        <Badge
          variant="outline"
          className="gap-1 px-1.5 py-0 font-normal text-emerald-600 border-emerald-500/40 dark:text-emerald-400"
        >
          <CheckCircle2 className="h-3 w-3" /> {t("secrets.import.row.created", { defaultValue: "Created" })}
        </Badge>
      );
    case "skipped":
      return (
        <Badge
          variant="outline"
          className="gap-1 px-1.5 py-0 font-normal text-muted-foreground border-border/60"
        >
          <Link2 className="h-3 w-3" /> {t("secrets.import.row.skipped", { defaultValue: "Skipped" })}
        </Badge>
      );
    case "error":
    default:
      return (
        <Badge
          variant="outline"
          className="gap-1 px-1.5 py-0 font-normal text-destructive border-destructive/40"
        >
          <XCircle className="h-3 w-3" /> {t("secrets.import.row.failed", { defaultValue: "Failed" })}
        </Badge>
      );
  }
}

function middleTruncate(value: string, max = 60) {
  if (value.length <= max) return value;
  const head = Math.floor((max - 1) / 2);
  const tail = max - 1 - head;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

function formatRelativeShort(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  if (diff < 0) return date.toLocaleDateString();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return tModule("time.secondsAgo", { value: seconds, defaultValue: `${seconds}s ago` });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return tModule("time.minutesAgo", { value: minutes, defaultValue: `${minutes}m ago` });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return tModule("time.hoursAgo", { value: hours, defaultValue: `${hours}h ago` });
  const days = Math.floor(hours / 24);
  if (days < 30) return tModule("time.daysAgo", { value: days, defaultValue: `${days}d ago` });
  return date.toLocaleDateString();
}

function readableErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message || `Request failed: ${error.status}`;
  }
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

function apiErrorCode(error: ApiError): string | null {
  const body = error.body;
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.code === "string") return record.code;
  const details = record.details;
  if (details && typeof details === "object") {
    const code = (details as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  return null;
}

function isPermissionError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (apiErrorCode(error) === "access_denied") return true;
  if (error.status === 401 || error.status === 403) return true;
  const message = error.message.toLowerCase();
  return (
    message.includes("accessdenied") ||
    message.includes("access denied") ||
    message.includes("not authorized")
  );
}

function isThrottlingError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (apiErrorCode(error) === "throttled") return true;
  const message = error.message.toLowerCase();
  return message.includes("throttl") || message.includes("toomanyrequests");
}

function buildDraft(candidate: RemoteSecretImportCandidate): DraftSelection {
  return {
    candidate,
    name: candidate.name,
    key: candidate.key,
    description: "",
  };
}

function safeImportProviderMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const safe: Record<string, unknown> = {};
  for (const key of ["createdDate", "lastAccessedDate", "lastChangedDate", "deletedDate"]) {
    const value = metadata[key];
    if (typeof value === "string" || value === null) safe[key] = value;
  }
  for (const key of ["hasDescription", "hasKmsKey", "tagCount"]) {
    const value = metadata[key];
    if (typeof value === "boolean" || typeof value === "number") safe[key] = value;
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function validateDraftRow(
  draft: DraftSelection,
  existing: CompanySecret[],
  otherDrafts: DraftSelection[],
): string | null {
  if (!draft.name.trim()) return tModule("secrets.import.validation.nameRequired", { defaultValue: "Name is required." });
  if (draft.name.length > 160) return tModule("secrets.import.validation.nameTooLong", { max: 160, defaultValue: "Name must be 160 characters or fewer." });
  if (!draft.key.trim()) return tModule("secrets.import.validation.keyRequired", { defaultValue: "Key is required." });
  if (!KEY_PATTERN.test(draft.key)) {
    return tModule("secrets.import.validation.keyPattern", { defaultValue: "Key may only contain lowercase letters, numbers, dot, underscore, or hyphen." });
  }
  if (draft.key.length > 120) return tModule("secrets.import.validation.keyTooLong", { max: 120, defaultValue: "Key must be 120 characters or fewer." });
  if (draft.description.length > 500) return tModule("secrets.import.validation.descriptionTooLong", { max: 500, defaultValue: "Description must be 500 characters or fewer." });

  const lowerName = draft.name.trim().toLowerCase();
  const lowerKey = draft.key.trim().toLowerCase();

  for (const existingSecret of existing) {
    if (existingSecret.name.trim().toLowerCase() === lowerName) {
      return tModule("secrets.import.validation.duplicateNameExisting", { defaultValue: "A Paperclip secret already uses this name." });
    }
    if (existingSecret.key.trim().toLowerCase() === lowerKey) {
      return tModule("secrets.import.validation.duplicateKeyExisting", { defaultValue: "A Paperclip secret already uses this key." });
    }
  }

  for (const other of otherDrafts) {
    if (other === draft) continue;
    if (other.name.trim().toLowerCase() === lowerName) {
      return tModule("secrets.import.validation.duplicateNameBatch", { defaultValue: "Another row in this batch already uses this name." });
    }
    if (other.key.trim().toLowerCase() === lowerKey) {
      return tModule("secrets.import.validation.duplicateKeyBatch", { defaultValue: "Another row in this batch already uses this key." });
    }
  }

  return null;
}

function normalizeDraftKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

interface PreviewState {
  candidates: RemoteSecretImportCandidate[];
  nextToken: string | null;
}

const EMPTY_PREVIEW: PreviewState = { candidates: [], nextToken: null };

export function ImportFromVaultDialog({
  open,
  onOpenChange,
  companyId,
  providerConfigs,
  existingSecrets,
  initialProviderConfigId,
  onImportComplete,
  onManageVaults,
}: ImportFromVaultDialogProps) {
  const queryClient = useQueryClient();
  const toast = useToastActions();
  const { t } = useTranslation();
  const awsVaults = useMemo(() => awsVaultOptions(providerConfigs), [providerConfigs]);
  const eligible = useMemo(() => eligibleVaults(providerConfigs), [providerConfigs]);
  const noEligibleVaults = eligible.length === 0;

  const [step, setStep] = useState<Step>("select");
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const debouncedQuery = useDebounced(searchInput.trim(), 250);

  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [showOnlySelected, setShowOnlySelected] = useState(false);

  const [selection, setSelection] = useState<Map<string, DraftSelection>>(new Map());
  const [importResult, setImportResult] = useState<RemoteSecretImportResult | null>(null);

  // Reset state on open transition.
  useEffect(() => {
    if (!open) return;
    setStep("select");
    setSearchInput("");
    setPreview(EMPTY_PREVIEW);
    setPreviewError(null);
    setSelection(new Map());
    setImportResult(null);
    setShowOnlySelected(false);
    const next = pickDefaultVault(providerConfigs, initialProviderConfigId);
    setVaultId(next);
    // We deliberately depend only on open so that re-opens reset the dialog;
    // providerConfigs changes during a session are handled by next preview fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const requestIdRef = useRef(0);

  // Run preview when vault or query changes (only on step "select").
  useEffect(() => {
    if (!open || step !== "select" || !vaultId) return;
    let cancelled = false;
    const requestId = ++requestIdRef.current;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(EMPTY_PREVIEW);
    secretsApi
      .remoteImportPreview(companyId, {
        providerConfigId: vaultId,
        query: debouncedQuery || null,
        nextToken: null,
        pageSize: PAGE_SIZE,
      })
      .then((result: RemoteSecretImportPreviewResult) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setPreview({
          candidates: result.candidates,
          nextToken: result.nextToken,
        });
      })
      .catch((error) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setPreviewError(error);
      })
      .finally(() => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, step, vaultId, debouncedQuery, companyId]);

  // When the vault changes, drop any selection (they're scoped to a vault).
  useEffect(() => {
    setSelection(new Map());
    setShowOnlySelected(false);
  }, [vaultId]);

  const visibleCandidates = useMemo<RemoteSecretImportCandidate[]>(() => {
    if (!showOnlySelected) return preview.candidates;
    return preview.candidates.filter((candidate) => selection.has(candidate.externalRef));
  }, [preview.candidates, selection, showOnlySelected]);

  const selectableInLoaded = useMemo(
    () => preview.candidates.filter((c) => c.importable),
    [preview.candidates],
  );

  const selectableLoadedCount = selectableInLoaded.length;
  const selectedLoadedCount = selectableInLoaded.filter((c) =>
    selection.has(c.externalRef),
  ).length;

  const headerCheckboxState: boolean | "indeterminate" =
    selectableLoadedCount === 0
      ? false
      : selectedLoadedCount === 0
        ? false
        : selectedLoadedCount === selectableLoadedCount
          ? true
          : "indeterminate";

  const totalSelected = selection.size;
  const selectedNotVisible = useMemo(() => {
    if (!debouncedQuery) return 0;
    let count = 0;
    for (const ref of selection.keys()) {
      if (!preview.candidates.some((c) => c.externalRef === ref)) count += 1;
    }
    return count;
  }, [selection, preview.candidates, debouncedQuery]);

  const draftList = useMemo(() => Array.from(selection.values()), [selection]);

  const reviewErrors = useMemo<Map<string, string>>(() => {
    const errors = new Map<string, string>();
    for (const draft of draftList) {
      const error = validateDraftRow(draft, existingSecrets, draftList);
      if (error) errors.set(draft.candidate.externalRef, error);
    }
    return errors;
  }, [draftList, existingSecrets]);

  const blockedReviewCount = reviewErrors.size;
  const readyReviewCount = draftList.length - blockedReviewCount;

  const importMutation = useMutation({
    mutationFn: (input: RemoteImportInput) => secretsApi.remoteImport(companyId, input),
    onSuccess: (result) => {
      setImportResult(result);
      setStep("result");
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(companyId) });
      onImportComplete?.(result);
      const vaultName =
        awsVaults.find((vault) => vault.id === vaultId)?.displayName ?? "AWS";
      if (result.errorCount === draftList.length && result.errorCount > 0) {
        toast.pushToast({
          title: t("secrets.import.toast.failedTitle", { defaultValue: "Import failed" }),
          body: t("secrets.import.toast.failedBody", { vault: vaultName, defaultValue: `No secrets were imported from ${vaultName}.` }),
          tone: "error",
        });
      } else {
        toast.pushToast({
          title: result.errorCount > 0
            ? t("secrets.import.toast.completedWithErrorsTitle", { defaultValue: "Import completed with errors" })
            : t("secrets.import.toast.completeTitle", { defaultValue: "Import complete" }),
          body: t("secrets.import.toast.counts", {
            imported: result.importedCount,
            skipped: result.skippedCount,
            failed: result.errorCount,
            defaultValue: `${result.importedCount} created · ${result.skippedCount} skipped · ${result.errorCount} failed`,
          }),
          tone: result.errorCount > 0 ? "warn" : "success",
        });
      }
    },
    onError: (error) => {
      toast.pushToast({
        title: t("secrets.import.toast.failedTitle", { defaultValue: "Import failed" }),
        body: readableErrorMessage(error),
        tone: "error",
      });
    },
  });

  function handleVaultChange(nextId: string) {
    setVaultId(nextId);
    setSearchInput("");
  }

  function handleRefresh() {
    if (!vaultId || step !== "select") return;
    let cancelled = false;
    const requestId = ++requestIdRef.current;
    setPreviewLoading(true);
    setPreviewError(null);
    secretsApi
      .remoteImportPreview(companyId, {
        providerConfigId: vaultId,
        query: debouncedQuery || null,
        nextToken: null,
        pageSize: PAGE_SIZE,
      })
      .then((result) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setPreview({ candidates: result.candidates, nextToken: result.nextToken });
      })
      .catch((error) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setPreviewError(error);
      })
      .finally(() => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setPreviewLoading(false);
      });
  }

  function handleLoadMore() {
    if (!vaultId || !preview.nextToken || pageLoading) return;
    setPageLoading(true);
    secretsApi
      .remoteImportPreview(companyId, {
        providerConfigId: vaultId,
        query: debouncedQuery || null,
        nextToken: preview.nextToken,
        pageSize: PAGE_SIZE,
      })
      .then((result) => {
        setPreview((prev) => {
          const seen = new Set(prev.candidates.map((c) => c.externalRef));
          const merged = [...prev.candidates];
          for (const candidate of result.candidates) {
            if (!seen.has(candidate.externalRef)) merged.push(candidate);
          }
          return { candidates: merged, nextToken: result.nextToken };
        });
      })
      .catch((error) => {
        toast.pushToast({
          title: t("secrets.import.toast.loadMoreFailedTitle", { defaultValue: "Could not load more results" }),
          body: readableErrorMessage(error),
          tone: "error",
        });
      })
      .finally(() => setPageLoading(false));
  }

  function toggleRow(candidate: RemoteSecretImportCandidate) {
    if (!candidate.importable) return;
    setSelection((prev) => {
      const next = new Map(prev);
      if (next.has(candidate.externalRef)) {
        next.delete(candidate.externalRef);
      } else {
        next.set(candidate.externalRef, buildDraft(candidate));
      }
      return next;
    });
  }

  function toggleAllLoaded() {
    setSelection((prev) => {
      const next = new Map(prev);
      const allSelected = selectableInLoaded.every((c) => next.has(c.externalRef));
      if (allSelected) {
        for (const candidate of selectableInLoaded) {
          next.delete(candidate.externalRef);
        }
      } else {
        for (const candidate of selectableInLoaded) {
          if (!next.has(candidate.externalRef)) {
            next.set(candidate.externalRef, buildDraft(candidate));
          }
        }
      }
      return next;
    });
  }

  function updateDraft(externalRef: string, patch: Partial<DraftSelection>) {
    setSelection((prev) => {
      const next = new Map(prev);
      const existing = next.get(externalRef);
      if (!existing) return prev;
      next.set(externalRef, { ...existing, ...patch });
      return next;
    });
  }

  function removeDraft(externalRef: string) {
    setSelection((prev) => {
      const next = new Map(prev);
      next.delete(externalRef);
      return next;
    });
  }

  function handleClose(force = false) {
    if (importMutation.isPending) return;
    if (!force && step !== "result" && selection.size > 0 && !importResult) {
      const ok = window.confirm(
        t("secrets.import.confirm.discard", { count: selection.size, defaultValue: `Discard ${selection.size} pending import${selection.size === 1 ? "" : "s"}?` }),
      );
      if (!ok) return;
    }
    onOpenChange(false);
  }

  function handleSubmitImport() {
    if (!vaultId || importMutation.isPending) return;
    if (blockedReviewCount > 0) return;
    if (draftList.length === 0) return;
    const items: RemoteImportSelectionInput[] = draftList.map((draft) => ({
      externalRef: draft.candidate.externalRef,
      name: draft.name.trim(),
      key: draft.key.trim(),
      description: draft.description.trim() || null,
      providerVersionRef: draft.candidate.providerVersionRef,
      providerMetadata: safeImportProviderMetadata(draft.candidate.providerMetadata),
    }));
    importMutation.mutate({ providerConfigId: vaultId, secrets: items });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpenChange(true);
        } else {
          handleClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-(--sz-85vh) flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
        data-testid="import-from-vault-dialog"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-base font-semibold">
              {t("secrets.import.title", { defaultValue: "Import from AWS Secrets Manager" })}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("secrets.import.description", { defaultValue: "Bring AWS-managed secrets into Paperclip as external references." })}
            </DialogDescription>
            <Stepper step={step} />
          </div>
          <button
            type="button"
            className="rounded-sm text-muted-foreground transition-opacity hover:opacity-100 opacity-70"
            onClick={() => handleClose()}
            aria-label={t("secrets.import.aria.closeDialog", { defaultValue: "Close import dialog" })}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          aria-live="polite"
        >
          {step === "select" && (
            <SelectStep
              awsVaults={awsVaults}
              eligible={eligible}
              vaultId={vaultId}
              onVaultChange={handleVaultChange}
              searchInput={searchInput}
              onSearchInput={setSearchInput}
              debouncedQuery={debouncedQuery}
              onRefresh={handleRefresh}
              previewLoading={previewLoading}
              pageLoading={pageLoading}
              previewError={previewError}
              candidates={preview.candidates}
              visibleCandidates={visibleCandidates}
              selectableInLoaded={selectableInLoaded}
              selection={selection}
              toggleRow={toggleRow}
              toggleAllLoaded={toggleAllLoaded}
              headerCheckboxState={headerCheckboxState}
              hasNextPage={Boolean(preview.nextToken)}
              onLoadMore={handleLoadMore}
              showOnlySelected={showOnlySelected}
              onShowOnlySelectedChange={setShowOnlySelected}
              selectedNotVisible={selectedNotVisible}
              noEligibleVaults={noEligibleVaults}
              onManageVaults={onManageVaults}
            />
          )}
          {step === "review" && (
            <ReviewStep
              drafts={draftList}
              reviewErrors={reviewErrors}
              updateDraft={updateDraft}
              removeDraft={removeDraft}
              importing={importMutation.isPending}
            />
          )}
          {step === "result" && importResult && (
            <ResultStep result={importResult} draftList={draftList} />
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/20 px-5 py-3">
          <FooterStatus
            step={step}
            totalSelected={totalSelected}
            readyReviewCount={readyReviewCount}
            blockedReviewCount={blockedReviewCount}
            result={importResult}
          />
          <div className="flex items-center gap-2">
            {step !== "result" && (
              <Button variant="ghost" size="sm" onClick={() => handleClose()}>
                {t("common.cancel", { defaultValue: "Cancel" })}
              </Button>
            )}
            {step === "review" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep("select")}
                disabled={importMutation.isPending}
              >
                {t("common.back", { defaultValue: "Back" })}
              </Button>
            )}
            {step === "select" && (
              <Button
                size="sm"
                onClick={() => setStep("review")}
                disabled={totalSelected === 0}
              >
                {t("secrets.import.action.continueToReview", { defaultValue: "Continue → Review" })}
              </Button>
            )}
            {step === "review" && (
              <Button
                size="sm"
                onClick={handleSubmitImport}
                disabled={
                  draftList.length === 0 ||
                  blockedReviewCount > 0 ||
                  importMutation.isPending
                }
              >
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {t("secrets.import.action.importing", { defaultValue: "Importing…" })}
                  </>
                ) : (
                  t("secrets.import.action.importCount", { count: draftList.length, defaultValue: `Import ${draftList.length}` })
                )}
              </Button>
            )}
            {step === "result" && (
              <Button size="sm" onClick={() => handleClose(true)}>
                {t("common.done", { defaultValue: "Done" })}
              </Button>
            )}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ step }: { step: Step }) {
  const { t } = useTranslation();
  const steps: { id: Step; label: string }[] = [
    { id: "select", label: t("secrets.import.step.select", { defaultValue: "Select" }) },
    { id: "review", label: t("secrets.import.step.review", { defaultValue: "Review" }) },
    { id: "result", label: t("secrets.import.step.result", { defaultValue: "Result" }) },
  ];
  const activeIndex = steps.findIndex((s) => s.id === step);
  return (
    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
      {steps.map((s, index) => (
        <span key={s.id} className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-4 w-4 items-center justify-center rounded-full border text-(length:--text-nano)",
              index === activeIndex
                ? "border-primary bg-primary text-primary-foreground"
                : index < activeIndex
                  ? "border-primary text-primary"
                  : "border-border/60",
            )}
          >
            {index + 1}
          </span>
          <span
            className={cn(
              index === activeIndex ? "text-foreground font-medium" : undefined,
            )}
          >
            {s.label}
          </span>
          {index < steps.length - 1 && (
            <span className="text-muted-foreground/60">›</span>
          )}
        </span>
      ))}
    </div>
  );
}

interface SelectStepProps {
  awsVaults: CompanySecretProviderConfig[];
  eligible: CompanySecretProviderConfig[];
  vaultId: string | null;
  onVaultChange: (id: string) => void;
  searchInput: string;
  onSearchInput: (value: string) => void;
  debouncedQuery: string;
  onRefresh: () => void;
  previewLoading: boolean;
  pageLoading: boolean;
  previewError: unknown;
  candidates: RemoteSecretImportCandidate[];
  visibleCandidates: RemoteSecretImportCandidate[];
  selectableInLoaded: RemoteSecretImportCandidate[];
  selection: Map<string, DraftSelection>;
  toggleRow: (candidate: RemoteSecretImportCandidate) => void;
  toggleAllLoaded: () => void;
  headerCheckboxState: boolean | "indeterminate";
  hasNextPage: boolean;
  onLoadMore: () => void;
  showOnlySelected: boolean;
  onShowOnlySelectedChange: (value: boolean) => void;
  selectedNotVisible: number;
  noEligibleVaults: boolean;
  onManageVaults?: () => void;
}

function SelectStep(props: SelectStepProps) {
  const {
    awsVaults,
    eligible,
    vaultId,
    onVaultChange,
    searchInput,
    onSearchInput,
    debouncedQuery,
    onRefresh,
    previewLoading,
    pageLoading,
    previewError,
    candidates,
    visibleCandidates,
    selectableInLoaded,
    selection,
    toggleRow,
    toggleAllLoaded,
    headerCheckboxState,
    hasNextPage,
    onLoadMore,
    showOnlySelected,
    onShowOnlySelectedChange,
    selectedNotVisible,
    noEligibleVaults,
    onManageVaults,
  } = props;
  const { t } = useTranslation();

  if (noEligibleVaults) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6" data-testid="select-empty-vaults">
        <EmptyState
          icon={Cloud}
          message={t("secrets.import.empty.noVault", { defaultValue: "No AWS provider vault configured. Add one to import secrets." })}
          action={onManageVaults ? t("secrets.import.action.manageVaults", { defaultValue: "Manage vaults" }) : undefined}
          onAction={onManageVaults}
        />
      </div>
    );
  }

  const showSearchSpinner = previewLoading && Boolean(debouncedQuery);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-5 py-3">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">{t("secrets.import.column.vault", { defaultValue: "Vault" })}</label>
        {awsVaults.length === 1 && eligible.length === 1 ? (
          <span className="text-xs font-medium" data-testid="vault-static-label">
            {eligible[0].displayName}
          </span>
        ) : (
          <Select
            value={vaultId ?? undefined}
            onValueChange={onVaultChange}
          >
            <SelectTrigger size="sm" className="text-xs" aria-label={t("secrets.import.aria.selectVault", { defaultValue: "Select AWS vault" })}>
              <SelectValue placeholder={t("secrets.import.placeholder.selectVault", { defaultValue: "Select an AWS vault" })} />
            </SelectTrigger>
            <SelectContent>
              {awsVaults.map((vault) => {
                const blocked = !isAwsSelectable(vault);
                const blockedBadgeLabel =
                  vault.status === "coming_soon"
                    ? t("secrets.import.vault.comingSoon", { defaultValue: "coming soon" })
                    : vault.status;
                return (
                  <SelectItem
                    key={vault.id}
                    value={vault.id}
                    disabled={blocked}
                    aria-disabled={blocked}
                  >
                    <span className="flex items-center gap-2">
                      <span>{vault.displayName}</span>
                      {vault.isDefault && (
                        <Badge variant="outline" className="px-1 py-0 text-(length:--text-nano)">{t("secrets.import.vault.default", { defaultValue: "default" })}</Badge>
                      )}
                      {vault.status === "warning" && (
                        <Badge variant="outline" className="px-1 py-0 text-(length:--text-nano) text-amber-500 border-amber-500/40">{t("secrets.import.vault.warning", { defaultValue: "warning" })}</Badge>
                      )}
                      {blocked && (
                        <Badge variant="outline" className="px-1 py-0 text-(length:--text-nano) text-muted-foreground">
                          {blockedBadgeLabel}
                        </Badge>
                      )}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}

        <div className="relative ml-auto w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => onSearchInput(event.target.value)}
            placeholder={t("secrets.import.placeholder.search", { defaultValue: "Search by name, ARN, tag" })}
            className="pl-7 pr-7 text-xs"
            aria-label={t("secrets.import.aria.search", { defaultValue: "Search remote secrets" })}
            data-testid="vault-search"
          />
          {showSearchSpinner && (
            <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={previewLoading || !vaultId}
          aria-label={t("secrets.import.aria.refresh", { defaultValue: "Refresh remote secrets" })}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", previewLoading && "animate-spin")} />
        </Button>
      </div>

      {selectedNotVisible > 0 && (
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-5 py-1.5 text-xs text-muted-foreground">
          <span>
            {t("secrets.import.selection.summary", { selected: selection.size, notVisible: selectedNotVisible, defaultValue: `${selection.size} selected · ${selectedNotVisible} not visible with current search` })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onShowOnlySelectedChange(!showOnlySelected)}
          >
            {showOnlySelected ? t("secrets.import.action.showAll", { defaultValue: "Show all" }) : t("secrets.import.action.showSelected", { defaultValue: "Show selected" })}
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="vault-table-scroll">
        {previewError ? (
          <PreviewErrorBanner error={previewError} onRetry={onRefresh} />
        ) : previewLoading && candidates.length === 0 ? (
          <SkeletonRows rows={8} />
        ) : candidates.length === 0 ? (
          <EmptyCandidates query={debouncedQuery} />
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">
                  <Checkbox
                    checked={headerCheckboxState}
                    onCheckedChange={() => toggleAllLoaded()}
                    aria-label={t("secrets.import.aria.selectAllLoaded", { count: selectableInLoaded.length, defaultValue: `Select all loaded (${selectableInLoaded.length})` })}
                    disabled={selectableInLoaded.length === 0}
                  />
                </th>
                <th className="px-2 py-2 text-left font-medium">{t("secrets.import.column.remoteName", { defaultValue: "Remote name" })}</th>
                <th className="px-2 py-2 text-left font-medium">{t("secrets.import.column.reference", { defaultValue: "Reference" })}</th>
                <th className="px-2 py-2 text-left font-medium">{t("secrets.import.column.lastChanged", { defaultValue: "Last changed" })}</th>
                <th className="px-2 py-2 text-left font-medium">{t("secrets.import.column.suggestedName", { defaultValue: "Suggested name" })}</th>
                <th className="px-2 py-2 text-left font-medium">{t("secrets.import.column.state", { defaultValue: "State" })}</th>
              </tr>
            </thead>
            <tbody data-testid="vault-table-body">
              {visibleCandidates.map((candidate) => {
                const isSelected = selection.has(candidate.externalRef);
                const meta = (candidate.providerMetadata ?? {}) as Record<string, unknown>;
                const lastChanged =
                  typeof meta.lastChangedAt === "string"
                    ? meta.lastChangedAt
                    : typeof meta.lastChangedDate === "string"
                      ? meta.lastChangedDate
                      : null;
                return (
                  <tr
                    key={candidate.externalRef}
                    className={cn(
                      "border-b border-border/60 transition-colors",
                      candidate.importable
                        ? "cursor-pointer hover:bg-accent/40"
                        : "cursor-not-allowed text-muted-foreground",
                      isSelected && "bg-accent/60",
                    )}
                    onClick={() => toggleRow(candidate)}
                    data-testid={`vault-row-${candidate.externalRef}`}
                    data-row-state={candidate.status}
                  >
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleRow(candidate)}
                        disabled={!candidate.importable}
                        aria-label={t("secrets.import.aria.selectRow", { name: candidate.remoteName, defaultValue: `Select ${candidate.remoteName}` })}
                      />
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="text-sm font-medium leading-tight">{candidate.remoteName}</div>
                    </td>
                    <td className="px-2 py-2.5 text-xs">
                      <span
                        className="font-mono text-muted-foreground"
                        title={candidate.externalRef}
                      >
                        {middleTruncate(candidate.externalRef, 50)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground">
                      {formatRelativeShort(lastChanged)}
                    </td>
                    <td className="px-2 py-2.5 text-xs font-mono">{candidate.key}</td>
                    <td className="px-2 py-2.5 text-xs">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={candidate.status} />
                        {candidate.status === "duplicate" &&
                          candidate.conflicts.find((c) => c.type === "exact_reference")?.existingSecretId && (
                            <span className="text-(length:--text-micro) text-muted-foreground">
                              {t("secrets.import.status.alreadyImported", { defaultValue: "Already imported" })}
                            </span>
                          )}
                      </div>
                      {candidate.status === "conflict" && candidate.conflicts.length > 0 && (
                        <div className="mt-0.5 text-(length:--text-micro) text-amber-600 dark:text-amber-400">
                          {candidate.conflicts[0].message}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {pageLoading && (
                <tr>
                  <td colSpan={6} className="p-0">
                    <SkeletonRows rows={4} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {hasNextPage && !previewError && (
          <div className="flex items-center justify-between border-t border-border/60 px-5 py-2 text-xs text-muted-foreground">
            <span>
              {t("secrets.import.pagination.loaded", { count: candidates.length, defaultValue: `${candidates.length} loaded` })}
              {selectableInLoaded.length > 0 && (
                <span> · {t("secrets.import.pagination.selectable", { count: selectableInLoaded.length, defaultValue: `${selectableInLoaded.length} selectable` })}</span>
              )}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={onLoadMore}
              disabled={pageLoading}
              data-testid="vault-load-more"
            >
              {pageLoading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {t("secrets.import.action.loading", { defaultValue: "Loading…" })}
                </>
              ) : (
                t("secrets.import.action.loadMore", { count: PAGE_SIZE, defaultValue: `Load ${PAGE_SIZE} more` })
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewErrorBanner({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const isPermission = isPermissionError(error);
  const isThrottling = isThrottlingError(error);
  const message = readableErrorMessage(error);
  return (
    <div
      className="m-5 flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      role="alert"
      data-testid="preview-error-banner"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <div className="font-medium">
          {isPermission
            ? t("secrets.import.error.permissionTitle", { defaultValue: "AWS denied list access" })
            : isThrottling
              ? t("secrets.import.error.throttledTitle", { defaultValue: "AWS throttled the listing request" })
              : t("secrets.import.error.genericTitle", { defaultValue: "Could not load remote secrets" })}
        </div>
        <div className="mt-1 text-xs leading-relaxed text-destructive/80">
          {isPermission
            ? t("secrets.import.error.permissionBody", { defaultValue: "The AWS principal behind this vault is missing secretsmanager:ListSecrets. Update IAM and try again." })
            : message}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {t("common.retry", { defaultValue: "Retry" })}
          </Button>
          {isPermission && (
            <a
              href="https://docs.aws.amazon.com/service-authorization/latest/reference/list_awssecretsmanager.html"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium underline"
            >
              {t("secrets.import.error.iamReference", { defaultValue: "IAM reference" })} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-1.5 p-3">
      {Array.from({ length: rows }).map((_, idx) => (
        <Skeleton key={idx} className="h-8 w-full" />
      ))}
    </div>
  );
}

function EmptyCandidates({ query }: { query: string }) {
  const { t } = useTranslation();
  if (query) {
    return (
      <EmptyState
        icon={Search}
        message={t("secrets.import.empty.noMatch", { query, defaultValue: `No remote secrets match "${query}".` })}
      />
    );
  }
  return (
    <EmptyState
      icon={Database}
      message={t("secrets.import.empty.noVisible", { defaultValue: "No secrets visible to this vault." })}
    />
  );
}

interface ReviewStepProps {
  drafts: DraftSelection[];
  reviewErrors: Map<string, string>;
  updateDraft: (externalRef: string, patch: Partial<DraftSelection>) => void;
  removeDraft: (externalRef: string) => void;
  importing: boolean;
}

function ReviewStep({ drafts, reviewErrors, updateDraft, removeDraft, importing }: ReviewStepProps) {
  const { t } = useTranslation();
  if (drafts.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <EmptyState
          icon={Info}
          message={t("secrets.import.review.empty", { defaultValue: "No secrets selected. Go back to pick remote secrets to import." })}
        />
      </div>
    );
  }

  const blocked = reviewErrors.size;
  const ready = drafts.length - blocked;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-muted/20 px-5 py-3 text-xs">
        <span className="font-medium">{t("secrets.import.review.readyCount", { count: ready, defaultValue: `${ready} secrets ready to import` })}</span>
        {blocked > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            {t("secrets.import.review.blockedCount", { count: blocked, defaultValue: `${blocked} need attention before import` })}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="review-list">
        {drafts.map((draft) => {
          const error = reviewErrors.get(draft.candidate.externalRef);
          return (
            <div
              key={draft.candidate.externalRef}
              className={cn(
                "border-b border-border/60 p-4",
                error && "border-l-2 border-l-amber-500/60 bg-amber-500/5",
              )}
              data-testid={`review-row-${draft.candidate.externalRef}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{draft.candidate.remoteName}</span>
                    <span
                      className="font-mono text-xs text-muted-foreground"
                      title={draft.candidate.externalRef}
                    >
                      {middleTruncate(draft.candidate.externalRef, 60)}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-muted-foreground">{t("secrets.import.review.paperclipName", { defaultValue: "Paperclip name" })}</span>
                      <Input
                        value={draft.name}
                        onChange={(e) =>
                          updateDraft(draft.candidate.externalRef, { name: e.target.value })
                        }
                        className="text-xs"
                        aria-invalid={Boolean(error)}
                        disabled={importing}
                        data-testid={`review-name-${draft.candidate.externalRef}`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-muted-foreground">{t("secrets.import.review.key", { defaultValue: "Key" })}</span>
                      <Input
                        value={draft.key}
                        onChange={(e) =>
                          updateDraft(draft.candidate.externalRef, { key: e.target.value })
                        }
                        onBlur={(e) =>
                          updateDraft(draft.candidate.externalRef, {
                            key: normalizeDraftKey(e.target.value),
                          })
                        }
                        className="font-mono text-xs"
                        aria-invalid={Boolean(error)}
                        disabled={importing}
                        data-testid={`review-key-${draft.candidate.externalRef}`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-muted-foreground">{t("secrets.import.review.descriptionOptional", { defaultValue: "Description (optional)" })}</span>
                      <Input
                        value={draft.description}
                        onChange={(e) =>
                          updateDraft(draft.candidate.externalRef, {
                            description: e.target.value,
                          })
                        }
                        className="text-xs"
                        disabled={importing}
                        data-testid={`review-description-${draft.candidate.externalRef}`}
                      />
                    </label>
                  </div>
                  {error && (
                    <div
                      className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"
                      role="alert"
                      data-testid={`review-error-${draft.candidate.externalRef}`}
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {error}
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeDraft(draft.candidate.externalRef)}
                  aria-label={t("secrets.import.aria.removeDraft", { name: draft.candidate.remoteName, defaultValue: `Remove ${draft.candidate.remoteName}` })}
                  className="h-7 w-7"
                  disabled={importing}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ResultStepProps {
  result: RemoteSecretImportResult;
  draftList: DraftSelection[];
}

function ResultStep({ result, draftList }: ResultStepProps) {
  const { t } = useTranslation();
  const grouped = useMemo(() => {
    const created: RemoteSecretImportRowResult[] = [];
    const skipped: RemoteSecretImportRowResult[] = [];
    const failed: RemoteSecretImportRowResult[] = [];
    for (const row of result.results) {
      if (row.status === "imported") created.push(row);
      else if (row.status === "skipped") skipped.push(row);
      else failed.push(row);
    }
    return { created, skipped, failed };
  }, [result]);

  const draftLookup = useMemo(() => {
    const map = new Map<string, DraftSelection>();
    for (const draft of draftList) map.set(draft.candidate.externalRef, draft);
    return map;
  }, [draftList]);

  const heading =
    result.errorCount === result.results.length && result.errorCount > 0
      ? t("secrets.import.toast.failedTitle", { defaultValue: "Import failed" })
      : result.errorCount === 0 && result.skippedCount === 0
        ? t("secrets.import.result.allImported", { count: result.importedCount, defaultValue: `All ${result.importedCount} secrets imported` })
        : t("secrets.import.toast.completeTitle", { defaultValue: "Import complete" });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border/60 px-5 py-3" data-testid="result-summary">
        <h3 className="text-sm font-semibold">{heading}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="text-emerald-600 dark:text-emerald-400">✓ {t("secrets.import.result.createdCount", { count: result.importedCount, defaultValue: `${result.importedCount} created` })}</span>
          <span>⊘ {t("secrets.import.result.skippedCount", { count: result.skippedCount, defaultValue: `${result.skippedCount} skipped` })}</span>
          <span className="text-destructive">⨯ {t("secrets.import.result.failedCount", { count: result.errorCount, defaultValue: `${result.errorCount} failed` })}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {grouped.created.length > 0 && (
          <ResultGroup label={t("secrets.import.group.created", { defaultValue: "Created" })} rows={grouped.created} draftLookup={draftLookup} />
        )}
        {grouped.skipped.length > 0 && (
          <ResultGroup label={t("secrets.import.group.skipped", { defaultValue: "Skipped" })} rows={grouped.skipped} draftLookup={draftLookup} />
        )}
        {grouped.failed.length > 0 && (
          <ResultGroup label={t("secrets.import.group.failed", { defaultValue: "Failed" })} rows={grouped.failed} draftLookup={draftLookup} />
        )}
      </div>
    </div>
  );
}

function ResultGroup({
  label,
  rows,
  draftLookup,
}: {
  label: string;
  rows: RemoteSecretImportRowResult[];
  draftLookup: Map<string, DraftSelection>;
}) {
  return (
    <section>
      <header className="bg-muted/30 px-5 py-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {label} · {rows.length}
      </header>
      <ul className="divide-y divide-border/60">
        {rows.map((row) => {
          const draft = draftLookup.get(row.externalRef);
          const remoteName = draft?.candidate.remoteName ?? row.name;
          return (
            <li
              key={row.externalRef}
              className="flex flex-wrap items-start gap-2 px-5 py-2.5 text-xs"
              data-testid={`result-row-${row.externalRef}`}
              data-row-status={row.status}
            >
              <RowResultBadge status={row.status} />
              <span className="font-medium">{row.name}</span>
              <span className="font-mono text-muted-foreground">{row.key}</span>
              <span
                className="font-mono text-muted-foreground"
                title={row.externalRef}
              >
                {middleTruncate(row.externalRef, 40)}
              </span>
              <span className="ml-auto flex items-center gap-2">
                {row.status === "imported" && row.secretId && (
                  <span className="text-muted-foreground">{remoteName}</span>
                )}
                {row.reason && (
                  <span
                    className={cn(
                      "max-w-(--sz-24rem) truncate",
                      row.status === "error"
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                    title={row.reason}
                  >
                    {row.reason}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface FooterStatusProps {
  step: Step;
  totalSelected: number;
  readyReviewCount: number;
  blockedReviewCount: number;
  result: RemoteSecretImportResult | null;
}

function FooterStatus({
  step,
  totalSelected,
  readyReviewCount,
  blockedReviewCount,
  result,
}: FooterStatusProps) {
  const { t } = useTranslation();
  if (step === "select") {
    return (
      <div className="text-xs text-muted-foreground">
        {totalSelected === 0
          ? t("secrets.import.footer.selectPrompt", { defaultValue: "Select remote secrets to import" })
          : t("secrets.import.footer.selectedCount", { count: totalSelected, defaultValue: `${totalSelected} selected` })}
      </div>
    );
  }
  if (step === "review") {
    return (
      <div className="text-xs text-muted-foreground">
        {t("secrets.import.footer.readyCount", { count: readyReviewCount, defaultValue: `${readyReviewCount} ready` })}
        {blockedReviewCount > 0 && (
          <span className="ml-2 text-amber-600 dark:text-amber-400">
            · {t("secrets.import.footer.blockedCount", { count: blockedReviewCount, defaultValue: `${blockedReviewCount} blocked` })}
          </span>
        )}
      </div>
    );
  }
  if (result) {
    return (
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{t("secrets.import.footer.createdCount", { count: result.importedCount, defaultValue: `${result.importedCount} created` })}</span>
        <span>{t("secrets.import.footer.skippedCount", { count: result.skippedCount, defaultValue: `${result.skippedCount} skipped` })}</span>
        <span>{t("secrets.import.footer.failedCount", { count: result.errorCount, defaultValue: `${result.errorCount} failed` })}</span>
      </div>
    );
  }
  return null;
}
