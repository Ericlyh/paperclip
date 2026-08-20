import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArchiveRestore,
  Archive,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CornerLeftUp,
  Copy,
  Database,
  Edit3,
  ExternalLink,
  Folder,
  FolderOpen,
  KeyRound,
  Link2,
  Lock,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  X,
  Filter,
  Info,
  Pencil,
  UserRound,
  Users,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  CompanySecret,
  CompanySecretUsageBinding,
  CompanySecretProviderConfig,
  SecretProviderConfigDiscoveryCandidate,
  SecretProviderConfigDiscoveryPreviewResult,
  SecretAccessEvent,
  SecretManagedMode,
  SecretProvider,
  SecretProviderConfigStatus,
  SecretProviderDescriptor,
  SecretStatus,
  UserSecretCoverageSummary,
  UserSecretDefinition,
} from "@paperclipai/shared";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { t as tModule, useTranslation, Trans } from "../i18n";
import { useToastActions } from "../context/ToastContext";
import {
  secretsApi,
  type CreateSecretInput,
  type CreateSecretProviderConfigInput,
  type SecretProviderHealthResponse,
  type UpdateSecretProviderConfigInput,
} from "../api/secrets";
import { ApiError } from "../api/client";
import { accessApi, type CompanyUserDirectoryEntry } from "../api/access";
import { agentsApi } from "../api/agents";
import { envKeyFromSecretName } from "../components/environment-variables-editor/model";
import {
  AGENT_ACCESS_CONFIG_PATH_PREFIX,
  aliasFromConfigPath,
  consumerTypeLabel,
  deliveryModeForConfigPath,
  deliveryModeLabel,
} from "../lib/secret-delivery";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "../lib/utils";
import { copyTextToClipboard } from "../lib/clipboard";
import { PageTabBar } from "../components/PageTabBar";
import { AgentSelect } from "../components/AgentMultiSelect";
import { ImportFromVaultDialog } from "./secrets/ImportFromVaultDialog";
import { MyUserSecretsTab } from "./secrets/MyUserSecretsTab";
import { ProposalsTab } from "./secrets/ProposalsTab";
import { SecretPathName } from "./secrets/SecretPathName";
import {
  buildSecretPathBreadcrumbs,
  buildSecretPathListing,
  getSecretPathRowName,
  normalizeSecretPath,
  validateSecretFolderSegment,
  type SecretPathFolder,
} from "./secrets/secret-path";
import { SetMyUserSecretDialog } from "./secrets/SetMyUserSecretDialog";
import {
  coverageSummaryLabel,
  UserSecretChip,
} from "./secrets/user-secret-presentation";
import type { MyUserSecretEntry } from "../api/secrets";

type CreateMode = "managed" | "external";
// "value" writes a new secret value (for external references: through to the
// provider); "reference" re-points an external reference without writing.
type RotateMode = "value" | "reference";
type SecretValueProvider = "company" | "user";
type ProvidedByFilter = "all" | SecretValueProvider;
type SecretsTab = "secrets" | "my-secrets" | "vaults" | "proposals";
type SecretsViewMode = "folders" | "flat";

const SECRETS_VIEW_MODE_STORAGE_KEY = "paperclip.secrets.viewMode";

function readStoredViewMode(): SecretsViewMode | null {
  try {
    const stored = window.localStorage.getItem(SECRETS_VIEW_MODE_STORAGE_KEY);
    return stored === "folders" || stored === "flat" ? stored : null;
  } catch {
    return null;
  }
}

/** "12 secrets · 3 folders" — folder part omitted when there are no subfolders. */
function formatSecretPathCounts(secretCount: number, folderCount: number): string {
  const parts = [`${secretCount} ${secretCount === 1 ? "secret" : "secrets"}`];
  if (folderCount > 0) {
    parts.push(`${folderCount} ${folderCount === 1 ? "folder" : "folders"}`);
  }
  return parts.join(" · ");
}

type UnifiedSecretRow =
  | { id: string; kind: "company"; secret: CompanySecret }
  | { id: string; kind: "user"; definition: UserSecretDefinition };

type ProviderVaultForm = {
  provider: SecretProvider;
  displayName: string;
  status: SecretProviderConfigStatus;
  isDefault: boolean;
  backupReminderAcknowledged: boolean;
  region: string;
  namespace: string;
  secretNamePrefix: string;
  kmsKeyId: string;
  ownerTag: string;
  environmentTag: string;
  projectId: string;
  location: string;
  address: string;
  mountPath: string;
  secretPathPrefix: string;
};

type SafeProviderErrorDetails = {
  code?: string;
  provider?: string;
  operation?: string;
  providerConfigId?: string;
  providerVaultContext?: string;
  region?: string;
  credentialPath?: string;
  requiredCapability?: string;
  actionableMessage?: string;
  safeAlternative?: string;
};

const EMPTY_SECRETS: CompanySecret[] = [];
const EMPTY_USER_SECRET_DEFINITIONS: UserSecretDefinition[] = [];
const EMPTY_MY_USER_SECRETS: MyUserSecretEntry[] = [];
const EMPTY_SECRET_PROVIDERS: SecretProviderDescriptor[] = [];
const EMPTY_PROVIDER_CONFIGS: CompanySecretProviderConfig[] = [];

const PROVIDER_ORDER: SecretProvider[] = [
  "local_encrypted",
  "aws_secrets_manager",
  "gcp_secret_manager",
  "vault",
];

function defaultProviderVaultStatus(provider: SecretProvider): SecretProviderConfigStatus {
  return provider === "gcp_secret_manager" || provider === "vault" ? "coming_soon" : "ready";
}

function emptyProviderVaultForm(provider: SecretProvider = "local_encrypted"): ProviderVaultForm {
  return {
    provider,
    displayName: "",
    status: defaultProviderVaultStatus(provider),
    isDefault: false,
    backupReminderAcknowledged: false,
    region: "",
    namespace: "",
    secretNamePrefix: "",
    kmsKeyId: "",
    ownerTag: "",
    environmentTag: "",
    projectId: "",
    location: "",
    address: "",
    mountPath: "",
    secretPathPrefix: "",
  };
}

function providerConfigValue(config: CompanySecretProviderConfig["config"], key: string) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return "";
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function apiErrorDetails(error: unknown): SafeProviderErrorDetails | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  if (!body || typeof body !== "object") return null;
  const details = (body as Record<string, unknown>).details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  return details as SafeProviderErrorDetails;
}

function apiErrorCode(error: unknown): string | null {
  return apiErrorDetails(error)?.code ?? null;
}

function isAwsDiscoveryAccessDenied(error: unknown): boolean {
  const details = apiErrorDetails(error);
  if (details?.provider === "aws_secrets_manager" && details.operation === "secret_provider_config.discovery.preview") {
    return details.code === "access_denied";
  }
  if (!(error instanceof ApiError)) return false;
  return apiErrorCode(error) === "access_denied";
}

function readableErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message || `Request failed: ${error.status}`;
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

function providerVaultFormFromConfig(config: CompanySecretProviderConfig): ProviderVaultForm {
  return {
    ...emptyProviderVaultForm(config.provider),
    displayName: config.displayName,
    status: config.status,
    isDefault: config.isDefault,
    backupReminderAcknowledged:
      Boolean((config.config as Record<string, unknown> | undefined)?.backupReminderAcknowledged),
    region: providerConfigValue(config.config, "region"),
    namespace: providerConfigValue(config.config, "namespace"),
    secretNamePrefix: providerConfigValue(config.config, "secretNamePrefix"),
    kmsKeyId: providerConfigValue(config.config, "kmsKeyId"),
    ownerTag: providerConfigValue(config.config, "ownerTag"),
    environmentTag: providerConfigValue(config.config, "environmentTag"),
    projectId: providerConfigValue(config.config, "projectId"),
    location: providerConfigValue(config.config, "location"),
    address: providerConfigValue(config.config, "address"),
    mountPath: providerConfigValue(config.config, "mountPath"),
    secretPathPrefix: providerConfigValue(config.config, "secretPathPrefix"),
  };
}

function formatRelative(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  if (diff < 0) return date.toLocaleString();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return tModule("time.minutesAgo", { value: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return tModule("time.hoursAgo", { value: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return tModule("time.daysAgo", { value: days });
  return date.toLocaleDateString();
}

function statusTextTone(status: SecretStatus) {
  switch (status) {
    case "active":
      return "text-emerald-700 dark:text-emerald-300";
    case "disabled":
      return "text-amber-700 dark:text-amber-300";
    case "archived":
      return "text-muted-foreground";
    case "deleted":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function providerLabel(providers: SecretProviderDescriptor[] | undefined, id: SecretProvider) {
  return providers?.find((p) => p.id === id)?.label ?? id.replaceAll("_", " ");
}

function normalizeSecretKeyForPreview(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function normalizeUserSecretKeyForPreview(input: string) {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}


function modeLabel(managedMode: SecretManagedMode) {
  return managedMode === "paperclip_managed" ? "Paperclip-managed" : "Linked external";
}

function modeDescription(managedMode: SecretManagedMode, canWriteExternalValue = false) {
  if (managedMode === "paperclip_managed") {
    return "Paperclip owns create and rotation writes for this provider secret.";
  }
  return canWriteExternalValue
    ? "Paperclip resolves this provider reference and can write new values to it via Update value."
    : "Paperclip resolves this provider reference but does not rotate the provider value.";
}

function statusLabel(status: SecretStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusDotTone(status: SecretStatus) {
  switch (status) {
    case "active":
      return "bg-emerald-500";
    case "disabled":
      return "bg-amber-500";
    case "archived":
      return "bg-muted-foreground";
    case "deleted":
      return "bg-destructive";
    default:
      return "bg-muted-foreground";
  }
}

function StatusBadge({ status }: { status: SecretStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", statusTextTone(status))}>
      <span className={cn("h-1.5 w-1.5 rounded-full", statusDotTone(status))} aria-hidden="true" />
      {statusLabel(status)}
    </span>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-(length:--text-micro) text-muted-foreground">
      {children}
    </span>
  );
}

function providerIndicatorLabel(
  secret: CompanySecret,
  providers: SecretProviderDescriptor[],
  providerConfigs: CompanySecretProviderConfig[],
) {
  const provider = providerLabel(providers, secret.provider);
  const vault = providerVaultLabel(providerConfigs, secret.providerConfigId);
  const custody = modeLabel(secret.managedMode);
  return [
    `${custody} · ${provider}`,
    vault ? `Vault: ${vault}` : null,
    secret.externalRef ? `Reference: ${secret.externalRef}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function SecretProviderIndicator({
  secret,
  providers,
  providerConfigs,
}: {
  secret: CompanySecret;
  providers: SecretProviderDescriptor[];
  providerConfigs: CompanySecretProviderConfig[];
}) {
  const label = providerIndicatorLabel(secret, providers, providerConfigs);
  const Icon = secret.managedMode === "external_reference" ? ExternalLink : Lock;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={label}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground"
        >
          <Icon className="h-3 w-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-80 whitespace-pre-wrap break-words">{label}</TooltipContent>
    </Tooltip>
  );
}

function UpdatedWithTooltip({
  updatedAt,
  tooltip,
}: {
  updatedAt: Date | string | null | undefined;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={tooltip}
          className="inline-flex cursor-help border-b border-dotted border-muted-foreground/60 text-xs text-muted-foreground"
        >
          {formatRelative(updatedAt)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 whitespace-pre-wrap">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function healthEntryForProvider(
  health: SecretProviderHealthResponse | null,
  providerId: SecretProvider,
) {
  return health?.providers.find((entry) => entry.provider === providerId) ?? null;
}

export function getCreateProviderBlockReason(
  provider: SecretProviderDescriptor | null | undefined,
  mode: CreateMode,
  health: SecretProviderHealthResponse | null,
  providerConfig?: CompanySecretProviderConfig | null,
) {
  if (!provider) return "Select a provider.";
  if (mode === "managed" && provider.supportsManagedValues === false) {
    return `${provider.label} does not support Paperclip-managed secret values.`;
  }
  if (mode === "external" && provider.supportsExternalReferences === false) {
    return `${provider.label} does not support linked external references.`;
  }
  const selectedProviderConfigBlockReason = providerConfig?.provider === provider.id
    ? getProviderConfigBlockReason(providerConfig)
    : null;
  const selectedProviderConfigReady =
    providerConfig?.provider === provider.id && !selectedProviderConfigBlockReason;
  if (provider.configured === false) {
    if (selectedProviderConfigReady) return null;
    if (selectedProviderConfigBlockReason) return selectedProviderConfigBlockReason;
    const healthEntry = healthEntryForProvider(health, provider.id);
    const deploymentMessage = `Deployment default ${provider.label} is not configured.`;
    const nextStep = " Select a ready provider vault or configure the deployment default.";
    return healthEntry?.message
      ? `${deploymentMessage}${nextStep} ${healthEntry.message}`
      : `${deploymentMessage}${nextStep}`;
  }
  const healthEntry = healthEntryForProvider(health, provider.id);
  if (healthEntry?.status === "error") {
    return `${provider.label} health check failed: ${healthEntry.message}`;
  }
  return null;
}

function providerHealthText(
  provider: SecretProviderDescriptor | null | undefined,
  health: SecretProviderHealthResponse | null,
  providerConfig?: CompanySecretProviderConfig | null,
) {
  if (!provider) return null;
  if (
    provider.configured === false &&
    providerConfig?.provider === provider.id &&
    !getProviderConfigBlockReason(providerConfig)
  ) {
    return `Using selected provider vault. Deployment default ${provider.label} is not configured.`;
  }
  const entry = healthEntryForProvider(health, provider.id);
  if (!entry) return null;
  const warnings = entry.warnings?.join(" ");
  return [entry.message, warnings].filter(Boolean).join(" ");
}

function detailString(details: Record<string, unknown> | undefined, key: string) {
  const value = details?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getProviderConfigBlockReason(
  config: CompanySecretProviderConfig | null | undefined,
) {
  if (!config) return null;
  if (config.status === "disabled") return "This provider vault is disabled.";
  if (config.status === "coming_soon") return "This provider vault is saved as draft metadata only.";
  if (config.healthStatus === "error") {
    return config.healthMessage ?? "This provider vault health check failed.";
  }
  return null;
}

export function getSelectableProviderConfig(
  configs: CompanySecretProviderConfig[],
  provider: SecretProvider,
) {
  const providerConfigs = configs.filter((config) => config.provider === provider);
  return (
    providerConfigs.find((config) => config.isDefault && !getProviderConfigBlockReason(config)) ??
    providerConfigs.find((config) => !getProviderConfigBlockReason(config)) ??
    null
  );
}

export function getDefaultProviderConfigId(
  configs: CompanySecretProviderConfig[],
  provider: SecretProvider,
) {
  const selected = getSelectableProviderConfig(configs, provider);
  const providerConfigs = configs.filter((config) => config.provider === provider);
  return (
    selected?.id ??
    providerConfigs.find((config) => config.isDefault)?.id ??
    ""
  );
}

export function findCreateProviderReplacement({
  providers,
  providerConfigs,
  currentProvider,
  mode,
  health,
}: {
  providers: SecretProviderDescriptor[];
  providerConfigs: CompanySecretProviderConfig[];
  currentProvider: SecretProvider;
  mode: CreateMode;
  health: SecretProviderHealthResponse | null;
}) {
  return (
    providers.find((provider) => {
      const selectedConfig =
        provider.id === currentProvider
          ? providerConfigs.find(
              (config) => config.provider === provider.id && !getProviderConfigBlockReason(config),
            ) ?? null
          : getSelectableProviderConfig(providerConfigs, provider.id);
      return !getCreateProviderBlockReason(provider, mode, health, selectedConfig);
    }) ?? null
  );
}

function providerVaultLabel(configs: CompanySecretProviderConfig[], id: string | null | undefined) {
  if (!id) return "Deployment default";
  return configs.find((config) => config.id === id)?.displayName ?? "Unknown vault";
}

function buildProviderVaultConfig(form: ProviderVaultForm): Record<string, unknown> {
  const compact = (value: string) => value.trim() || null;
  switch (form.provider) {
    case "local_encrypted":
      return { backupReminderAcknowledged: form.backupReminderAcknowledged };
    case "aws_secrets_manager":
      return {
        region: form.region.trim(),
        namespace: compact(form.namespace),
        secretNamePrefix: compact(form.secretNamePrefix),
        kmsKeyId: compact(form.kmsKeyId),
        ownerTag: compact(form.ownerTag),
        environmentTag: compact(form.environmentTag),
      };
    case "gcp_secret_manager":
      return {
        projectId: compact(form.projectId),
        location: compact(form.location),
        namespace: compact(form.namespace),
        secretNamePrefix: compact(form.secretNamePrefix),
      };
    case "vault":
      return {
        address: compact(form.address),
        namespace: compact(form.namespace),
        mountPath: compact(form.mountPath),
        secretPathPrefix: compact(form.secretPathPrefix),
      };
    default:
      return {};
  }
}

function getAwsProviderVaultDiscoveryQuery(form: ProviderVaultForm): string | null {
  return (
    form.secretNamePrefix.trim() ||
    form.namespace.trim() ||
    form.environmentTag.trim() ||
    form.ownerTag.trim() ||
    null
  );
}

export function getAwsManagedPathPreview(input: {
  provider: SecretProviderDescriptor | null | undefined;
  health: SecretProviderHealthResponse | null;
  companyId: string;
  secretKeySource: string;
}) {
  if (input.provider?.id !== "aws_secrets_manager") return null;
  const healthEntry = healthEntryForProvider(input.health, "aws_secrets_manager");
  const prefix = detailString(healthEntry?.details, "prefix") ?? "paperclip";
  const deploymentId = detailString(healthEntry?.details, "deploymentId") ?? "{deploymentId}";
  const secretKey = normalizeSecretKeyForPreview(input.secretKeySource) || "{secretKey}";
  return `${prefix}/${deploymentId}/${input.companyId}/${secretKey}`;
}

export function Secrets() {
  const queryClient = useQueryClient();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { t } = useTranslation();
  const { pushToast } = useToastActions();
  const [activeTab, setActiveTab] = useState<SecretsTab>("secrets");
  const [secretDetailTab, setSecretDetailTab] = useState("details");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SecretStatus | "all">("active");
  const [providerFilter, setProviderFilter] = useState<SecretProvider | "all">("all");
  const [providedByFilter, setProvidedByFilter] = useState<ProvidedByFilter>("all");
  const [searchParams, setSearchParams] = useSearchParams();
  // The detail sheet is deep-linkable: `?secret=<id>` /
  // `?definition=<id>` are the source of truth for the current selection, so
  // every open secret has a shareable URL and Back closes the sheet.
  const selectedSecretId = searchParams.get("secret");
  const selectedDefinitionId = searchParams.get("definition");
  const setDetailSelection = useCallback(
    (secretId: string | null, definitionId: string | null = null) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (secretId) next.set("secret", secretId);
        else next.delete("secret");
        if (definitionId) next.set("definition", definitionId);
        else next.delete("definition");
        return next;
      });
    },
    [setSearchParams],
  );
  const [usageDialogSecretId, setUsageDialogSecretId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importInitialVaultId, setImportInitialVaultId] = useState<string | null>(null);
  const [secretValueProvider, setSecretValueProvider] = useState<SecretValueProvider>("company");
  const [createMode, setCreateMode] = useState<CreateMode>("managed");
  const [editingDefinition, setEditingDefinition] = useState<UserSecretDefinition | null>(null);
  const [createNamePrefix, setCreateNamePrefix] = useState<string | null>(null);
  const [createKeyDirty, setCreateKeyDirty] = useState(false);
  const [createKeyEditable, setCreateKeyEditable] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    key: "",
    value: "",
    description: "",
    usageGuidance: "",
    externalRef: "",
    provider: "local_encrypted" as SecretProvider,
    providerConfigId: "",
  });
  const [createError, setCreateError] = useState<unknown>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateMode, setRotateMode] = useState<RotateMode>("value");
  const [rotateValue, setRotateValue] = useState("");
  const [rotateExternalRef, setRotateExternalRef] = useState("");
  const [rotateProviderConfigId, setRotateProviderConfigId] = useState("");
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CompanySecret | null>(null);
  const [definitionDeleteConfirm, setDefinitionDeleteConfirm] = useState<UserSecretDefinition | null>(null);
  const [setMyValueFor, setSetMyValueFor] = useState<MyUserSecretEntry | null>(null);
  const [vaultDialogOpen, setVaultDialogOpen] = useState(false);
  const [editingVault, setEditingVault] = useState<CompanySecretProviderConfig | null>(null);
  const [removeVaultConfirm, setRemoveVaultConfirm] = useState<CompanySecretProviderConfig | null>(null);
  const [vaultForm, setVaultForm] = useState<ProviderVaultForm>(() => emptyProviderVaultForm());
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [vaultDiscovery, setVaultDiscovery] =
    useState<SecretProviderConfigDiscoveryPreviewResult | null>(null);
  const [vaultDiscoveryError, setVaultDiscoveryError] = useState<unknown | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: t("secrets.title") }]);
  }, [setBreadcrumbs, t]);

  const secretsQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.secrets.list(selectedCompanyId)
      : ["secrets", "__disabled__"],
    queryFn: () => secretsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const userDefinitionsQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.secrets.userDefinitions(selectedCompanyId)
      : ["user-secret-definitions", "__disabled__"],
    queryFn: () => secretsApi.listUserSecretDefinitions(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const myUserSecretsQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.secrets.myUserSecrets(selectedCompanyId)
      : ["my-user-secrets", "__disabled__"],
    queryFn: () => secretsApi.listMyUserSecrets(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const providersQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.secrets.providers(selectedCompanyId)
      : ["secret-providers", "__disabled__"],
    queryFn: () => secretsApi.providers(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 5 * 60_000,
  });

  const providerHealthQuery = useQuery({
    queryKey: selectedCompanyId
      ? ["secret-provider-health", selectedCompanyId]
      : ["secret-provider-health", "__disabled__"],
    queryFn: () => secretsApi.providerHealth(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    refetchInterval: 60_000,
    retry: false,
  });

  const providerConfigsQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.secrets.providerConfigs(selectedCompanyId)
      : ["secret-provider-configs", "__disabled__"],
    queryFn: () => secretsApi.providerConfigs(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    retry: false,
  });

  const proposalsQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.secrets.proposals(selectedCompanyId, "pending")
      : ["secret-proposals", "__disabled__"],
    queryFn: () => secretsApi.listProposals(selectedCompanyId!, "pending"),
    enabled: Boolean(selectedCompanyId),
  });

  const secrets = secretsQuery.data ?? EMPTY_SECRETS;
  const userDefinitions = userDefinitionsQuery.data ?? EMPTY_USER_SECRET_DEFINITIONS;
  const pendingProposalCount = proposalsQuery.data?.length ?? 0;
  const myUserSecrets = myUserSecretsQuery.data ?? EMPTY_MY_USER_SECRETS;
  const providers = providersQuery.data ?? EMPTY_SECRET_PROVIDERS;
  const providerConfigs = providerConfigsQuery.data ?? EMPTY_PROVIDER_CONFIGS;
  const selectedSecret = useMemo(
    () => secrets.find((secret) => secret.id === selectedSecretId) ?? null,
    [secrets, selectedSecretId],
  );
  const selectedDefinition = useMemo(
    () => userDefinitions.find((definition) => definition.id === selectedDefinitionId) ?? null,
    [selectedDefinitionId, userDefinitions],
  );
  const selectedSecretAccessReference = useMemo<AgentAccessReference | null>(
    () => selectedSecret ? { kind: "company", secret: selectedSecret } : null,
    [selectedSecret],
  );
  const selectedDefinitionAccessReference = useMemo<AgentAccessReference | null>(
    () => selectedDefinition ? { kind: "user", definition: selectedDefinition } : null,
    [selectedDefinition],
  );
  const selectedDefinitionMyEntry = useMemo(() => {
    if (!selectedDefinition) return null;
    return myUserSecrets.find((entry) => entry.definition.id === selectedDefinition.id) ?? {
      definition: selectedDefinition,
      secret: null,
    };
  }, [myUserSecrets, selectedDefinition]);
  const usageDialogSecret = useMemo(
    () => secrets.find((secret) => secret.id === usageDialogSecretId) ?? null,
    [secrets, usageDialogSecretId],
  );
  const selectedCreateProvider = useMemo(
    () => providers.find((provider) => provider.id === createForm.provider) ?? null,
    [providers, createForm.provider],
  );
  const createProviderConfigs = useMemo(
    () => providerConfigs.filter((config) => config.provider === createForm.provider),
    [createForm.provider, providerConfigs],
  );
  const selectedCreateProviderConfig = useMemo(
    () => providerConfigs.find((config) => config.id === createForm.providerConfigId) ?? null,
    [createForm.providerConfigId, providerConfigs],
  );
  const selectedRotateProviderConfigs = useMemo(
    () => providerConfigs.filter((config) => config.provider === selectedSecret?.provider),
    [providerConfigs, selectedSecret?.provider],
  );
  const selectedRotateProviderConfig = useMemo(
    () => providerConfigs.find((config) => config.id === rotateProviderConfigId) ?? null,
    [providerConfigs, rotateProviderConfigId],
  );
  const createProviderBlockReason = getCreateProviderBlockReason(
    selectedCreateProvider,
    createMode,
    providerHealthQuery.data ?? null,
    selectedCreateProviderConfig,
  ) ?? getProviderConfigBlockReason(selectedCreateProviderConfig);
  const rotateProviderBlockReason = getProviderConfigBlockReason(selectedRotateProviderConfig);
  const createProviderHealthText = providerHealthText(
    selectedCreateProvider,
    providerHealthQuery.data ?? null,
    selectedCreateProviderConfig,
  );
  const awsManagedPathPreview = getAwsManagedPathPreview({
    provider: selectedCreateProvider,
    health: providerHealthQuery.data ?? null,
    companyId: selectedCompanyId ?? "{companyId}",
    secretKeySource: createForm.key.trim() || createForm.name,
  });

  const unifiedRows = useMemo<UnifiedSecretRow[]>(
    () => [
      ...secrets.map((secret) => ({ id: `company:${secret.id}`, kind: "company" as const, secret })),
      ...userDefinitions.map((definition) => ({
        id: `user:${definition.id}`,
        kind: "user" as const,
        definition,
      })),
    ],
    [secrets, userDefinitions],
  );

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return unifiedRows.filter((row) => {
      const providedBy: SecretValueProvider = row.kind === "company" ? "company" : "user";
      const status = row.kind === "company" ? row.secret.status : row.definition.status;
      if (providedByFilter !== "all" && providedBy !== providedByFilter) return false;
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (providerFilter !== "all" && row.kind === "company" && row.secret.provider !== providerFilter) {
        return false;
      }
      if (!needle) return true;
      if (row.kind === "company") {
        return (
          row.secret.name.toLowerCase().includes(needle) ||
          row.secret.key.toLowerCase().includes(needle) ||
          (row.secret.description?.toLowerCase().includes(needle) ?? false) ||
          (row.secret.externalRef?.toLowerCase().includes(needle) ?? false)
        );
      }
      return (
        row.definition.name.toLowerCase().includes(needle) ||
        row.definition.key.toLowerCase().includes(needle) ||
        (row.definition.description?.toLowerCase().includes(needle) ?? false) ||
        (row.definition.usageGuidance?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [providedByFilter, providerFilter, search, statusFilter, unifiedRows]);
  const activeSecretFilterCount =
    (statusFilter === "active" ? 0 : 1) +
    (providerFilter === "all" ? 0 : 1) +
    (providedByFilter === "all" ? 0 : 1);

  // --- Folder view (PAP-14698) --------------------------------------------
  // Folders are derived purely from slash-delimited secret names; there is no
  // server-side folder record. `?path=` holds the normalized current folder
  // and is only meaningful on the main Secrets tab (inert on the others).
  const pathParam = normalizeSecretPath(searchParams.get("path") ?? "");
  const folderPath = activeTab === "secrets" ? pathParam : "";
  const searching = search.trim().length > 0;

  const [storedViewMode, setStoredViewMode] = useState<SecretsViewMode | null>(readStoredViewMode);
  const hasSlashNames = useMemo(
    () => unifiedRows.some((row) => getSecretPathRowName(row).includes("/")),
    [unifiedRows],
  );
  // No explicit preference → default to Folders once any name has a slash.
  const resolvedViewMode: SecretsViewMode = storedViewMode ?? (hasSlashNames ? "folders" : "flat");
  // A `?path=` deep link forces folder view for the visit even if the stored
  // preference is Flat. Search always renders a flat global result set.
  const effectiveViewMode: SecretsViewMode = folderPath ? "folders" : resolvedViewMode;
  const showFolderView = effectiveViewMode === "folders" && !searching;

  const goToFolder = useCallback(
    (path: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const normalized = normalizeSecretPath(path);
          if (normalized) next.set("path", normalized);
          else next.delete("path");
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  function closeNewFolder() {
    setNewFolderOpen(false);
    setNewFolderName("");
    setNewFolderError(null);
  }

  function stageNewFolder() {
    const segment = newFolderName.trim();
    const error = validateSecretFolderSegment(segment);
    if (error) {
      setNewFolderError(error);
      return;
    }
    goToFolder(folderPath ? `${folderPath}/${segment}` : segment);
    closeNewFolder();
  }

  const setViewMode = useCallback(
    (mode: SecretsViewMode) => {
      setStoredViewMode(mode);
      try {
        window.localStorage.setItem(SECRETS_VIEW_MODE_STORAGE_KEY, mode);
      } catch {
        // Ignore storage failures (private mode / disabled); view still works.
      }
      // Flat has no notion of a current folder — leaving it out of the URL.
      if (mode === "flat") goToFolder("");
    },
    [goToFolder],
  );

  const folderListing = useMemo(
    () => buildSecretPathListing(filteredRows, folderPath),
    [filteredRows, folderPath],
  );
  const breadcrumbs = useMemo(() => buildSecretPathBreadcrumbs(folderPath), [folderPath]);
  const parentFolderPath = useMemo(() => {
    const segments = folderPath ? folderPath.split("/") : [];
    return segments.slice(0, -1).join("/");
  }, [folderPath]);
  const currentFolderSecretCount =
    folderListing.secrets.length +
    folderListing.folders.reduce((total, folder) => total + folder.secretCount, 0);
  const folderRows = showFolderView ? folderListing.folders : [];
  const secretRows = showFolderView ? folderListing.secrets : filteredRows;
  const showUpRow = showFolderView && folderPath.length > 0;

  const usageQuery = useQuery({
    queryKey: selectedSecret ? queryKeys.secrets.usage(selectedSecret.id) : ["secrets", "usage", "__disabled__"],
    queryFn: () => secretsApi.usage(selectedSecret!.id),
    enabled: Boolean(selectedSecret),
  });
  const eventsQuery = useQuery({
    queryKey: selectedSecret
      ? queryKeys.secrets.accessEvents(selectedSecret.id)
      : ["secrets", "access-events", "__disabled__"],
    queryFn: () => secretsApi.accessEvents(selectedSecret!.id),
    enabled: Boolean(selectedSecret),
  });

  const usageDialogQuery = useQuery({
    queryKey: usageDialogSecret
      ? queryKeys.secrets.usage(usageDialogSecret.id)
      : ["secrets", "usage-dialog", "__disabled__"],
    queryFn: () => secretsApi.usage(usageDialogSecret!.id),
    enabled: Boolean(usageDialogSecret),
  });

  function invalidateAll(extraIds: string[] = []) {
    if (!selectedCompanyId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.secrets.userDefinitions(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.secrets.myUserSecrets(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.secrets.providerConfigs(selectedCompanyId) });
    for (const id of extraIds) {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.usage(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.accessEvents(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.userDefinitionCoverage(selectedCompanyId, id) });
    }
  }

  function openCreateSecret() {
    const prefix = folderPath ? `${folderPath}/` : null;
    setEditingDefinition(null);
    setCreateNamePrefix(prefix);
    setSecretValueProvider("company");
    setCreateMode("managed");
    setCreateKeyDirty(false);
    setCreateKeyEditable(false);
    setCreateError(null);
    setCreateForm({
      name: prefix ?? "",
      key: "",
      value: "",
      description: "",
      usageGuidance: "",
      externalRef: "",
      provider: "local_encrypted",
      providerConfigId: getDefaultProviderConfigId(providerConfigs, "local_encrypted"),
    });
    setCreateOpen(true);
  }

  function openEditDefinition(definition: UserSecretDefinition) {
    setEditingDefinition(definition);
    setCreateNamePrefix(null);
    setSecretValueProvider("user");
    setCreateMode("managed");
    setCreateKeyDirty(true);
    setCreateKeyEditable(false);
    setCreateError(null);
    setCreateForm({
      name: definition.name,
      key: definition.key,
      value: "",
      description: definition.description ?? "",
      usageGuidance: definition.usageGuidance ?? "",
      externalRef: "",
      provider: "local_encrypted",
      providerConfigId: "",
    });
    setCreateOpen(true);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const sharedDefinitionPayload = {
        name: createForm.name.trim(),
        description: createForm.description.trim() || null,
        usageGuidance: createForm.usageGuidance.trim() || null,
      };
      if (editingDefinition) {
        const definition = await secretsApi.updateUserSecretDefinition(
          selectedCompanyId!,
          editingDefinition.id,
          sharedDefinitionPayload,
        );
        return { kind: "user" as const, item: definition, action: "updated" as const };
      }
      if (secretValueProvider === "user") {
        const definition = await secretsApi.createUserSecretDefinition(selectedCompanyId!, {
          ...sharedDefinitionPayload,
          key: createForm.key.trim(),
          status: "active",
        });
        return { kind: "user" as const, item: definition, action: "created" as const };
      }

      const input: CreateSecretInput = {
        name: createForm.name.trim(),
        provider: createForm.provider,
        providerConfigId: createForm.providerConfigId || null,
        managedMode: createMode === "external" ? "external_reference" : "paperclip_managed",
        description: createForm.description.trim() || null,
      };
      if (createForm.key.trim()) input.key = createForm.key.trim();
      if (createMode === "managed") {
        input.value = createForm.value;
      } else {
        input.externalRef = createForm.externalRef.trim();
      }
      const secret = await secretsApi.create(selectedCompanyId!, input);
      return { kind: "company" as const, item: secret, action: "created" as const };
    },
    onSuccess: (result) => {
      pushToast({
        title:
          result.kind === "company"
            ? "Secret created"
            : result.action === "updated"
              ? "User-provided secret updated"
              : "User-provided secret created",
        body: result.item.name,
        tone: "success",
      });
      setCreateOpen(false);
      setEditingDefinition(null);
      setCreateNamePrefix(null);
      setSecretValueProvider("company");
      setCreateKeyDirty(false);
      setCreateKeyEditable(false);
      setCreateForm({
        name: "",
        key: "",
        value: "",
        description: "",
        usageGuidance: "",
        externalRef: "",
        provider: createForm.provider,
        providerConfigId: getDefaultProviderConfigId(providerConfigs, createForm.provider),
      });
      setCreateError(null);
      if (result.kind === "company") {
        setDetailSelection(result.item.id);
        invalidateAll([result.item.id]);
      } else {
        setDetailSelection(null, result.item.id);
        invalidateAll([result.item.id]);
      }
    },
    onError: (error) => {
      setCreateError(error);
    },
  });

  const rotateMutation = useMutation({
    mutationFn: () => {
      if (!selectedSecret) throw new Error("Select a secret first");
      if (selectedSecret.managedMode === "external_reference" && rotateMode === "reference") {
        return secretsApi.rotate(selectedSecret.id, {
          externalRef: rotateExternalRef.trim() || selectedSecret.externalRef || undefined,
          providerConfigId: rotateProviderConfigId || null,
        });
      }
      return secretsApi.rotate(selectedSecret.id, {
        value: rotateValue,
        providerConfigId: rotateProviderConfigId || null,
      });
    },
    onSuccess: (updated) => {
      pushToast({ title: "Rotated", body: `${updated.name} → v${updated.latestVersion}`, tone: "success" });
      setRotateOpen(false);
      setRotateValue("");
      setRotateExternalRef("");
      setRotateProviderConfigId("");
      setRotateError(null);
      invalidateAll([updated.id]);
    },
    onError: (error) => {
      setRotateError(error instanceof Error ? error.message : "Rotate failed");
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SecretStatus }) => {
      switch (status) {
        case "active":
          return secretsApi.enable(id);
        case "disabled":
          return secretsApi.disable(id);
        case "archived":
          return secretsApi.archive(id);
        default:
          return secretsApi.update(id, { status });
      }
    },
    onSuccess: (updated) => {
      pushToast({ title: `Secret ${updated.status}`, body: updated.name, tone: "info" });
      invalidateAll([updated.id]);
    },
    onError: (error) => {
      pushToast({
        title: "Status update failed",
        body: error instanceof Error ? error.message : "Try again",
        tone: "error",
      });
    },
  });

  const definitionStatusMutation = useMutation({
    mutationFn: ({ definition, status }: { definition: UserSecretDefinition; status: SecretStatus }) =>
      secretsApi.updateUserSecretDefinition(selectedCompanyId!, definition.id, { status }),
    onSuccess: (updated) => {
      pushToast({ title: `User-provided secret ${updated.status}`, body: updated.name, tone: "info" });
      invalidateAll([updated.id]);
    },
    onError: (error) => {
      pushToast({
        title: "Status update failed",
        body: error instanceof Error ? error.message : "Try again",
        tone: "error",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => secretsApi.remove(id),
    onSuccess: (_response, id) => {
      pushToast({ title: "Secret deleted", tone: "info" });
      setDeleteConfirm(null);
      if (selectedSecretId === id) setDetailSelection(null);
      invalidateAll([id]);
    },
    onError: (error) => {
      pushToast({
        title: "Delete failed",
        body: error instanceof Error ? error.message : "Try again",
        tone: "error",
      });
    },
  });

  const deleteDefinitionMutation = useMutation({
    mutationFn: (definition: UserSecretDefinition) =>
      secretsApi.removeUserSecretDefinition(selectedCompanyId!, definition.id),
    onSuccess: (_response, definition) => {
      pushToast({ title: "User-provided secret removed", body: definition.name, tone: "info" });
      setDefinitionDeleteConfirm(null);
      if (selectedDefinitionId === definition.id) setDetailSelection(null);
      invalidateAll([definition.id]);
    },
    onError: (error) => {
      pushToast({
        title: "Delete failed",
        body: error instanceof Error ? error.message : "Try again",
        tone: "error",
      });
    },
  });

  const saveVaultMutation = useMutation({
    mutationFn: () => {
      const data: CreateSecretProviderConfigInput | UpdateSecretProviderConfigInput = {
        displayName: vaultForm.displayName.trim(),
        status: vaultForm.status,
        isDefault: vaultForm.isDefault,
        config: buildProviderVaultConfig(vaultForm),
      };
      if (editingVault) {
        return secretsApi.updateProviderConfig(editingVault.id, data);
      }
      return secretsApi.createProviderConfig(selectedCompanyId!, {
        ...(data as UpdateSecretProviderConfigInput),
        provider: vaultForm.provider,
      } as CreateSecretProviderConfigInput);
    },
    onSuccess: (saved) => {
      pushToast({ title: editingVault ? t("secrets.Provider_vault_updated") : t("secrets.Provider_vault_created"), body: saved.displayName, tone: "success" });
      setVaultDialogOpen(false);
      setEditingVault(null);
      setVaultForm(emptyProviderVaultForm());
      setVaultError(null);
      invalidateAll();
    },
    onError: (error) => {
      setVaultError(error instanceof ApiError ? error.message : (error as Error).message);
    },
  });

  const discoverVaultMutation = useMutation({
    mutationFn: () =>
      secretsApi.providerConfigDiscoveryPreview(selectedCompanyId!, {
        provider: "aws_secrets_manager",
        config: buildProviderVaultConfig(vaultForm),
        query: getAwsProviderVaultDiscoveryQuery(vaultForm),
        pageSize: 25,
      }),
    onSuccess: (preview) => {
      setVaultDiscovery(preview);
      setVaultDiscoveryError(null);
    },
    onError: (error) => {
      setVaultDiscovery(null);
      setVaultDiscoveryError(error);
    },
  });

  const disableVaultMutation = useMutation({
    mutationFn: (id: string) => secretsApi.disableProviderConfig(id),
    onSuccess: (updated) => {
      pushToast({ title: t("secrets.Provider_vault_disabled"), body: updated.displayName, tone: "info" });
      invalidateAll();
    },
    onError: (error) => {
      pushToast({
        title: "Disable failed",
        body: error instanceof Error ? error.message : "Try again",
        tone: "error",
      });
    },
  });

  const removeVaultMutation = useMutation({
    mutationFn: (id: string) => secretsApi.removeProviderConfig(id),
    onSuccess: (removed) => {
      pushToast({
        title: t("secrets.Provider_vault_removed"),
        body: `${removed.displayName} was removed from Paperclip only.`,
        tone: "info",
      });
      setRemoveVaultConfirm(null);
      invalidateAll();
    },
    onError: (error) => {
      pushToast({
        title: "Remove failed",
        body: error instanceof Error ? error.message : "Try again",
        tone: "error",
      });
    },
  });

  const defaultVaultMutation = useMutation({
    mutationFn: (id: string) => secretsApi.setDefaultProviderConfig(id),
    onSuccess: (updated) => {
      pushToast({ title: "Default vault set", body: updated.displayName, tone: "success" });
      invalidateAll();
    },
    onError: (error) => {
      pushToast({
        title: "Default update failed",
        body: error instanceof Error ? error.message : "Try again",
        tone: "error",
      });
    },
  });

  const healthVaultMutation = useMutation({
    mutationFn: (id: string) => secretsApi.checkProviderConfigHealth(id),
    onSuccess: (health) => {
      pushToast({ title: "Health checked", body: health.message, tone: health.status === "error" ? "error" : "info" });
      invalidateAll();
    },
    onError: (error) => {
      pushToast({
        title: "Health check failed",
        body: error instanceof Error ? error.message : "Try again",
        tone: "error",
      });
    },
  });

  useEffect(() => {
    if (!createOpen || providers.length === 0) return;
    const currentBlockReason = getCreateProviderBlockReason(
      providers.find((provider) => provider.id === createForm.provider) ?? null,
      createMode,
      providerHealthQuery.data ?? null,
      providerConfigs.find((config) => config.id === createForm.providerConfigId) ?? null,
    );
    if (!currentBlockReason) return;
    const replacement = findCreateProviderReplacement({
      providers,
      providerConfigs,
      currentProvider: createForm.provider,
      mode: createMode,
      health: providerHealthQuery.data ?? null,
    });
    if (replacement && replacement.id !== createForm.provider) {
      setCreateForm((current) => ({
        ...current,
        provider: replacement.id,
        providerConfigId: getDefaultProviderConfigId(providerConfigs, replacement.id),
      }));
    }
  }, [createForm.provider, createMode, createOpen, providerConfigs, providerHealthQuery.data, providers]);

  useEffect(() => {
    if (!createOpen) return;
    const current = providerConfigs.find((config) => config.id === createForm.providerConfigId);
    if (current?.provider === createForm.provider) return;
    const nextProviderConfigId = getDefaultProviderConfigId(providerConfigs, createForm.provider);
    if (nextProviderConfigId === createForm.providerConfigId) return;
    setCreateForm((form) => ({
      ...form,
      providerConfigId: nextProviderConfigId,
    }));
  }, [createForm.provider, createForm.providerConfigId, createOpen, providerConfigs]);

  useEffect(() => {
    if (!rotateOpen || !selectedSecret) return;
    setRotateProviderConfigId(
      selectedSecret.providerConfigId ?? getDefaultProviderConfigId(providerConfigs, selectedSecret.provider),
    );
  }, [providerConfigs, rotateOpen, selectedSecret]);

  function openCreateVault(provider: SecretProvider = "local_encrypted") {
    setEditingVault(null);
    setVaultForm(emptyProviderVaultForm(provider));
    setVaultError(null);
    setVaultDiscovery(null);
    setVaultDiscoveryError(null);
    setVaultDialogOpen(true);
  }

  function openEditVault(config: CompanySecretProviderConfig) {
    setEditingVault(config);
    setVaultForm(providerVaultFormFromConfig(config));
    setVaultError(null);
    setVaultDiscovery(null);
    setVaultDiscoveryError(null);
    setVaultDialogOpen(true);
  }

  function openImportFromVault(config?: CompanySecretProviderConfig | null) {
    setImportInitialVaultId(config?.id ?? null);
    setImportOpen(true);
  }

  function applyVaultDiscoveryCandidate(candidate: SecretProviderConfigDiscoveryCandidate) {
    if (candidate.provider !== "aws_secrets_manager") return;
    const config = candidate.config as Record<string, unknown>;
    setVaultForm((current) => ({
      ...current,
      displayName: current.displayName.trim() ? current.displayName : candidate.displayName,
      region: providerConfigValue(config, "region"),
      namespace: providerConfigValue(config, "namespace"),
      secretNamePrefix: providerConfigValue(config, "secretNamePrefix"),
      kmsKeyId: providerConfigValue(config, "kmsKeyId"),
      ownerTag: providerConfigValue(config, "ownerTag"),
      environmentTag: providerConfigValue(config, "environmentTag"),
    }));
  }

  function openCompanySecret(secret: CompanySecret) {
    setSecretDetailTab("details");
    setDetailSelection(secret.id);
  }

  function openUserDefinition(definition: UserSecretDefinition) {
    setSecretDetailTab("details");
    setDetailSelection(null, definition.id);
  }

  function secretSupportsExternalValueWrite(secret: CompanySecret) {
    return (
      secret.managedMode === "external_reference" &&
      Boolean(secret.externalRef) &&
      Boolean(providers.find((provider) => provider.id === secret.provider)?.supportsExternalValueWrites)
    );
  }

  function rotateActionLabel(secret: CompanySecret) {
    return secret.managedMode === "external_reference" && !secretSupportsExternalValueWrite(secret)
      ? "Update reference"
      : "Update value";
  }

  function openRotateSecret(secret: CompanySecret) {
    openCompanySecret(secret);
    setRotateOpen(true);
    setRotateMode(
      secret.managedMode === "external_reference" && !secretSupportsExternalValueWrite(secret)
        ? "reference"
        : "value",
    );
    setRotateValue("");
    setRotateExternalRef("");
    setRotateProviderConfigId(
      secret.providerConfigId ?? getDefaultProviderConfigId(providerConfigs, secret.provider),
    );
    setRotateError(null);
  }

  function copyDetailLink() {
    void copyTextToClipboard(window.location.href)
      .then(() => pushToast({ title: "Link copied", body: "Deep link to this secret", tone: "success" }))
      .catch((error) =>
        pushToast({
          title: "Copy failed",
          body: error instanceof Error ? error.message : "Unable to copy link",
          tone: "error",
        }),
      );
  }

  function copySecretKey(key: string) {
    void copyTextToClipboard(key)
      .then(() => pushToast({ title: "Secret key copied", body: key, tone: "success" }))
      .catch((error) =>
        pushToast({
          title: "Copy failed",
          body: error instanceof Error ? error.message : "Unable to copy secret key",
          tone: "error",
        }),
      );
  }

  function renderRowActions(row: UnifiedSecretRow) {
    const name = row.kind === "company" ? row.secret.name : row.definition.name;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("secrets.listbox_label_actions_for", { name })}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onSelect={() => {
              if (row.kind === "company") openCompanySecret(row.secret);
              else openUserDefinition(row.definition);
            }}
          >
            <KeyRound className="h-4 w-4" /> {t("apps.connections.table.viewDetails")}
          </DropdownMenuItem>
          {row.kind === "company" ? (
            <>
              <DropdownMenuItem onSelect={() => setUsageDialogSecretId(row.secret.id)}>
                <Link2 className="h-4 w-4" /> View references ({row.secret.referenceCount ?? 0})
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openRotateSecret(row.secret)}>
                <RefreshCw className="h-4 w-4" />
                {rotateActionLabel(row.secret)}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={statusMutation.isPending}
                onSelect={() =>
                  statusMutation.mutate({
                    id: row.secret.id,
                    status: row.secret.status === "active" ? "disabled" : "active",
                  })
                }
              >
                {row.secret.status === "active" ? <Ban className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                {row.secret.status === "active" ? t("secrets.Disable") : t("secrets.Activate")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={statusMutation.isPending}
                onSelect={() =>
                  statusMutation.mutate({
                    id: row.secret.id,
                    status: row.secret.status === "archived" ? "active" : "archived",
                  })
                }
              >
                {row.secret.status === "archived" ? (
                  <ArchiveRestore className="h-4 w-4" />
                ) : (
                  <Archive className="h-4 w-4" />
                )}
                {row.secret.status === "archived" ? t("issueProperties.unarchiveAction") : t("common.archive")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteConfirm(row.secret)}>
                <Trash2 className="h-4 w-4" /> {t("secrets.Delete_secret")}
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem
                disabled={row.definition.status !== "active"}
                onSelect={() =>
                  setSetMyValueFor(
                    myUserSecrets.find((entry) => entry.definition.id === row.definition.id) ?? {
                      definition: row.definition,
                      secret: null,
                    },
                  )
                }
              >
                <KeyRound className="h-4 w-4" />
                {myUserSecrets.find((entry) => entry.definition.id === row.definition.id)?.secret
                  ? "Update my value"
                  : "Set my value"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openEditDefinition(row.definition)}>
                <Pencil className="h-4 w-4" /> {t("secrets.Edit_definition")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={definitionStatusMutation.isPending}
                onSelect={() =>
                  definitionStatusMutation.mutate({
                    definition: row.definition,
                    status: row.definition.status === "active" ? "disabled" : "active",
                  })
                }
              >
                {row.definition.status === "active" ? (
                  <Ban className="h-4 w-4" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {row.definition.status === "active" ? t("secrets.Disable") : t("secrets.Activate")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={definitionStatusMutation.isPending}
                onSelect={() =>
                  definitionStatusMutation.mutate({
                    definition: row.definition,
                    status: row.definition.status === "archived" ? "active" : "archived",
                  })
                }
              >
                {row.definition.status === "archived" ? (
                  <ArchiveRestore className="h-4 w-4" />
                ) : (
                  <Archive className="h-4 w-4" />
                )}
                {row.definition.status === "archived" ? t("issueProperties.unarchiveAction") : t("common.archive")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDefinitionDeleteConfirm(row.definition)}>
                <Trash2 className="h-4 w-4" /> {t("secrets.Delete_definition")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function folderLinkTo(path: string) {
    const params = new URLSearchParams(searchParams);
    const normalized = normalizeSecretPath(path);
    if (normalized) params.set("path", normalized);
    else params.delete("path");
    const qs = params.toString();
    return { search: qs ? `?${qs}` : "" };
  }

  /** Secret-name treatment: raw in flat view, muted-path/bold-leaf otherwise. */
  function renderSecretName(name: string) {
    if (searching) return <SecretPathName name={name} className="text-sm" />;
    if (showFolderView) return <SecretPathName name={name} basePath={folderPath} className="text-sm" />;
    return <span className="truncate font-medium text-foreground">{name}</span>;
  }

  function renderFolderTableRow(folder: SecretPathFolder) {
    return (
      <Link
        key={`folder:${folder.path}`}
        to={folderLinkTo(folder.path)}
        role="row"
        className="grid grid-cols-(--gtc-54) items-center gap-3 border-b border-border/60 px-3 py-3 hover:bg-accent/40"
      >
        <div role="cell" className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium text-foreground">{folder.name}</span>
          </div>
          <div className="mt-0.5 pl-6 text-xs text-muted-foreground">
            {formatSecretPathCounts(folder.secretCount, folder.folderCount)}
          </div>
        </div>
        <div role="cell" aria-hidden="true" />
        <div role="cell" aria-hidden="true" />
        <div role="cell" aria-hidden="true" />
        <div role="cell" className="flex justify-end">
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </Link>
    );
  }

  function renderFolderCard(folder: SecretPathFolder) {
    return (
      <Link
        key={`folder:${folder.path}`}
        to={folderLinkTo(folder.path)}
        className="flex items-center justify-between gap-2 rounded-md border border-border bg-background p-3 hover:bg-accent/30"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{folder.name}</div>
            <div className="text-xs text-muted-foreground">
              {formatSecretPathCounts(folder.secretCount, folder.folderCount)}
            </div>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
    );
  }

  function renderUpRow(variant: "table" | "card") {
    const parentLabel = parentFolderPath ? parentFolderPath.split("/").pop()! : "All secrets";
    return (
      <Link
        to={folderLinkTo(parentFolderPath)}
        role={variant === "table" ? "row" : undefined}
        className={cn(
          "flex items-center gap-2 text-xs text-muted-foreground hover:bg-accent/40",
          variant === "table"
            ? "border-b border-border/60 px-3 py-2.5"
            : "rounded-md border border-border bg-background px-3 py-2.5",
        )}
      >
        <CornerLeftUp className="h-4 w-4 shrink-0" />
        <span className="truncate">Up to {parentLabel}</span>
      </Link>
    );
  }

  function renderSecretsBreadcrumb() {
    const currentName = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].name : "All secrets";
    const parentLabel = parentFolderPath ? parentFolderPath.split("/").pop()! : "All secrets";
    const fullTrail: { name: string; path: string }[] = [
      { name: "All secrets", path: "" },
      ...breadcrumbs,
    ];
    // Middle-truncate deep paths: root · … · last two.
    const collapsed =
      fullTrail.length > 4
        ? [fullTrail[0], { name: "…", path: "" }, ...fullTrail.slice(-2)]
        : fullTrail;

    return (
      <nav aria-label={t("secrets.Breadcrumb")} className="min-w-0">
        {/* Wide: full trail */}
        <ol className="hidden min-w-0 items-center gap-1 text-sm @min-[40rem]:flex">
          {collapsed.map((crumb, index) => {
            const isLast = index === collapsed.length - 1;
            const isEllipsis = crumb.name === "…" && crumb.path === "" && index > 0 && !isLast;
            return (
              <li key={`${crumb.path}:${index}`} className="flex min-w-0 items-center gap-1">
                {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" /> : null}
                {isEllipsis ? (
                  <span className="px-0.5 text-muted-foreground">…</span>
                ) : isLast ? (
                  <span aria-current="page" className="truncate font-medium text-foreground">
                    {crumb.name}
                  </span>
                ) : (
                  <Link
                    to={folderLinkTo(crumb.path)}
                    className="max-w-40 truncate text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {crumb.name}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
        {/* Narrow: back-chevron + parent/current */}
        <div className="flex min-w-0 items-center gap-1.5 text-sm @min-[40rem]:hidden">
          {folderPath ? (
            <>
              <Link
                to={folderLinkTo(parentFolderPath)}
                aria-label={t("secrets.Up_one_folder")}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
              {parentLabel !== "All secrets" ? (
                <span className="shrink-0 text-muted-foreground">{parentLabel} /</span>
              ) : null}
              <span aria-current="page" className="truncate font-medium text-foreground">
                {currentName}
              </span>
            </>
          ) : (
            <span aria-current="page" className="truncate font-medium text-foreground">
              All secrets
            </span>
          )}
        </div>
      </nav>
    );
  }

  if (!selectedCompanyId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">{t("secrets.Select_a_company_to_manage_secrets")}</div>
    );
  }

  return (
    <TooltipProvider>
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{t("secrets.title")}</h1>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as SecretsTab)}
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        <PageTabBar
          items={[
            { value: "secrets", label: t("secrets.Secrets") },
            { value: "my-secrets", label: t("secrets.My_secrets") },
            { value: "vaults", label: t("secrets.Provider_vaults") },
            {
              value: "proposals",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {t("secrets.Proposals")}
                  {pendingProposalCount > 0 ? (
                    <Badge
                      variant="outline"
                      className="h-4 min-w-4 justify-center rounded-full border-amber-500/40 bg-amber-500/10 px-1 text-(length:--text-nano) font-medium text-amber-700 dark:text-amber-300"
                    >
                      {pendingProposalCount}
                    </Badge>
                  ) : null}
                </span>
              ),
            },
          ]}
          align="start"
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SecretsTab)}
        />

        <TabsContent value="secrets" className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <SecretsHowToUse />
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-48 sm:w-64 md:w-80">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("secrets.Search_by_name_key_ref")}
                className="pl-7 text-xs sm:text-sm"
                aria-label={t("secrets.Search_secrets")}
                data-page-search-target="true"
              />
            </div>
            <SecretsFiltersPopover
              statusFilter={statusFilter}
              providerFilter={providerFilter}
              providedByFilter={providedByFilter}
              providers={providers}
              activeFilterCount={activeSecretFilterCount}
              onStatusChange={setStatusFilter}
              onProviderChange={setProviderFilter}
              onProvidedByChange={setProvidedByFilter}
            />
            <div
              role="group"
              aria-label={t("secrets.View_mode")}
              className={cn(
                "inline-flex items-center rounded-md border border-border p-0.5",
                searching && "opacity-50",
              )}
            >
              {(["folders", "flat"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={effectiveViewMode === mode}
                  disabled={searching}
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    "rounded-sm px-2.5 py-1 text-xs font-medium capitalize transition-colors disabled:cursor-not-allowed",
                    effectiveViewMode === mode
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
            <ImportFromVaultButton
              providerConfigs={providerConfigs}
              onClick={() => openImportFromVault()}
              onManageVaults={() => setActiveTab("vaults")}
              className="ml-auto"
            />
            {showFolderView ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setNewFolderOpen(true);
                  setNewFolderError(null);
                }}
              >
                <Folder className="mr-1 h-3.5 w-3.5" /> {t("secrets.New_folder")}
              </Button>
            ) : null}
            <Button onClick={openCreateSecret} size="sm">
              <Plus className="h-3.5 w-3.5 mr-1" /> {t("secrets.New_secret")}
            </Button>
          </div>
          {newFolderOpen && showFolderView ? (
            <div className="flex flex-wrap items-start gap-2" role="group" aria-label={t("secrets.Create_folder")}>
              <div className="min-w-48 flex-1 sm:max-w-80">
                <Input
                  value={newFolderName}
                  onChange={(event) => {
                    setNewFolderName(event.target.value);
                    if (newFolderError) setNewFolderError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") stageNewFolder();
                    if (event.key === "Escape") closeNewFolder();
                  }}
                  placeholder={t("secrets.Folder_name")}
                  aria-label={t("secrets.Folder_name")}
                  aria-invalid={Boolean(newFolderError)}
                  autoFocus
                />
                {newFolderError ? (
                  <p className="mt-1 text-xs text-destructive" role="alert">
                    {newFolderError}
                  </p>
                ) : null}
              </div>
              <Button type="button" size="sm" onClick={stageNewFolder}>
                {t("secrets.Create_folder")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={closeNewFolder}>
                {t("agentDetail.cancelButton")}
              </Button>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {secretsQuery.isError || userDefinitionsQuery.isError ? (
              <div className="text-sm text-destructive flex items-center gap-2 py-4">
                <AlertCircle className="h-4 w-4" /> {t("secrets.Failed_to_load_secrets", { message: ((secretsQuery.error ?? userDefinitionsQuery.error) as Error).message })}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void secretsQuery.refetch();
                    void userDefinitionsQuery.refetch();
                  }}
                >
                  {t("agentDetail.retry")}
                </Button>
              </div>
            ) : unifiedRows.length === 0 &&
              !secretsQuery.isPending &&
              !userDefinitionsQuery.isPending &&
              !(showFolderView && folderPath) ? (
              <EmptyState
                icon={KeyRound}
                message={t("secrets.No_secrets_yet_Create_a_shared_company_s")}
                action={t("secrets.New_secret")}
                onAction={openCreateSecret}
              />
            ) : (
              <div className="@container min-w-0 overflow-x-hidden text-sm" data-testid="secrets-list-container">
                {showFolderView ? (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    {renderSecretsBreadcrumb()}
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatSecretPathCounts(currentFolderSecretCount, folderListing.folders.length)}
                    </span>
                  </div>
                ) : searching ? (
                  <div className="mb-3">
                    <div className="text-sm font-medium text-foreground">{t("secrets.Search_results")}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("secrets.Match_count", { count: filteredRows.length, plural: filteredRows.length === 1 ? t("secrets.search_match_one") : t("secrets.search_match_other") })}{folderPath ? t("secrets.Searching_everywhere", { path: folderPath }) : ""}
                    </div>
                  </div>
                ) : null}

                {folderRows.length === 0 && secretRows.length === 0 ? (
                  secretsQuery.isPending || userDefinitionsQuery.isPending ? (
                    <div className="space-y-2 py-2" aria-hidden="true" data-testid="secrets-loading-skeleton">
                      {[0, 1, 2, 3].map((index) => (
                        <div key={index} className="h-14 animate-pulse rounded-md bg-muted/40" />
                      ))}
                    </div>
                  ) : showFolderView && folderPath && activeSecretFilterCount === 0 ? (
                    <EmptyState
                      icon={FolderOpen}
                      message={t("secrets.No_secrets_in_this_folder_yet")}
                      action={t("secrets.New_secret_here")}
                      onAction={openCreateSecret}
                    />
                  ) : (
                    <EmptyState
                      icon={Search}
                      message={searching ? "No secrets match your search." : "No secrets match your filters."}
                    />
                  )
                ) : (
                  <>
                <div
                  role="table"
                  aria-label={t("secrets.Secrets")}
                  className="hidden min-w-0 @min-[40rem]:block"
                  data-testid="secrets-table-view"
                >
                  <div
                    role="row"
                    className="grid grid-cols-(--gtc-54) items-center gap-3 bg-muted/40 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    <div role="columnheader" className="font-medium">{t("secrets.secretColumn")}</div>
                    <div role="columnheader" className="font-medium">{t("common.status")}</div>
                    <div role="columnheader" className="font-medium">{t("secrets.Version_coverage")}</div>
                    <div role="columnheader" className="font-medium">{t("secrets.updatedColumn")}</div>
                    <div role="columnheader" className="sr-only">{t("secrets.actions")}</div>
                  </div>
                  <div role="rowgroup">
                    {showUpRow ? renderUpRow("table") : null}
                    {folderRows.map(renderFolderTableRow)}
                    {secretRows.map((row) => {
                      const status = row.kind === "company" ? row.secret.status : row.definition.status;
                      const updatedAt = row.kind === "company" ? row.secret.updatedAt : row.definition.updatedAt;
                      const updatedTooltip =
                        row.kind === "company"
                          ? [
                              `Updated: ${formatRelative(row.secret.updatedAt)}`,
                              `Last rotated: ${formatRelative(row.secret.lastRotatedAt)}`,
                              `Last resolved: ${formatRelative(row.secret.lastResolvedAt)}`,
                            ].join("\n")
                          : `Updated: ${formatRelative(row.definition.updatedAt)}\nLast resolved: user values resolve per member`;
                      return (
                        <div
                          key={row.id}
                          role="row"
                          className={cn(
                            "grid cursor-pointer grid-cols-(--gtc-54) items-center gap-3 border-b border-border/60 px-3 py-3 hover:bg-accent/40",
                            row.kind === "company" && selectedSecretId === row.secret.id && "bg-accent/60",
                            row.kind === "user" && selectedDefinitionId === row.definition.id && "bg-accent/60",
                          )}
                          onClick={() => {
                            if (row.kind === "company") openCompanySecret(row.secret);
                            else openUserDefinition(row.definition);
                          }}
                        >
                          <div role="cell" className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              {renderSecretName(row.kind === "company" ? row.secret.name : row.definition.name)}
                              {row.kind === "company" ? (
                                <SecretProviderIndicator
                                  secret={row.secret}
                                  providers={providers}
                                  providerConfigs={providerConfigs}
                                />
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      aria-label={t("secrets.Each_user_provides_and_owns_their_own_va")}
                                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-200"
                                    >
                                      <UserRound className="h-3 w-3" />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>{t("secrets.Each_user_provides_and_owns_their_own_va")}</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                            <code className="mt-0.5 block truncate text-(length:--text-micro) text-muted-foreground">
                              {row.kind === "company" ? row.secret.key : row.definition.key}
                            </code>
                            <div className="mt-1">
                              {row.kind === "company" ? (
                                <MetaChip>
                                  <ShieldCheck className="h-3 w-3" /> Company
                                </MetaChip>
                              ) : (
                                <UserSecretChip label={t("secrets.Each_user")} />
                              )}
                            </div>
                          </div>
                          <div role="cell">
                            <StatusBadge status={status} />
                          </div>
                          <div role="cell" className="min-w-0 text-xs">
                            {row.kind === "company" ? (
                              <span className="truncate text-muted-foreground">
                                <span className="font-mono text-foreground">v{row.secret.latestVersion}</span>
                                <span> · {row.secret.managedMode === "external_reference" ? "linked" : "managed"}</span>
                              </span>
                            ) : (
                              <CoverageInline companyId={selectedCompanyId} definitionId={row.definition.id} compact />
                            )}
                          </div>
                          <div role="cell">
                            <UpdatedWithTooltip updatedAt={updatedAt} tooltip={updatedTooltip} />
                          </div>
                          <div role="cell" className="text-right" onClick={(event) => event.stopPropagation()}>
                            {renderRowActions(row)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2 @min-[40rem]:hidden" data-testid="secrets-card-view">
                  {showUpRow ? renderUpRow("card") : null}
                  {folderRows.map(renderFolderCard)}
                  {secretRows.map((row) => {
                    const status = row.kind === "company" ? row.secret.status : row.definition.status;
                    return (
                      <div
                        key={row.id}
                        className={cn(
                          "cursor-pointer rounded-md border border-border bg-background p-3 hover:bg-accent/30",
                          row.kind === "company" && selectedSecretId === row.secret.id && "bg-accent/60",
                          row.kind === "user" && selectedDefinitionId === row.definition.id && "bg-accent/60",
                        )}
                        onClick={() => {
                          if (row.kind === "company") openCompanySecret(row.secret);
                          else openUserDefinition(row.definition);
                        }}
                      >
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="min-w-0 truncate">
                              {renderSecretName(row.kind === "company" ? row.secret.name : row.definition.name)}
                            </div>
                            <code className="mt-0.5 block truncate text-(length:--text-micro) text-muted-foreground">
                              {row.kind === "company" ? row.secret.key : row.definition.key}
                            </code>
                          </div>
                          <div onClick={(event) => event.stopPropagation()}>{renderRowActions(row)}</div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {row.kind === "company" ? (
                            <>
                              <MetaChip>
                                <ShieldCheck className="h-3 w-3" /> {t("common.company")}
                              </MetaChip>
                              <SecretProviderIndicator
                                secret={row.secret}
                                providers={providers}
                                providerConfigs={providerConfigs}
                              />
                              <StatusBadge status={status} />
                            </>
                          ) : (
                            <>
                              <UserSecretChip label={t("secrets.Each_user")} />
                              <StatusBadge status={status} />
                              <CoverageInline companyId={selectedCompanyId} definitionId={row.definition.id} compact />
                            </>
                          )}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span className="min-w-0 truncate">
                            {row.kind === "company" ? (
                              <>
                                v{row.secret.latestVersion} ·{" "}
                                {row.secret.managedMode === "external_reference" ? "linked" : "managed"}
                              </>
                            ) : (
                              "Member-owned values"
                            )}
                          </span>
                          <span>Updated {formatRelative(row.kind === "company" ? row.secret.updatedAt : row.definition.updatedAt)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                  </>
                )}
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent
          value="my-secrets"
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
        >
          <MyUserSecretsTab companyId={selectedCompanyId} />
        </TabsContent>
        <TabsContent value="vaults" className="min-h-0 flex-1 overflow-y-auto">
          <ProviderVaultsTab
            providers={providers}
            providerConfigs={providerConfigs}
            loading={providerConfigsQuery.isPending}
            error={providerConfigsQuery.error}
            onRetry={() => providerConfigsQuery.refetch()}
            onCreate={openCreateVault}
            onEdit={openEditVault}
            onDisable={(config) => disableVaultMutation.mutate(config.id)}
            onRemove={(config) => setRemoveVaultConfirm(config)}
            onSetDefault={(config) => defaultVaultMutation.mutate(config.id)}
            onHealthCheck={(config) => healthVaultMutation.mutate(config.id)}
            onImportSecrets={openImportFromVault}
            pendingActionId={
              disableVaultMutation.variables ??
              removeVaultMutation.variables ??
              defaultVaultMutation.variables ??
              healthVaultMutation.variables ??
              null
            }
          />
        </TabsContent>
        <TabsContent value="proposals" className="min-h-0 flex-1 overflow-y-auto">
          {selectedCompanyId ? (
            <ProposalsTab companyId={selectedCompanyId} providerConfigs={providerConfigs} />
          ) : null}
        </TabsContent>
      </Tabs>

      <Sheet
        open={Boolean(selectedSecret || selectedDefinition)}
        onOpenChange={(open) => {
          if (!open && (selectedSecret || selectedDefinition)) setDetailSelection(null);
        }}
      >
        <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0">
          {selectedSecret ? (
            <>
              <SheetHeader className="space-y-3">
                <SheetTitle className="flex min-w-0 items-center gap-2 pr-8 text-base">
                  <KeyRound className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{selectedSecret.name}</span>
                  <span className="shrink-0">
                    <StatusBadge status={selectedSecret.status} />
                  </span>
                </SheetTitle>
                <SheetDescription className="sr-only">
                  {providerLabel(providers, selectedSecret.provider)} secret {selectedSecret.key}
                </SheetDescription>
                <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/20 px-2 py-1.5">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                    {selectedSecret.key}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() => copySecretKey(selectedSecret.key)}
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" /> {t("agentDetail.copy")}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <MetaChip>
                    <ShieldCheck className="h-3 w-3" /> Company
                  </MetaChip>
                  <MetaChip>{modeLabel(selectedSecret.managedMode)}</MetaChip>
                  <MetaChip>{providerLabel(providers, selectedSecret.provider)}</MetaChip>
                  <MetaChip>v{selectedSecret.latestVersion}</MetaChip>
                </div>
              </SheetHeader>
              <div className="flex items-center gap-2 px-4 pb-2">
                <Button
                  size="sm"
                  onClick={() => openRotateSecret(selectedSecret)}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  {rotateActionLabel(selectedSecret)}
                </Button>
                <Button variant="outline" size="sm" onClick={copyDetailLink}>
                  <Link2 className="h-3.5 w-3.5 mr-1" /> {t("companyInvites.invitePerson.latestInvite.copy")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" aria-label={t("secrets.listbox_label_more_actions_for", { name: selectedSecret.name })}>
                      <MoreHorizontal className="mr-1 h-3.5 w-3.5" /> {t("secrets.More")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem
                      disabled={statusMutation.isPending}
                      onSelect={() =>
                        statusMutation.mutate({
                          id: selectedSecret.id,
                          status: selectedSecret.status === "active" ? "disabled" : "active",
                        })
                      }
                    >
                      {selectedSecret.status === "active" ? (
                        <Ban className="h-4 w-4" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      {selectedSecret.status === "active" ? t("secrets.Disable") : t("secrets.Activate")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={statusMutation.isPending}
                      onSelect={() =>
                        statusMutation.mutate({
                          id: selectedSecret.id,
                          status: selectedSecret.status === "archived" ? "active" : "archived",
                        })
                      }
                    >
                      {selectedSecret.status === "archived" ? (
                        <ArchiveRestore className="h-4 w-4" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )}
                      {selectedSecret.status === "archived" ? t("issueProperties.unarchiveAction") : t("common.archive")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleteConfirm(selectedSecret)}>
                      <Trash2 className="h-4 w-4" /> {t("secrets.Delete_secret")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Tabs value={secretDetailTab} onValueChange={setSecretDetailTab} className="flex-1 min-h-0 flex flex-col">
                <div className="border-b border-border px-4">
                  <PageTabBar
                    items={[
                      { value: "details", label: t("common.details") },
                      { value: "usage", label: usageQuery.data ? t("secrets.tab_bindings_count", { count: usageQuery.data.bindings.length }) : t("secrets.Usage") },
                      { value: "events", label: t("secrets.Access_events") },
                    ]}
                    align="start"
                    value={secretDetailTab}
                    onValueChange={setSecretDetailTab}
                  />
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
                  <TabsContent value="details">
                    <div className="space-y-3">
                      <AgentAccessSection
                        companyId={selectedCompanyId}
                        reference={selectedSecretAccessReference!}
                      />
                      <SecretDetailsTab
                        secret={selectedSecret}
                        providers={providers}
                        providerConfigs={providerConfigs}
                        onViewUsage={() => setSecretDetailTab("usage")}
                      />
                    </div>
                  </TabsContent>
                  <TabsContent value="usage">
                    <SecretUsageTab loading={usageQuery.isPending} bindings={usageQuery.data?.bindings ?? []} />
                  </TabsContent>
                  <TabsContent value="events">
                    <SecretEventsTab
                      loading={eventsQuery.isPending}
                      events={eventsQuery.data ?? []}
                      companyId={selectedCompanyId}
                    />
                  </TabsContent>
                </div>
              </Tabs>
            </>
          ) : selectedDefinition ? (
            <>
              <SheetHeader className="space-y-3">
                <SheetTitle className="flex min-w-0 items-center gap-2 pr-8 text-base">
                  <UserRound className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{selectedDefinition.name}</span>
                  <span className="shrink-0">
                    <StatusBadge status={selectedDefinition.status} />
                  </span>
                </SheetTitle>
                <SheetDescription className="sr-only">
                  Each user secret definition {selectedDefinition.key}
                </SheetDescription>
                <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/20 px-2 py-1.5">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                    {selectedDefinition.key}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() => copySecretKey(selectedDefinition.key)}
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" /> Copy
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <UserSecretChip label="Each user" />
                  <MetaChip>
                    <CoverageInline companyId={selectedCompanyId} definitionId={selectedDefinition.id} compact />
                  </MetaChip>
                </div>
              </SheetHeader>
              <div className="flex items-center gap-2 px-4 pb-2">
                <Button
                  size="sm"
                  onClick={() =>
                    setSetMyValueFor(
                      selectedDefinitionMyEntry ?? { definition: selectedDefinition, secret: null },
                    )
                  }
                  disabled={selectedDefinition.status !== "active"}
                >
                  <KeyRound className="h-3.5 w-3.5 mr-1" />
                  {selectedDefinitionMyEntry?.secret ? "Update my value" : "Set my value"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" aria-label={t("secrets.listbox_label_more_actions_for", { name: selectedDefinition.name })}>
                      <MoreHorizontal className="mr-1 h-3.5 w-3.5" /> {t("secrets.More")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onSelect={() => openEditDefinition(selectedDefinition)}>
                      <Pencil className="h-4 w-4" /> {t("secrets.Edit_definition")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={definitionStatusMutation.isPending}
                      onSelect={() =>
                        definitionStatusMutation.mutate({
                          definition: selectedDefinition,
                          status: selectedDefinition.status === "active" ? "disabled" : "active",
                        })
                      }
                    >
                      {selectedDefinition.status === "active" ? (
                        <Ban className="h-4 w-4" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      {selectedDefinition.status === "active" ? t("secrets.Disable") : t("secrets.Activate")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={definitionStatusMutation.isPending}
                      onSelect={() =>
                        definitionStatusMutation.mutate({
                          definition: selectedDefinition,
                          status: selectedDefinition.status === "archived" ? "active" : "archived",
                        })
                      }
                    >
                      {selectedDefinition.status === "archived" ? (
                        <ArchiveRestore className="h-4 w-4" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )}
                      {selectedDefinition.status === "archived" ? t("issueProperties.unarchiveAction") : t("common.archive")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDefinitionDeleteConfirm(selectedDefinition)}>
                      <Trash2 className="h-4 w-4" /> {t("secrets.Delete_definition")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Tabs value={secretDetailTab} onValueChange={setSecretDetailTab} className="flex-1 min-h-0 flex flex-col">
                <div className="border-b border-border px-4">
                  <PageTabBar
                    items={[
                      { value: "details", label: "Details" },
                      { value: "coverage", label: "Coverage" },
                      { value: "usage", label: "Usage" },
                      { value: "events", label: "Access events" },
                    ]}
                    align="start"
                    value={secretDetailTab}
                    onValueChange={setSecretDetailTab}
                  />
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
                  <TabsContent value="details">
                    <div className="space-y-3">
                      <AgentAccessSection
                        companyId={selectedCompanyId}
                        reference={selectedDefinitionAccessReference!}
                      />
                      <UserSecretDetailsTab
                        companyId={selectedCompanyId}
                        definition={selectedDefinition}
                        onViewCoverage={() => setSecretDetailTab("coverage")}
                      />
                    </div>
                  </TabsContent>
                  <TabsContent value="coverage">
                    <UserSecretCoverageTab
                      companyId={selectedCompanyId}
                      definitionId={selectedDefinition.id}
                    />
                  </TabsContent>
                  <TabsContent value="usage">
                    <UserSecretUsageTab definition={selectedDefinition} />
                  </TabsContent>
                  <TabsContent value="events">
                    <UserSecretAccessEventsTab />
                  </TabsContent>
                </div>
              </Tabs>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog
        open={Boolean(usageDialogSecret)}
        onOpenChange={(open) => !open && setUsageDialogSecretId(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("secrets.Secret_references")}</DialogTitle>
            <DialogDescription>
              {usageDialogSecret
                ? `${usageDialogSecret.name} is referenced by ${usageDialogSecret.referenceCount ?? 0} ${
                    (usageDialogSecret.referenceCount ?? 0) === 1 ? "place" : "places"
                  }.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <SecretUsageTab
            loading={usageDialogQuery.isPending}
            bindings={usageDialogQuery.data?.bindings ?? []}
          />
        </DialogContent>
      </Dialog>

      {selectedCompanyId && (
        <ImportFromVaultDialog
          open={importOpen}
          onOpenChange={(open) => {
            setImportOpen(open);
            if (!open) setImportInitialVaultId(null);
          }}
          companyId={selectedCompanyId}
          providerConfigs={providerConfigs}
          existingSecrets={secrets}
          initialProviderConfigId={importInitialVaultId}
          onManageVaults={() => {
            setImportOpen(false);
            setImportInitialVaultId(null);
            setActiveTab("vaults");
          }}
          onImportComplete={() => {
            void secretsQuery.refetch();
          }}
        />
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setCreateNamePrefix(null);
        }}
      >
        <DialogContent className="max-h-(--sz-calc-18) overflow-y-auto p-4 sm:max-w-lg sm:p-6">
          <DialogHeader>
            <DialogTitle>{editingDefinition ? t("secrets.Edit_user_provided_secret") : t("secrets.Create_secret")}</DialogTitle>
            <DialogDescription>
              {t("secrets.Choose_who_provides_value")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!editingDefinition ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-foreground">{t("secrets.Who_provides_the_value")}</p>
                <Tabs
                  value={secretValueProvider}
                  onValueChange={(value) => {
                    const next = value as SecretValueProvider;
                    setSecretValueProvider(next);
                    setCreateKeyEditable(false);
                    setCreateForm((current) => ({
                      ...current,
                      key: createKeyDirty
                        ? current.key
                        : next === "user"
                          ? normalizeUserSecretKeyForPreview(current.name)
                          : normalizeSecretKeyForPreview(current.name),
                    }));
                  }}
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="company">{t("common.company")}</TabsTrigger>
                    <TabsTrigger value="user">{t("secrets.Each_user")}</TabsTrigger>
                  </TabsList>
                </Tabs>
                <p className="text-(length:--text-micro) text-muted-foreground">
                  {t("secrets.Company_stores_one_shared_value")}
                </p>
              </div>
            ) : null}

            {secretValueProvider === "company" && !editingDefinition ? (
              <Tabs value={createMode} onValueChange={(value) => setCreateMode(value as CreateMode)}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="managed">{t("secrets.Managed_value")}</TabsTrigger>
                  <TabsTrigger value="external">{t("secrets.External_reference")}</TabsTrigger>
                </TabsList>
              </Tabs>
            ) : null}

            <div>
              <label className="text-xs font-medium" htmlFor="new-secret-name">{t("secrets.nameLabel")}</label>
              {createNamePrefix && !editingDefinition ? (
                <div className="flex h-9 w-full min-w-0 items-center gap-1.5 rounded-md border border-input bg-transparent px-2 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-3">
                  <span
                    className="inline-flex min-w-0 shrink items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
                    title={createNamePrefix}
                  >
                    <span className="truncate">{createNamePrefix}</span>
                    <button
                      type="button"
                      className="shrink-0 rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t("secrets.Remove_folder_prefix")}
                      onClick={() => setCreateNamePrefix(null)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                  <input
                    id="new-secret-name"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    value={createForm.name.slice(createNamePrefix.length)}
                    onChange={(event) => {
                      const name = createNamePrefix + event.target.value;
                      setCreateForm((current) => ({
                        ...current,
                        name,
                        key: createKeyDirty
                          ? current.key
                          : secretValueProvider === "user"
                            ? normalizeUserSecretKeyForPreview(name)
                            : normalizeSecretKeyForPreview(name),
                      }));
                    }}
                    placeholder="clientsecret"
                    autoFocus
                  />
                </div>
              ) : (
                <Input
                  id="new-secret-name"
                  value={createForm.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    setCreateForm((current) => ({
                      ...current,
                      name,
                      key: createKeyDirty
                        ? current.key
                        : secretValueProvider === "user"
                          ? normalizeUserSecretKeyForPreview(name)
                          : normalizeSecretKeyForPreview(name),
                    }));
                  }}
                  placeholder={secretValueProvider === "user" ? "Personal GitHub token" : "/dev/foo/bar"}
                  autoFocus
                />
              )}
              {createNamePrefix && !editingDefinition ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Creating in {folderPath} — remove the chip to type a different path.
                </p>
              ) : null}
            </div>

            {secretValueProvider === "company" && createMode === "managed" ? (
              <div>
                <label className="text-xs font-medium" htmlFor="new-secret-value">{t("secrets.valueLabel")}</label>
                <Textarea
                  id="new-secret-value"
                  value={createForm.value}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, value: event.target.value }))
                  }
                  rows={3}
                  className="min-w-0 overflow-x-hidden break-all font-mono text-xs"
                  placeholder={t("secrets.Stored_once_never_re_displayed")}
                />
              </div>
            ) : null}
            {secretValueProvider === "company" && createMode === "external" ? (
              <div>
                <label className="text-xs font-medium" htmlFor="new-secret-ref">{t("secrets.External_reference")}</label>
                <Input
                  id="new-secret-ref"
                  value={createForm.externalRef}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, externalRef: event.target.value }))
                  }
                  placeholder="arn:aws:secretsmanager:..."
                  className="font-mono text-xs"
                />
                <p className="text-(length:--text-micro) text-muted-foreground mt-1">
                  {t("secrets.Existing_provider_secrets_resolve_only")}
                </p>
              </div>
            ) : null}
            {secretValueProvider === "user" ? (
              <>
                <div className="rounded-md border border-violet-500/30 bg-violet-500/5 p-2 text-(length:--text-micro) text-violet-800 dark:text-violet-200">
                  {t("secrets.Every_member_supplies_own_value")}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground" htmlFor="new-secret-usage-guidance">
                    {t("secrets.Usage_guidance")} <span className="text-muted-foreground/70">{t("secrets.optional")}</span>
                  </label>
                  <Textarea
                    id="new-secret-usage-guidance"
                    value={createForm.usageGuidance}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, usageGuidance: event.target.value }))
                    }
                    placeholder={t("secrets.Tell_members_how_to_create_their_token_r")}
                    className="min-h-(--sz-70px) text-sm"
                  />
                </div>
              </>
            ) : null}

            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" htmlFor="new-secret-key">{t("secrets.detail_row_key")}</label>
                {!createKeyEditable && !editingDefinition ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-(length:--text-micro) text-muted-foreground"
                    onClick={() => setCreateKeyEditable(true)}
                  >
                    <Pencil className="mr-1 h-3 w-3" /> {t("common.edit")}
                  </Button>
                ) : null}
              </div>
              <Input
                id="new-secret-key"
                value={createForm.key}
                readOnly={!createKeyEditable}
                tabIndex={createKeyEditable && !editingDefinition ? undefined : -1}
                onChange={(event) => {
                  if (!createKeyEditable || editingDefinition) return;
                  setCreateKeyDirty(true);
                  setCreateForm((current) => ({ ...current, key: event.target.value }));
                }}
                placeholder={secretValueProvider === "user" ? t("secrets.placeholder_personal_gh_token") : t("secrets.placeholder_auto_from_name")}
                disabled={Boolean(editingDefinition)}
                className={cn(
                  "font-mono text-sm",
                  !createKeyEditable && !editingDefinition && "border-dashed bg-muted/40 text-muted-foreground",
                )}
              />
              <p className="mt-1 text-(length:--text-micro) text-muted-foreground">
                {editingDefinition
                  ? t("secrets.Stable_env_binding_key_Cannot_be_changed")
                  : !createKeyEditable
                    ? t("secrets.Generated_from_the_name")
                    : secretValueProvider === "user"
                      ? t("secrets.Env_style_key_used_by_user_secret_bindin")
                      : t("secrets.Shared_secret_keys_keep_lowercase_dash_n")}
              </p>
            </div>

            <div>
              <label className="text-xs font-medium" htmlFor="new-secret-description">
                {t("secrets.detail_row_description")} <span className="text-muted-foreground/70">{t("secrets.optional")}</span>
              </label>
              <Input
                id="new-secret-description"
                value={createForm.description}
                onChange={(event) =>
                  setCreateForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder={t("secrets.What_is_this_secret_used_for_no_values")}
              />
            </div>

            {secretValueProvider === "company" ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium" htmlFor="new-secret-provider">{t("secrets.providerLabel")}</label>
                  <select
                    id="new-secret-provider"
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none"
                    value={createForm.provider}
                    onChange={(event) =>
                      setCreateForm((current) => {
                        const provider = event.target.value as SecretProvider;
                        return {
                          ...current,
                          provider,
                          providerConfigId: getDefaultProviderConfigId(providerConfigs, provider),
                        };
                      })
                    }
                  >
                    {providers.map((provider) => (
                      <option
                        key={provider.id}
                        value={provider.id}
                        disabled={Boolean(
                          getCreateProviderBlockReason(
                            provider,
                            createMode,
                            providerHealthQuery.data ?? null,
                            getSelectableProviderConfig(providerConfigs, provider.id),
                          ),
                        )}
                      >
                        {provider.label}
                        {provider.configured === false &&
                        !getSelectableProviderConfig(providerConfigs, provider.id)
                          ? " (deployment default missing)"
                          : provider.requiresExternalRef
                            ? " (external only)"
                            : ""}
                      </option>
                    ))}
                  </select>
                  {createProviderBlockReason ? (
                    <p className="mt-1 flex items-center gap-1 text-(length:--text-micro) text-destructive">
                      <AlertCircle className="h-3 w-3" />
                      {createProviderBlockReason}
                    </p>
                  ) : createProviderHealthText ? (
                    <p className="mt-1 text-(length:--text-micro) text-muted-foreground">{createProviderHealthText}</p>
                  ) : null}
                </div>
                <div>
                  <label className="text-xs font-medium" htmlFor="new-secret-vault">{t("secrets.Provider_vault")}</label>
                  <select
                    id="new-secret-vault"
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none"
                    value={createForm.providerConfigId}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, providerConfigId: event.target.value }))
                    }
                  >
                    <option value="">{t("secrets.Deployment_default")}</option>
                    {createProviderConfigs.map((config) => {
                      const blockReason = getProviderConfigBlockReason(config);
                      return (
                        <option key={config.id} value={config.id} disabled={Boolean(blockReason)}>
                          {config.displayName}
                          {config.isDefault ? " (default)" : ""}
                          {blockReason ? ` (${blockReason})` : ""}
                        </option>
                      );
                    })}
                  </select>
                  {selectedCreateProviderConfig ? (
                    <ProviderVaultInlineWarning config={selectedCreateProviderConfig} />
                  ) : null}
                </div>
                </div>
                {createMode === "managed" ? (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-(length:--text-micro) text-emerald-700 dark:text-emerald-300">
                    Paperclip-managed secrets are created in the selected provider and future rotations
                    write a new provider version through Paperclip.
                    {awsManagedPathPreview ? (
                      <div className="mt-1">
                        AWS managed path:{" "}
                        <code className="break-all rounded bg-background/70 px-1 py-0.5">
                          {awsManagedPathPreview}
                        </code>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
            {createError ? (
              <SecretCreateError
                error={createError}
                provider={createForm.provider}
                providerConfigId={createForm.providerConfigId || null}
              />
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setCreateError(null);
                createMutation.mutate();
              }}
              disabled={
                createMutation.isPending ||
                !createForm.name.trim() ||
                (secretValueProvider === "user"
                  ? !createForm.key.trim()
                  : Boolean(createProviderBlockReason) ||
                    (createMode === "managed" ? !createForm.value : !createForm.externalRef.trim()))
              }
            >
              {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              {editingDefinition
                ? t("companySettings.save")
                : secretValueProvider === "user"
                  ? t("secrets.Create_user_provided_secret")
                  : createMode === "managed"
                    ? t("secrets.Create_secret")
                    : t("secrets.Link_reference")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={vaultDialogOpen} onOpenChange={setVaultDialogOpen}>
        <DialogContent className="max-h-(--sz-85vh) overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingVault ? t("secrets.Edit_provider_vault") : t("secrets.Create_provider_vault")}</DialogTitle>
            <DialogDescription>
              {t("secrets.Save_only_non_sensitive_routing_metadata")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium" htmlFor="vault-provider">{t("secrets.providerLabel")}</label>
                <select
                  id="vault-provider"
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none disabled:opacity-60"
                  value={vaultForm.provider}
                  disabled={Boolean(editingVault)}
                  onChange={(event) => {
                    const provider = event.target.value as SecretProvider;
                    setVaultForm(emptyProviderVaultForm(provider));
                    setVaultDiscovery(null);
                    setVaultDiscoveryError(null);
                  }}
                >
                  {PROVIDER_ORDER.map((provider) => (
                    <option key={provider} value={provider}>
                      {providerLabel(providers, provider)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium" htmlFor="vault-name">{t("secrets.Display_name")}</label>
                <Input
                  id="vault-name"
                  value={vaultForm.displayName}
                  onChange={(event) =>
                    setVaultForm((current) => ({ ...current, displayName: event.target.value }))
                  }
                  placeholder={t("secrets.Production_local_vault")}
                />
              </div>
              <div>
                <label className="text-xs font-medium" htmlFor="vault-status">{t("common.status")}</label>
                <select
                  id="vault-status"
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none"
                  value={vaultForm.status}
                  onChange={(event) => {
                    const status = event.target.value as SecretProviderConfigStatus;
                    setVaultForm((current) => ({
                      ...current,
                      status,
                      isDefault:
                        status === "coming_soon" || status === "disabled" ? false : current.isDefault,
                    }));
                  }}
                >
                  <option value="ready" disabled={vaultForm.provider === "gcp_secret_manager" || vaultForm.provider === "vault"}>
                    {t("secrets.Ready")}
                  </option>
                  <option value="warning" disabled={vaultForm.provider === "gcp_secret_manager" || vaultForm.provider === "vault"}>
                    {t("secrets.Warning")}
                  </option>
                  <option value="coming_soon">{t("secrets.Coming_soon")}</option>
                  <option value="disabled">{t("secrets.Disabled")}</option>
                </select>
              </div>
              <label className="flex items-center gap-2 pt-6 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={vaultForm.isDefault}
                  disabled={vaultForm.status === "coming_soon" || vaultForm.status === "disabled"}
                  onChange={(event) =>
                    setVaultForm((current) => ({ ...current, isDefault: event.target.checked }))
                  }
                />
                {t("secrets.mark_default_for", { provider: providerLabel(providers, vaultForm.provider) })}
              </label>
            </div>

            <ProviderVaultFields form={vaultForm} onChange={setVaultForm} />

            {!editingVault && vaultForm.provider === "aws_secrets_manager" ? (
              <AwsProviderVaultDiscoveryPanel
                form={vaultForm}
                preview={vaultDiscovery}
                error={vaultDiscoveryError}
                loading={discoverVaultMutation.isPending}
                onDiscover={() => {
                  setVaultDiscovery(null);
                  setVaultDiscoveryError(null);
                  discoverVaultMutation.mutate();
                }}
                onApply={applyVaultDiscoveryCandidate}
              />
            ) : null}

            {vaultForm.provider === "gcp_secret_manager" || vaultForm.provider === "vault" ? (
              <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-700 dark:text-sky-300">
                {t("secrets.Provider_can_save_draft_routing")}
              </div>
            ) : null}
            {vaultError ? <p className="text-xs text-destructive">{vaultError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVaultDialogOpen(false)}>
              {t("agentDetail.cancelButton")}
            </Button>
            <Button
              onClick={() => {
                setVaultError(null);
                saveVaultMutation.mutate();
              }}
              disabled={
                saveVaultMutation.isPending ||
                !vaultForm.displayName.trim() ||
                (vaultForm.provider === "aws_secrets_manager" && !vaultForm.region.trim())
              }
            >
              {saveVaultMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              {editingVault ? t("secrets.Save_vault") : t("secrets.Create_vault")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedSecret?.managedMode === "external_reference" && rotateMode === "reference"
                ? t("secrets.Update_external_reference")
                : t("secrets.Update_secret_value")}
            </DialogTitle>
            <DialogDescription>
              {selectedSecret?.managedMode !== "external_reference"
                ? t("secrets.Creates_a_new_provider_backed_version_Co")
                : rotateMode === "reference"
                  ? t("secrets.Creates_a_new_Paperclip_metadata_version")
                  : t("secrets.Writes_a_new_version_of_the_referenced_p")}
            </DialogDescription>
          </DialogHeader>
          {selectedSecret && secretSupportsExternalValueWrite(selectedSecret) ? (
            <Tabs value={rotateMode} onValueChange={(value) => setRotateMode(value as RotateMode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="value">{t("secrets.Write_new_value")}</TabsTrigger>
                <TabsTrigger value="reference">{t("secrets.Change_reference")}</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
          <div>
            <label className="text-xs font-medium" htmlFor="rotate-secret-vault">{t("secrets.Provider_vault")}</label>
            <select
              id="rotate-secret-vault"
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none"
              value={rotateProviderConfigId}
              onChange={(event) => setRotateProviderConfigId(event.target.value)}
            >
              <option value="">{t("secrets.Deployment_default")}</option>
              {selectedRotateProviderConfigs.map((config) => {
                const blockReason = getProviderConfigBlockReason(config);
                return (
                  <option key={config.id} value={config.id} disabled={Boolean(blockReason)}>
                    {config.displayName}
                    {config.isDefault ? ` ${t("secrets.import.vault.default")}` : ""}
                    {blockReason ? ` (${blockReason})` : ""}
                  </option>
                );
              })}
            </select>
            {selectedRotateProviderConfig ? (
              <ProviderVaultInlineWarning config={selectedRotateProviderConfig} />
            ) : (
              <p className="mt-1 text-(length:--text-micro) text-muted-foreground">
                {t("secrets.Rotating_with_deployment_default")}
              </p>
            )}
          </div>
          {selectedSecret?.managedMode === "external_reference" && rotateMode === "reference" ? (
            <div>
              <label className="text-xs font-medium" htmlFor="rotate-ref">{t("secrets.External_reference")}</label>
              <Input
                id="rotate-ref"
                value={rotateExternalRef}
                onChange={(event) => setRotateExternalRef(event.target.value)}
                placeholder={selectedSecret.externalRef ?? t("secrets.Updated_reference")}
                className="font-mono text-xs"
              />
              <p className="mt-1 text-(length:--text-micro) text-muted-foreground">
                {t("secrets.Rotate_actual_value_first")}
              </p>
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium" htmlFor="rotate-value">{t("secrets.New_value")}</label>
              <Textarea
                id="rotate-value"
                value={rotateValue}
                onChange={(event) => setRotateValue(event.target.value)}
                rows={3}
                className="font-mono text-xs"
                placeholder={t("secrets.Paste_the_new_value")}
              />
              {selectedSecret?.managedMode === "external_reference" ? (
                <p className="mt-1 text-(length:--text-micro) text-muted-foreground">
                  {t("secrets.Written_to_provider", { ref: selectedSecret.externalRef })}
                </p>
              ) : null}
            </div>
          )}
          {rotateError ? <p className="text-xs text-destructive">{rotateError}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotateOpen(false)}>
              {t("agentDetail.cancelButton")}
            </Button>
            <Button
              onClick={() => {
                setRotateError(null);
                rotateMutation.mutate();
              }}
              disabled={
                rotateMutation.isPending ||
                Boolean(rotateProviderBlockReason) ||
                (selectedSecret?.managedMode === "external_reference" && rotateMode === "reference"
                  ? !rotateExternalRef.trim() && !selectedSecret?.externalRef
                  : !rotateValue)
              }
            >
              {rotateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              {selectedSecret?.managedMode === "external_reference" && rotateMode === "reference"
                ? t("secrets.Update_reference")
                : t("secrets.Update_value")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteConfirm)} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("secrets.Delete_secret")}</DialogTitle>
            <DialogDescription>
              {t("secrets.Permanently_removes_active_bindings_fail", { name: deleteConfirm?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>{t("common.cancel")}</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(definitionDeleteConfirm)}
        onOpenChange={(open) => !open && setDefinitionDeleteConfirm(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("secrets.Delete_user_provided_secret")}</DialogTitle>
            <DialogDescription>
              {t("secrets.Permanently_removes_user_whole_company", { name: definitionDeleteConfirm?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDefinitionDeleteConfirm(null)}>{t("common.cancel")}</Button>
            <Button
              variant="destructive"
              onClick={() =>
                definitionDeleteConfirm && deleteDefinitionMutation.mutate(definitionDeleteConfirm)
              }
              disabled={deleteDefinitionMutation.isPending}
            >
              {deleteDefinitionMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SetMyUserSecretDialog
        companyId={selectedCompanyId}
        definition={setMyValueFor?.definition ?? null}
        existingSecret={setMyValueFor?.secret ?? null}
        open={setMyValueFor !== null}
        onOpenChange={(open) => {
          if (!open) setSetMyValueFor(null);
        }}
      />

      <Dialog open={Boolean(removeVaultConfirm)} onOpenChange={(open) => !open && setRemoveVaultConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("secrets.Remove_provider_vault")}</DialogTitle>
            <DialogDescription>
              {t("secrets.Removes_from_paperclip_only", { name: removeVaultConfirm?.displayName ?? "" })}{" "}
              {removeVaultConfirm?.provider === "aws_secrets_manager"
                ? t("secrets.This_does_not_delete_the_remote_AWS_Secr")
                : t("secrets.This_does_not_delete_any_remote_provider")}{" "}
              {t("secrets.Secrets_using_vault_will_lose_association")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveVaultConfirm(null)}>{t("common.cancel")}</Button>
            <Button
              variant="destructive"
              onClick={() => removeVaultConfirm && removeVaultMutation.mutate(removeVaultConfirm.id)}
              disabled={removeVaultMutation.isPending}
            >
              {removeVaultMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              {t("secrets.Remove_from_paperclip")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}

function SecretsHowToUse() {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="space-y-1">
        <p className="font-medium text-foreground">{t("secrets.Use_secrets_by_binding_them_to_runtime_e")}</p>
        <p>
          {t("secrets.Secrets_how_to_use_body_1")}{" "}
          <code className="font-mono">{t("secrets.GH_token_example")}</code>, {t("secrets.Secrets_how_to_use_choose")}{" "}
          <span className="font-medium text-foreground">{t("secrets.secretColumn")}</span>, {t("secrets.Secrets_how_to_use_and_select")}
        </p>
        <p>
          {t("secrets.Paperclip_resolves_value_inject")}
        </p>
      </div>
    </div>
  );
}

function SecretsFiltersPopover({
  statusFilter,
  providerFilter,
  providedByFilter,
  providers,
  activeFilterCount,
  onStatusChange,
  onProviderChange,
  onProvidedByChange,
}: {
  statusFilter: SecretStatus | "all";
  providerFilter: SecretProvider | "all";
  providedByFilter: ProvidedByFilter;
  providers: SecretProviderDescriptor[];
  activeFilterCount: number;
  onStatusChange: (value: SecretStatus | "all") => void;
  onProviderChange: (value: SecretProvider | "all") => void;
  onProvidedByChange: (value: ProvidedByFilter) => void;
}) {
  const { t } = useTranslation();
  const resetFilters = () => {
    onStatusChange("active");
    onProviderChange("all");
    onProvidedByChange("all");
  };

  const statusOptions: Array<{ value: SecretStatus | "all"; label: string }> = [
    { value: "active", label: t("secrets.Active") },
    { value: "all", label: t("secrets.All_statuses") },
    { value: "disabled", label: t("secrets.Disabled") },
    { value: "archived", label: t("common.archived") },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn("relative h-8 w-8 shrink-0", activeFilterCount > 0 && "text-blue-600 dark:text-blue-400")}
          title={activeFilterCount > 0 ? t("secrets.filtersTitle", { count: activeFilterCount }) : t("secrets.filterTitle")}
        >
          <Filter className="h-3.5 w-3.5" />
          {activeFilterCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-600 text-(length:--text-nano) font-bold text-white">
              {activeFilterCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-(--sz-calc-41) max-h-(--sz-calc-42) overflow-y-auto overscroll-contain p-0"
      >
        <div className="space-y-3 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t("secrets.filtersHeader")}</span>
            {activeFilterCount > 0 ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={resetFilters}
              >
                <X className="h-3 w-3" />
                {t("common.clear")}
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("secrets.Section_status")}</span>
              <div className="space-y-0.5">
                {statusOptions.map((option) => (
                  <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 hover:bg-accent/50">
                    <Checkbox
                      checked={statusFilter === option.value}
                      onCheckedChange={() => onStatusChange(option.value)}
                    />
                    <span className="text-sm">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("secrets.Section_provided_by")}</span>
              <div className="space-y-0.5">
                {[
                  { value: "all" as const, label: t("secrets.All_sources") },
                  { value: "company" as const, label: t("common.company") },
                  { value: "user" as const, label: t("secrets.Each_user") },
                ].map((option) => (
                  <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 hover:bg-accent/50">
                    <Checkbox
                      checked={providedByFilter === option.value}
                      onCheckedChange={() => onProvidedByChange(option.value)}
                    />
                    <span className="text-sm">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("commentThread.provider")}</span>
              <div className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
                <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 hover:bg-accent/50">
                  <Checkbox
                    checked={providerFilter === "all"}
                    onCheckedChange={() => onProviderChange("all")}
                  />
                  <span className="text-sm">{t("secrets.All_providers")}</span>
                </label>
                {providers.map((provider) => (
                  <label key={provider.id} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 hover:bg-accent/50">
                    <Checkbox
                      checked={providerFilter === provider.id}
                      onCheckedChange={() => onProviderChange(provider.id)}
                    />
                    <span className="text-sm">{provider.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function providerConfigStatusTone(status: SecretProviderConfigStatus) {
  switch (status) {
    case "ready":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "coming_soon":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "disabled":
      return "border-muted bg-muted text-muted-foreground";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function providerFamilyIcon(provider: SecretProvider) {
  switch (provider) {
    case "local_encrypted":
      return Database;
    case "aws_secrets_manager":
      return Cloud;
    case "gcp_secret_manager":
      return ShieldCheck;
    case "vault":
      return KeyRound;
    default:
      return KeyRound;
  }
}

function ProviderVaultInlineWarning({ config }: { config: CompanySecretProviderConfig }) {
  const { t } = useTranslation();
  const blockReason = getProviderConfigBlockReason(config);
  const message = blockReason ?? config.healthMessage;
  if (!message) {
    return (
      <p className="mt-1 text-(length:--text-micro) text-muted-foreground">
        {config.isDefault ? t("secrets.Default_vault") : t("secrets.Vault")} · {config.status.replace("_", " ")}
      </p>
    );
  }
  const warning = config.status === "warning" || config.healthStatus === "warning";
  return (
    <p className={cn("mt-1 flex items-center gap-1 text-(length:--text-micro)", warning ? "text-amber-600 dark:text-amber-400" : "text-destructive")}>
      {warning ? <AlertTriangle className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
      {message}
    </p>
  );
}

interface ImportFromVaultButtonProps {
  providerConfigs: CompanySecretProviderConfig[];
  onClick: () => void;
  onManageVaults: () => void;
  className?: string;
}

function ImportFromVaultButton({
  providerConfigs,
  onClick,
  onManageVaults,
  className,
}: ImportFromVaultButtonProps) {
  const { t } = useTranslation();
  const awsConfigs = providerConfigs.filter(
    (config) => config.provider === "aws_secrets_manager",
  );
  const eligible = awsConfigs.filter(
    (config) => config.status === "ready" || config.status === "warning",
  );

  if (awsConfigs.length === 0) return null;

  if (eligible.length === 0) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={onManageVaults}
        className={cn("text-xs text-muted-foreground", className)}
        title={t("secrets.Configure_an_AWS_provider_vault_to_enabl")}
      >
        <Cloud className="h-3.5 w-3.5 mr-1" /> {t("secrets.AWS_vault_disabled_manage")}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className={className}
      data-testid="import-from-vault-button"
    >
      <Cloud className="h-3.5 w-3.5 mr-1" /> {t("secrets.Import_from_vault")}
    </Button>
  );
}

export function ProviderVaultsTab({
  providers,
  providerConfigs,
  loading,
  error,
  onRetry,
  onCreate,
  onEdit,
  onDisable,
  onRemove,
  onSetDefault,
  onHealthCheck,
  onImportSecrets,
  pendingActionId,
}: {
  providers: SecretProviderDescriptor[];
  providerConfigs: CompanySecretProviderConfig[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onCreate: (provider: SecretProvider) => void;
  onEdit: (config: CompanySecretProviderConfig) => void;
  onDisable: (config: CompanySecretProviderConfig) => void;
  onRemove: (config: CompanySecretProviderConfig) => void;
  onSetDefault: (config: CompanySecretProviderConfig) => void;
  onHealthCheck: (config: CompanySecretProviderConfig) => void;
  onImportSecrets: (config: CompanySecretProviderConfig) => void;
  pendingActionId: string | null;
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("secrets.Loading_provider_vaults")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-4 text-sm text-destructive flex items-center gap-2">
        <AlertCircle className="h-4 w-4" /> {t("secrets.Ad_hoc_load_failed", { message: (error as Error).message })}
        <Button variant="ghost" size="sm" onClick={onRetry}>
          {t("agentDetail.retry")}
        </Button>
      </div>
    );
  }

  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  const providerRows = PROVIDER_ORDER.map((providerId) => ({
    id: providerId,
    provider: providerMap.get(providerId),
    Icon: providerFamilyIcon(providerId),
    isComingSoonFamily: providerId === "gcp_secret_manager" || providerId === "vault",
    configs: providerConfigs.filter((config) => config.provider === providerId),
  }));

  return (
    <div className="flex min-h-full gap-6">
      <aside className="hidden w-56 shrink-0 md:block">
        <nav className="sticky top-0 space-y-1">
          {providerRows.map(({ id, provider, Icon }) => (
            <a
              key={id}
              href={`#provider-vaults-${id}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            >
              <Icon className="h-4 w-4" />
              <span className="truncate">{provider?.label ?? id.replaceAll("_", " ")}</span>
            </a>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 space-y-6">
        {providerRows.map(({ id, provider, Icon, isComingSoonFamily, configs }) => (
          <section key={id} id={`provider-vaults-${id}`} className={cn("scroll-mt-6 space-y-2", isComingSoonFamily && "opacity-50")}>
            <div className="flex flex-wrap items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">{provider?.label ?? id.replaceAll("_", " ")}</h2>
              {isComingSoonFamily ? (
                <span className="ml-auto text-xs text-muted-foreground">{t("secrets.Coming_soon")}</span>
              ) : (
                <Button variant="outline" size="sm" className="ml-auto" onClick={() => onCreate(id)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add vault
                </Button>
              )}
            </div>
            {configs.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                {isComingSoonFamily
                  ? "Not yet supported."
                  : "No company-specific vaults yet. Secrets can still use the deployment default provider settings."}
              </div>
            ) : (
              <div className="space-y-3">
                {configs.map((config) => (
                  <ProviderVaultCard
                    key={config.id}
                    config={config}
                    pending={pendingActionId === config.id}
                    onEdit={() => onEdit(config)}
                    onDisable={() => onDisable(config)}
                    onRemove={() => onRemove(config)}
                    onSetDefault={() => onSetDefault(config)}
                    onHealthCheck={() => onHealthCheck(config)}
                    onImportSecrets={() => onImportSecrets(config)}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function ProviderVaultCard({
  config,
  pending,
  onEdit,
  onDisable,
  onRemove,
  onSetDefault,
  onHealthCheck,
  onImportSecrets,
}: {
  config: CompanySecretProviderConfig;
  pending: boolean;
  onEdit: () => void;
  onDisable: () => void;
  onRemove: () => void;
  onSetDefault: () => void;
  onHealthCheck: () => void;
  onImportSecrets: () => void;
}) {
  const { t } = useTranslation();
  const blockReason = getProviderConfigBlockReason(config);
  const details = config.healthDetails;
  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium leading-snug">{config.displayName}</h3>
            {config.isDefault ? (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <Star className="h-3 w-3 fill-current" />
                {t("secrets.Default_chip")}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn("font-medium", providerConfigStatusTone(config.status))}>
              {config.status.replace("_", " ")}
            </Badge>
            {config.healthStatus ? (
              <span className="text-xs text-muted-foreground">
                {t("secrets.Health_label")} {config.healthStatus.replace("_", " ")} · {formatRelative(config.healthCheckedAt)}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">{t("secrets.Health_not_checked")}</span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Edit3 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {config.healthMessage || blockReason ? (
        <div className={cn("mt-3 rounded-md p-2 text-xs", blockReason ? "bg-destructive/5 text-destructive" : "bg-muted/40 text-muted-foreground")}>
          {blockReason ?? config.healthMessage}
          {details?.guidance?.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {details.guidance.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onHealthCheck} disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
          {t("secrets.check_health")}
        </Button>
        {config.provider === "aws_secrets_manager" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onImportSecrets}
            disabled={pending || Boolean(blockReason)}
            title={
              blockReason
                ? blockReason
                : t("secrets.refresh_aws_metadata_tooltip")
            }
            data-testid={`provider-vault-refresh-secrets-${config.id}`}
          >
            <Cloud className="h-3.5 w-3.5 mr-1" />
            {t("secrets.Refresh_secrets")}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={onSetDefault}
          disabled={pending || Boolean(blockReason) || config.isDefault}
        >
          <Star className="h-3.5 w-3.5 mr-1" />
          {t("secrets.Make_default")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onDisable}
          disabled={pending || config.status === "disabled"}
        >
          <Ban className="h-3.5 w-3.5 mr-1" />
          {t("secrets.Disable")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onRemove}
          disabled={pending}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          {t("common.remove")}
        </Button>
      </div>
    </div>
  );
}

function ProviderVaultFields({
  form,
  onChange,
}: {
  form: ProviderVaultForm;
  onChange: React.Dispatch<React.SetStateAction<ProviderVaultForm>>;
}) {
  const { t } = useTranslation();
  const setField = (key: keyof ProviderVaultForm, value: string | boolean) => {
    onChange((current) => ({ ...current, [key]: value }));
  };

  if (form.provider === "local_encrypted") {
    return (
      <label className="flex items-start gap-2 rounded-md border border-border bg-muted/20 p-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-border"
          checked={form.backupReminderAcknowledged}
          onChange={(event) => setField("backupReminderAcknowledged", event.target.checked)}
        />
        <span>
          {t("secrets.Backup_acknowledgement")}
        </span>
      </label>
    );
  }

  if (form.provider === "aws_secrets_manager") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t("secrets.AWS_region_label")} value={form.region} onChange={(value) => setField("region", value)} placeholder={t("secrets.AWS_region_placeholder")} required />
        <TextField label={t("secrets.AWS_namespace_label")} value={form.namespace} onChange={(value) => setField("namespace", value)} placeholder={t("secrets.AWS_namespace_placeholder")} />
        <TextField label={t("secrets.AWS_secret_name_prefix_label")} value={form.secretNamePrefix} onChange={(value) => setField("secretNamePrefix", value)} placeholder={t("secrets.AWS_secret_name_prefix_placeholder")} />
        <TextField label={t("secrets.AWS_kms_key_id_label")} value={form.kmsKeyId} onChange={(value) => setField("kmsKeyId", value)} placeholder={t("secrets.AWS_kms_key_id_placeholder")} />
        <TextField label={t("secrets.AWS_owner_tag_label")} value={form.ownerTag} onChange={(value) => setField("ownerTag", value)} placeholder={t("secrets.AWS_owner_tag_placeholder")} />
        <TextField label={t("secrets.AWS_environment_tag_label")} value={form.environmentTag} onChange={(value) => setField("environmentTag", value)} placeholder={t("secrets.AWS_environment_tag_placeholder")} />
      </div>
    );
  }

  if (form.provider === "gcp_secret_manager") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t("secrets.GCP_project_id_label")} value={form.projectId} onChange={(value) => setField("projectId", value)} placeholder={t("secrets.GCP_project_id_placeholder")} />
        <TextField label={t("secrets.GCP_location_label")} value={form.location} onChange={(value) => setField("location", value)} placeholder={t("secrets.GCP_location_placeholder")} />
        <TextField label={t("secrets.AWS_namespace_label")} value={form.namespace} onChange={(value) => setField("namespace", value)} placeholder={t("secrets.AWS_namespace_placeholder")} />
        <TextField label={t("secrets.AWS_secret_name_prefix_label")} value={form.secretNamePrefix} onChange={(value) => setField("secretNamePrefix", value)} placeholder={t("secrets.AWS_secret_name_prefix_placeholder")} />
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField label={t("secrets.Vault_address_label")} value={form.address} onChange={(value) => setField("address", value)} placeholder={t("secrets.Vault_address_placeholder")} />
      <TextField label={t("secrets.AWS_namespace_label")} value={form.namespace} onChange={(value) => setField("namespace", value)} placeholder={t("secrets.Vault_namespace_placeholder")} />
      <TextField label={t("secrets.Vault_mount_path_label")} value={form.mountPath} onChange={(value) => setField("mountPath", value)} placeholder={t("secrets.Vault_mount_path_placeholder")} />
      <TextField label={t("secrets.Vault_secret_path_prefix_label")} value={form.secretPathPrefix} onChange={(value) => setField("secretPathPrefix", value)} placeholder={t("secrets.Vault_secret_path_prefix_placeholder")} />
    </div>
  );
}

function AwsProviderVaultDiscoveryPanel({
  form,
  preview,
  error,
  loading,
  onDiscover,
  onApply,
}: {
  form: ProviderVaultForm;
  preview: SecretProviderConfigDiscoveryPreviewResult | null;
  error: unknown | null;
  loading: boolean;
  onDiscover: () => void;
  onApply: (candidate: SecretProviderConfigDiscoveryCandidate) => void;
}) {
  const { t } = useTranslation();
  const canDiscover = Boolean(form.region.trim());
  const warnings = preview?.warnings ?? [];

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("secrets.AWS_discovery")}</p>
          <p className="text-xs text-muted-foreground">
            {t("secrets.AWS_discovery_uses_draft_routing")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDiscover}
          disabled={!canDiscover || loading}
          data-testid="aws-vault-discovery-button"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Search className="h-3.5 w-3.5 mr-1" />
          )}
          {t("secrets.Find_existing_aws_values")}
        </Button>
      </div>

      {!canDiscover ? (
        <p className="text-xs text-muted-foreground">{t("secrets.Enter_an_AWS_region_before_discovery")}</p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("secrets.Searching_AWS_Secrets_Manager_metadata")}
        </div>
      ) : null}

      {error ? (
        <AwsProviderVaultDiscoveryError form={form} error={error} />
      ) : null}

      {warnings.length > 0 ? (
        <div className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          {warnings.map((warning) => (
            <div key={warning} className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}

      {preview && preview.candidates.length === 0 && !loading ? (
        <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          {t("secrets.No_AWS_vault_metadata_candidates")}
        </div>
      ) : null}

      {preview && preview.candidates.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Database className="h-3.5 w-3.5" />
            <span>
              {t("secrets.Candidate_count", { count: preview.candidates.length, plural: preview.candidates.length === 1 ? "" : "s", count2: preview.sampledSecretCount, plural2: preview.sampledSecretCount === 1 ? "" : "s" })}
            </span>
          </div>
          <div className="space-y-2" data-testid="aws-vault-discovery-candidates">
            {preview.candidates.map((candidate, index) => (
              <AwsProviderVaultDiscoveryCandidateRow
                key={`${candidate.displayName}-${index}`}
                candidate={candidate}
                onApply={() => onApply(candidate)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AwsProviderVaultDiscoveryError({
  form,
  error,
}: {
  form: ProviderVaultForm;
  error: unknown;
}) {
  const { t } = useTranslation();
  const details = apiErrorDetails(error);
  const isAccessDenied = isAwsDiscoveryAccessDenied(error);
  const region = (details?.region ?? form.region.trim()) || "unspecified";
  const message = readableErrorMessage(error);
  const safeDetails = {
    message,
    status: error instanceof ApiError ? error.status : undefined,
    provider: details?.provider ?? form.provider,
    operation: details?.operation ?? "secret_provider_config.discovery.preview",
    providerVaultContext: details?.providerVaultContext ?? "draft_config",
    region,
    code: details?.code,
    requiredCapability: details?.requiredCapability,
    credentialPath: details?.credentialPath,
    safeAlternative: details?.safeAlternative,
  };
  const detailsText = JSON.stringify(safeDetails, null, 2);

  const copyDetails = () => {
    void copyTextToClipboard(detailsText).catch(() => {});
  };

  return (
    <div
      className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
      role="alert"
      data-testid="aws-vault-discovery-error"
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="font-medium">
              {isAccessDenied ? t("secrets.AWS_discovery_needs_ListSecrets_permissi") : t("secrets.AWS_discovery_failed")}
            </p>
            <p className="mt-1 leading-relaxed text-destructive/85">
              {isAccessDenied
                ? details?.actionableMessage ??
                  t("secrets.Discovery_needs_secretsmanager_ListSecre")
                : message}
            </p>
          </div>
          {isAccessDenied ? (
            <p className="leading-relaxed text-destructive/85">
              {details?.safeAlternative ??
                t("secrets.AWS_discovery_safe_alternative")}
            </p>
          ) : null}
          <dl className="grid gap-1 text-destructive/80 sm:grid-cols-2">
            <div>
              <dt className="font-medium">{t("secrets.Region")}</dt>
              <dd>{region}</dd>
            </div>
            <div>
              <dt className="font-medium">{t("secrets.Operation")}</dt>
              <dd>{details?.operation ?? "secret_provider_config.discovery.preview"}</dd>
            </div>
            <div>
              <dt className="font-medium">{t("commentThread.provider")}</dt>
              <dd>{details?.provider ?? "aws_secrets_manager"}</dd>
            </div>
            <div>
              <dt className="font-medium">{t("secrets.Vault_context")}</dt>
              <dd>{details?.providerVaultContext ?? "draft_config"}</dd>
            </div>
          </dl>
          <div className="rounded-md border border-destructive/20 bg-background/70 p-2 text-foreground">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium text-muted-foreground">{t("secrets.Safe_request_error_details")}</span>
              <Button type="button" variant="ghost" size="sm" onClick={copyDetails}>
                {t("agentDetail.copy")}
              </Button>
            </div>
            <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono text-(length:--text-micro) leading-relaxed">
              {detailsText}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function SecretCreateError({
  error,
  provider,
  providerConfigId,
}: {
  error: unknown;
  provider: SecretProvider;
  providerConfigId: string | null;
}) {
  const { t } = useTranslation();
  const details = apiErrorDetails(error);
  const message = readableErrorMessage(error);
  const isAwsCreateError =
    details?.provider === "aws_secrets_manager" && details.operation === "secret.create";
  const isAccessDenied = isAwsCreateError && details.code === "access_denied";
  const safeDetails = {
    message,
    status: error instanceof ApiError ? error.status : undefined,
    provider: details?.provider ?? provider,
    operation: details?.operation ?? "secret.create",
    providerConfigId: details?.providerConfigId ?? providerConfigId ?? "deployment-default",
    region: details?.region,
    code: details?.code,
    requiredCapability: details?.requiredCapability,
    credentialPath: details?.credentialPath,
    safeAlternative: details?.safeAlternative,
  };
  const detailsText = JSON.stringify(safeDetails, null, 2);

  if (!isAwsCreateError) {
    return (
      <p className="text-xs text-destructive" role="alert" data-testid="secret-create-error">
        {message}
      </p>
    );
  }

  return (
    <div
      className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
      role="alert"
      data-testid="secret-create-error"
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="font-medium">
              {isAccessDenied ? t("secrets.AWS_secret_creation_needs_CreateSecret_p") : t("secrets.AWS_secret_creation_failed")}
            </p>
            <p className="mt-1 leading-relaxed text-destructive/85">
              {details?.actionableMessage ?? message}
            </p>
          </div>
          {details?.safeAlternative ? (
            <p className="leading-relaxed text-destructive/85">{details.safeAlternative}</p>
          ) : null}
          <dl className="grid gap-1 text-destructive/80 sm:grid-cols-2">
            {details?.requiredCapability ? (
              <div>
                <dt className="font-medium">{t("secrets.Required_IAM_capability")}</dt>
                <dd className="font-mono">{details.requiredCapability}</dd>
              </div>
            ) : null}
            {details?.region ? (
              <div>
                <dt className="font-medium">{t("secrets.Region")}</dt>
                <dd>{details.region}</dd>
              </div>
            ) : null}
            <div>
              <dt className="font-medium">{t("secrets.Provider_vault")}</dt>
              <dd className="break-all">{details?.providerConfigId ?? providerConfigId ?? t("secrets.Deployment_default")}</dd>
            </div>
            <div>
              <dt className="font-medium">{t("secrets.Operation")}</dt>
              <dd>{details?.operation ?? "secret.create"}</dd>
            </div>
          </dl>
          <div className="rounded-md border border-destructive/20 bg-background/70 p-2 text-foreground">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium text-muted-foreground">{t("secrets.Safe_request_error_details")}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void copyTextToClipboard(detailsText).catch(() => {})}
              >
                {t("agentDetail.copy")}
              </Button>
            </div>
            <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono text-(length:--text-micro) leading-relaxed">
              {detailsText}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function AwsProviderVaultDiscoveryCandidateRow({
  candidate,
  onApply,
}: {
  candidate: SecretProviderConfigDiscoveryCandidate;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const fieldSummary = [
    providerConfigValue(candidate.config, "region"),
    providerConfigValue(candidate.config, "namespace"),
    providerConfigValue(candidate.config, "secretNamePrefix"),
  ].filter(Boolean);

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium leading-snug">{candidate.displayName}</p>
            <span className="text-xs text-muted-foreground">
              {t("secrets.Sample_count", { count: candidate.sampleCount, plural: candidate.sampleCount === 1 ? "" : "s" })}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {fieldSummary.length > 0 ? fieldSummary.join(" / ") : t("secrets.No_stable_namespace_or_prefix_detected")}
          </p>
          {candidate.samples[0] ? (
            <p className="mt-1 truncate font-mono text-(length:--text-micro) text-muted-foreground">
              {candidate.samples[0].name}
            </p>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onApply}>
          {t("secrets.Use_values")}
        </Button>
      </div>
      {candidate.warnings.length > 0 ? (
        <div className="mt-2 space-y-1 text-xs text-amber-700 dark:text-amber-300">
          {candidate.warnings.map((warning) => (
            <div key={warning} className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const { t } = useTranslation();
  const id = `provider-vault-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div>
      <label className="text-xs font-medium" htmlFor={id}>
        {label}
        {required ? null : <span className="text-muted-foreground/70"> {t("secrets.optional")}</span>}
      </label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}

function CoverageInline({
  companyId,
  definitionId,
  compact = false,
}: {
  companyId: string;
  definitionId: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const coverageQuery = useQuery({
    queryKey: queryKeys.secrets.userDefinitionCoverage(companyId, definitionId),
    queryFn: () => secretsApi.userSecretDefinitionCoverage(companyId, definitionId),
    staleTime: 30_000,
  });
  const summary = coverageQuery.data;
  if (coverageQuery.isPending) return <span className="text-muted-foreground">{t("secrets.Loading")}</span>;
  if (coverageQuery.isError) return <span className="text-destructive">{t("secrets.Coverage_unavailable")}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
      <Users className="h-3 w-3" />
      <span className="truncate">
        {compact && summary
          ? `${summary.configuredCount}/${summary.configuredCount + summary.missingCount + summary.inactiveCount} ${t("secrets.Set")}`
          : coverageSummaryLabel(summary)}
      </span>
      {summary && summary.missingCount > 0 ? (
        <span className="shrink-0 text-amber-600 dark:text-amber-400">
          · {compact ? `${summary.missingCount} miss` : `${summary.missingCount} ${t("secrets.Missing")}`}
        </span>
      ) : null}
    </span>
  );
}

function UserSecretDetailsTab({
  companyId,
  definition,
  onViewCoverage,
}: {
  companyId: string;
  definition: UserSecretDefinition;
  onViewCoverage: () => void;
}) {
  const { t } = useTranslation();
  return (
    <dl className="divide-y divide-border/60 text-xs">
      <DetailRow label={t("secrets.detail_row_description")}>
        <span>{definition.description ?? <span className="text-muted-foreground">—</span>}</span>
      </DetailRow>
      <DetailRow label={t("secrets.detail_row_provided_by")}>{t("secrets.Each_user")}</DetailRow>
      <DetailRow label={t("secrets.detail_row_key")}>
        <code>{definition.key}</code>
      </DetailRow>
      <DetailRow label={t("secrets.detail_row_status")}><StatusBadge status={definition.status} /></DetailRow>
      <DetailRow label={t("secrets.detail_row_coverage")}>
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-1 text-left text-primary hover:underline"
          onClick={onViewCoverage}
        >
          <CoverageInline companyId={companyId} definitionId={definition.id} />
          <span className="shrink-0 text-muted-foreground">{t("secrets.View_in_Coverage")}</span>
        </button>
      </DetailRow>
      <DetailRow label={t("secrets.detail_row_created")}>{formatRelative(definition.createdAt)}</DetailRow>
      <DetailRow label={t("secrets.detail_row_updated")}>{formatRelative(definition.updatedAt)}</DetailRow>
      <DetailRow label={t("secrets.detail_row_usage_guidance")}>
        {definition.usageGuidance ?? <span className="text-muted-foreground">—</span>}
      </DetailRow>
      <div className="mt-3 rounded-md border border-violet-500/30 bg-violet-500/5 p-2 text-(length:--text-micro) text-violet-800 dark:text-violet-200">
        {t("secrets.No_value_stored_on_admin_row")}
      </div>
    </dl>
  );
}

function UserSecretCoverageTab({
  companyId,
  definitionId,
}: {
  companyId: string;
  definitionId: string;
}) {
  const { t } = useTranslation();
  const coverageQuery = useQuery({
    queryKey: queryKeys.secrets.userDefinitionCoverage(companyId, definitionId),
    queryFn: () => secretsApi.userSecretDefinitionCoverage(companyId, definitionId),
    staleTime: 30_000,
  });
  if (coverageQuery.isPending) {
    return <div className="py-6 text-center text-xs text-muted-foreground">{t("secrets.Loading")}</div>;
  }
  if (coverageQuery.isError) {
    return <div className="py-6 text-center text-xs text-destructive">{t("secrets.Coverage_unavailable_2")}</div>;
  }
  const summary: UserSecretCoverageSummary = coverageQuery.data;
  const total = summary.configuredCount + summary.missingCount + summary.inactiveCount;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        <span>{coverageSummaryLabel(summary)}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
          <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">
            {summary.configuredCount}
          </div>
          <div className="text-muted-foreground">{t("secrets.Set")}</div>
        </div>
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="text-lg font-semibold text-amber-700 dark:text-amber-300">
            {summary.missingCount}
          </div>
          <div className="text-muted-foreground">{t("secrets.Missing")}</div>
        </div>
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="text-lg font-semibold text-muted-foreground">
            {summary.inactiveCount}
          </div>
          <div className="text-muted-foreground">{t("secrets.Inactive")}</div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("secrets.Coverage_counts_only", { count: total, plural: total === 1 ? "" : "s" })}
      </p>
    </div>
  );
}

function UserSecretUsageTab({ definition }: { definition: UserSecretDefinition }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 text-xs text-muted-foreground">
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <Trans
          i18nKey="secrets.User_secret_usage_body"
          values={{ key: definition.key }}
          components={{
            UserSecret: <span className="font-medium text-foreground">{t("secrets.User_secret_label")}</span>,
            key: <code className="font-mono">{definition.key}</code>,
          }}
        />
      </div>
      {definition.usageGuidance ? (
        <div>
          <p className="mb-1 text-(length:--text-micro) uppercase tracking-wide text-muted-foreground">{t("secrets.Member_guidance")}</p>
          <p className="text-foreground">{definition.usageGuidance}</p>
        </div>
      ) : null}
    </div>
  );
}

function UserSecretAccessEventsTab() {
  const { t } = useTranslation();
  return (
    <div className="py-6 text-center text-xs text-muted-foreground">
      {t("secrets.Access_events_recording")}
    </div>
  );
}

type AgentAccessReference =
  | { kind: "company"; secret: CompanySecret }
  | { kind: "user"; definition: UserSecretDefinition };

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Env keys in an agent's env config that resolve to this secret/definition. */
function envKeysReferencingSecret(env: unknown, reference: AgentAccessReference): string[] {
  if (typeof env !== "object" || env === null || Array.isArray(env)) return [];
  return Object.entries(env as Record<string, unknown>)
    .filter(([, binding]) => {
      if (typeof binding !== "object" || binding === null) return false;
      const record = binding as Record<string, unknown>;
      return reference.kind === "company"
        ? record.type === "secret_ref" && record.secretId === reference.secret.id
        : record.type === "user_secret_ref" && record.key === reference.definition.key;
    })
    .map(([key]) => key)
    .sort();
}

/**
 * Top-level `access.<ALIAS>` keys in an agent's adapter config that resolve to
 * this secret (API-access delivery). Only company secrets support API access;
 * user secrets remain env-only.
 */
function apiAliasesReferencingSecret(adapterConfig: unknown, reference: AgentAccessReference): string[] {
  if (reference.kind !== "company") return [];
  if (typeof adapterConfig !== "object" || adapterConfig === null || Array.isArray(adapterConfig)) return [];
  return Object.entries(adapterConfig as Record<string, unknown>)
    .filter(([key, binding]) => {
      if (!key.startsWith(AGENT_ACCESS_CONFIG_PATH_PREFIX)) return false;
      if (typeof binding !== "object" || binding === null) return false;
      const record = binding as Record<string, unknown>;
      return record.type === "secret_ref" && record.secretId === reference.secret.id;
    })
    .map(([key]) => key.slice(AGENT_ACCESS_CONFIG_PATH_PREFIX.length))
    .sort();
}

function AgentAccessSection({
  companyId,
  reference,
}: {
  companyId: string;
  reference: AgentAccessReference;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [envKey, setEnvKey] = useState("");
  const [envKeyDirty, setEnvKeyDirty] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  const referenceId = reference.kind === "company" ? reference.secret.id : reference.definition.id;
  const referenceName = reference.kind === "company" ? reference.secret.name : reference.definition.name;

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    staleTime: 30_000,
  });
  const agents = useMemo(
    () => (agentsQuery.data ?? []).filter((agent) => agent.status !== "terminated"),
    [agentsQuery.data],
  );
  const agentAccess = useMemo(
    () =>
      agents
        .map((agent) => {
          const adapterConfig = (agent.adapterConfig as Record<string, unknown> | null) ?? null;
          return {
            agent,
            envKeys: envKeysReferencingSecret(adapterConfig?.env, reference),
            apiAliases: apiAliasesReferencingSecret(adapterConfig, reference),
          };
        })
        .filter((entry) => entry.envKeys.length > 0 || entry.apiAliases.length > 0),
    [agents, reference],
  );
  const grantableAgents = useMemo(
    () => agents.filter((agent) => !agentAccess.some((entry) => entry.agent.id === agent.id)),
    [agents, agentAccess],
  );

  const effectiveEnvKey = envKeyDirty
    ? envKey
    : reference.kind === "user"
      ? reference.definition.key
      : envKeyFromSecretName(referenceName);

  useEffect(() => {
    setSelectedAgentId("");
    setEnvKey("");
    setEnvKeyDirty(false);
    setAccessError(null);
  }, [referenceId]);

  function invalidateAfterChange(agentId: string) {
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentId) });
    if (reference.kind === "company") {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.usage(reference.secret.id) });
    }
  }

  const grantMutation = useMutation({
    mutationFn: async ({ agentId, key }: { agentId: string; key: string }) => {
      // Re-fetch right before patching so we merge into the freshest env config.
      const detail = await agentsApi.get(agentId, companyId);
      const adapterConfig = { ...((detail.adapterConfig ?? {}) as Record<string, unknown>) };
      const env = { ...((adapterConfig.env ?? {}) as Record<string, unknown>) };
      if (env[key] !== undefined) {
        throw new Error(`${detail.name} already has an env var named ${key}.`);
      }
      env[key] =
        reference.kind === "company"
          ? { type: "secret_ref", secretId: reference.secret.id }
          : { type: "user_secret_ref", key: reference.definition.key };
      return agentsApi.update(
        agentId,
        { adapterConfig: { ...adapterConfig, env }, replaceAdapterConfig: true },
        companyId,
      );
    },
    onSuccess: (agent, variables) => {
      setSelectedAgentId("");
      setEnvKey("");
      setEnvKeyDirty(false);
      setAccessError(null);
      invalidateAfterChange(variables.agentId);
      pushToast({ title: "Access granted", body: `${agent.name} now receives ${variables.key}`, tone: "success" });
    },
    onError: (error) => setAccessError(readableErrorMessage(error)),
  });

  const revokeMutation = useMutation({
    mutationFn: async ({ agentId }: { agentId: string }) => {
      const detail = await agentsApi.get(agentId, companyId);
      const adapterConfig = { ...((detail.adapterConfig ?? {}) as Record<string, unknown>) };
      const env = { ...((adapterConfig.env ?? {}) as Record<string, unknown>) };
      const keys = envKeysReferencingSecret(env, reference);
      const aliases = apiAliasesReferencingSecret(adapterConfig, reference);
      if (keys.length === 0 && aliases.length === 0) return detail;
      for (const key of keys) delete env[key];
      for (const alias of aliases) delete adapterConfig[`${AGENT_ACCESS_CONFIG_PATH_PREFIX}${alias}`];
      return agentsApi.update(
        agentId,
        { adapterConfig: { ...adapterConfig, env }, replaceAdapterConfig: true },
        companyId,
      );
    },
    onSuccess: (agent, variables) => {
      setAccessError(null);
      invalidateAfterChange(variables.agentId);
      pushToast({ title: "Access removed", body: agent.name, tone: "info" });
    },
    onError: (error) => setAccessError(readableErrorMessage(error)),
  });

  const envKeyValid = ENV_KEY_PATTERN.test(effectiveEnvKey);
  const canGrant = Boolean(selectedAgentId) && envKeyValid && !grantMutation.isPending;

  return (
    <section className="rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-xs font-medium text-foreground">{t("secrets.Agent_access")}</h3>
      </div>
      <p className="mt-0.5 text-(length:--text-micro) text-muted-foreground">
        {reference.kind === "company"
          ? t("secrets.Agent_access_help_company")
          : t("secrets.Agent_access_help_user")}
      </p>
      {agentsQuery.isPending ? (
        <p className="mt-2 text-(length:--text-micro) text-muted-foreground">{t("secrets.Loading_agents")}</p>
      ) : agentsQuery.isError ? (
        <p className="mt-2 text-(length:--text-micro) text-muted-foreground">
          {t("secrets.Agent_list_unavailable_message")}
        </p>
      ) : (
        <>
          {agentAccess.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {agentAccess.map(({ agent, envKeys, apiAliases }) => (
                <li
                  key={agent.id}
                  className="flex items-center gap-2 rounded border border-border/60 bg-background px-2 py-1"
                >
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{agent.name}</span>
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {envKeys.length > 0 ? (
                      <Badge
                        variant="outline"
                        className="h-5 px-1.5 text-(length:--text-nano) font-normal border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                      >
                        {t("secrets.Env_var")} · {envKeys.join(", ")}
                      </Badge>
                    ) : null}
                    {apiAliases.length > 0 ? (
                      <Badge
                        variant="outline"
                        className="h-5 px-1.5 text-(length:--text-nano) font-normal border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                      >
                        API · {apiAliases.join(", ")}
                      </Badge>
                    ) : null}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 shrink-0 p-0 text-muted-foreground"
                    aria-label={t("secrets.remove_access_for", { name: agent.name })}
                    disabled={revokeMutation.isPending}
                    onClick={() => revokeMutation.mutate({ agentId: agent.id })}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-(length:--text-micro) text-muted-foreground">{t("secrets.No_agents_have_access_yet")}</p>
          )}
          <div className="mt-2 flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <label
                className="text-(length:--text-micro) font-medium text-muted-foreground"
                htmlFor="agent-access-agent"
              >
                {t("secrets.Agent")}
              </label>
              <AgentSelect
                id="agent-access-agent"
                agents={grantableAgents}
                value={selectedAgentId}
                onChange={setSelectedAgentId}
                triggerClassName="h-8 text-xs"
                emptyMessage={t("secrets.No_agents_available")}
              />
            </div>
            <div className="min-w-0 flex-1">
              <label
                className="text-(length:--text-micro) font-medium text-muted-foreground"
                htmlFor="agent-access-env-key"
              >
                {t("secrets.Env_var")}
              </label>
              <Input
                id="agent-access-env-key"
                value={effectiveEnvKey}
                onChange={(event) => {
                  setEnvKeyDirty(true);
                  setEnvKey(event.target.value.toUpperCase());
                }}
                className="h-8 font-mono text-xs"
                placeholder={t("secrets.MY_SECRET")}
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0"
              disabled={!canGrant}
              onClick={() => grantMutation.mutate({ agentId: selectedAgentId, key: effectiveEnvKey })}
            >
              {grantMutation.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="mr-1 h-3.5 w-3.5" />
              )}
              {t("secrets.Grant_access")}
            </Button>
          </div>
          {effectiveEnvKey && !envKeyValid ? (
            <p className="mt-1 text-(length:--text-micro) text-destructive">
              {t("secrets.Env_keys_validation_help")}
            </p>
          ) : null}
          {accessError ? (
            <p className="mt-1 text-(length:--text-micro) text-destructive">{accessError}</p>
          ) : null}
        </>
      )}
    </section>
  );
}

function SecretDetailsTab({
  secret,
  providers,
  providerConfigs,
  onViewUsage,
}: {
  secret: CompanySecret;
  providers: SecretProviderDescriptor[];
  providerConfigs: CompanySecretProviderConfig[];
  onViewUsage: () => void;
}) {
  const { t } = useTranslation();
  const bindingLabel = (secret.referenceCount ?? 0) === 1
    ? t("secrets.bindings_count_one")
    : t("secrets.bindings_count_other", { count: secret.referenceCount ?? 0 });

  return (
    <dl className="divide-y divide-border/60 text-xs">
      <DetailRow label={t("secrets.detail_row_description")}>
        <span>{secret.description ?? <span className="text-muted-foreground">—</span>}</span>
      </DetailRow>
      <DetailRow label={t("secrets.detail_row_provided_by")}>{t("common.company")}</DetailRow>
      <DetailRow label={t("secrets.detail_row_custody")}>{modeLabel(secret.managedMode)}</DetailRow>
      <DetailRow label={t("secrets.detail_row_provider")}>{providerLabel(providers, secret.provider)}</DetailRow>
      <DetailRow label={t("secrets.detail_row_provider_vault")}>{providerVaultLabel(providerConfigs, secret.providerConfigId)}</DetailRow>
      <DetailRow label={t("secrets.detail_row_external_arn")}>
        {secret.externalRef ? (
          <span className="break-all font-mono">{secret.externalRef}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </DetailRow>
      <DetailRow label={t("secrets.detail_row_latest_version")}>v{secret.latestVersion}</DetailRow>
      <DetailRow label={t("secrets.detail_row_references")}>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-left text-primary hover:underline"
          onClick={onViewUsage}
        >
          {bindingLabel}
          <span className="text-muted-foreground">{t("secrets.View_in_Usage")}</span>
        </button>
      </DetailRow>
      <DetailRow label={t("secrets.detail_row_created")}>{formatRelative(secret.createdAt)}</DetailRow>
      <DetailRow label={t("secrets.detail_row_updated")}>{formatRelative(secret.updatedAt)}</DetailRow>
      <DetailRow label={t("secrets.detail_row_last_rotated")}>{formatRelative(secret.lastRotatedAt)}</DetailRow>
      <DetailRow label={t("secrets.detail_row_last_resolved")}>{formatRelative(secret.lastResolvedAt)}</DetailRow>
      <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-(length:--text-micro) text-amber-700 dark:text-amber-300">
        {modeDescription(
          secret.managedMode,
          Boolean(
            secret.externalRef &&
              providers.find((provider) => provider.id === secret.provider)?.supportsExternalValueWrites,
          ),
        )}{" "}
        {t("secrets.Paperclip_never_re_displays_stored_values")}
      </div>
    </dl>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-(--gtc-55) gap-3 py-2">
      <dt className="text-(length:--text-micro) uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}

export function SecretUsageTab({ loading, bindings }: { loading: boolean; bindings: CompanySecretUsageBinding[] }) {
  const { t } = useTranslation();
  if (loading) {
    return <div className="py-6 text-center text-xs text-muted-foreground">{t("secrets.Loading")}</div>;
  }
  if (bindings.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        {t("secrets.No_active_bindings")}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {bindings.map((binding) => {
        const deliveryMode = deliveryModeForConfigPath(binding.configPath);
        return (
          <div
            key={binding.id}
            className="rounded-md border border-border bg-muted/30 p-2 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <span className="font-medium capitalize">{binding.target.type}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 px-1.5 text-(length:--text-nano) font-normal",
                    deliveryMode === "api"
                      ? "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                      : deliveryMode === "env"
                        ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                        : null,
                  )}
                >
                  {deliveryModeLabel(deliveryMode)}
                </Badge>
              </span>
              <span className="font-mono text-muted-foreground">v{binding.versionSelector}</span>
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-2">
              {binding.target.href ? (
                <Link to={binding.target.href} className="truncate font-medium text-primary hover:underline">
                  {binding.target.label}
                </Link>
              ) : (
                <span className="truncate font-medium">{binding.target.label}</span>
              )}
              {binding.target.status ? (
                <Badge variant="outline" className="h-5 px-1.5 text-(length:--text-nano) font-normal">
                  {binding.target.status.replaceAll("_", " ")}
                </Badge>
              ) : null}
            </div>
            <div className="font-mono text-(length:--text-micro) text-muted-foreground break-all">
              {binding.targetId}
            </div>
            <div className="text-(length:--text-micro) text-muted-foreground">
              {deliveryMode === "api" ? (
                <>{t("secrets.API_alias")} <span className="font-mono">{aliasFromConfigPath(binding.configPath)}</span></>
              ) : (
                <span className="font-mono">{binding.configPath}</span>
              )}{" "}
              {binding.required ? t("secrets.required_marker") : t("secrets.optional_marker")}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SecretEventsTab({
  loading,
  events,
  companyId,
}: {
  loading: boolean;
  events: SecretAccessEvent[];
  companyId: string;
}) {
  const { t } = useTranslation();
  // Resolve responsible/owner user ids to human names for user-scoped events.
  const anyUserScoped = events.some(
    (event) =>
      event.secretScope === "user" || event.responsibleUserId || event.credentialOwnerUserId,
  );
  const { data: directory } = useQuery({
    queryKey: queryKeys.access.companyUserDirectory(companyId),
    queryFn: () => accessApi.listUserDirectory(companyId),
    enabled: anyUserScoped,
    staleTime: 60_000,
  });
  const userLabel = (userId: string | null): string => {
    if (!userId) return "—";
    const entry: CompanyUserDirectoryEntry | undefined = directory?.users.find(
      (u) => u.principalId === userId,
    );
    return entry?.user?.name?.trim() || entry?.user?.email?.trim() || `${userId.slice(0, 8)}…`;
  };

  if (loading) {
    return <div className="py-6 text-center text-xs text-muted-foreground">{t("secrets.Loading")}</div>;
  }
  if (events.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        {t("secrets.No_access_events_recorded")}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {events.map((event) => (
        <div key={event.id} className="rounded border border-border px-2 py-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span>{consumerTypeLabel(event.consumerType)}</span>
              <span className="capitalize">· {event.outcome}</span>
              {event.secretScope === "user" ? (
                <Badge
                  variant="outline"
                  className="border-violet-500/30 bg-violet-500/10 text-(length:--text-nano) text-violet-700 dark:text-violet-300"
                >
                  {t("secrets.User_secret_label")}
                </Badge>
              ) : null}
            </span>
            <span className="text-(length:--text-micro) text-muted-foreground">{formatRelative(event.createdAt)}</span>
          </div>
          <div className="font-mono text-(length:--text-micro) text-muted-foreground break-all">
            {event.consumerId}
          </div>
          {event.responsibleUserId ? (
            <div className="text-(length:--text-micro) text-muted-foreground">
              {t("secrets.Responsible_user")} <span className="text-foreground">{userLabel(event.responsibleUserId)}</span>
            </div>
          ) : null}
          {event.credentialOwnerUserId &&
          event.credentialOwnerUserId !== event.responsibleUserId ? (
            <div className="text-(length:--text-micro) text-muted-foreground">
              {t("secrets.Credential_owner")} <span className="text-foreground">{userLabel(event.credentialOwnerUserId)}</span>
            </div>
          ) : null}
          {event.errorCode ? (
            <div className="text-(length:--text-micro) text-destructive">{event.errorCode}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
