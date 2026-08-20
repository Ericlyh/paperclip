import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  ClipboardPaste,
  Link2,
  Loader2,
  Lock,
  Search,
  TerminalSquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  Agent,
  AppDefinition,
  ConnectToolAppResult,
  ToolApplication,
  ToolConnection,
  ToolAppConnectionActionSummary,
} from "@paperclipai/shared";
import { credentialConfigPath, getAppDefinitionForUrl, getAvailableConnectionMethod } from "@paperclipai/shared";
import { useNavigate, useParams, useSearchParams } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useToast } from "@/context/ToastContext";
import { queryKeys } from "@/lib/queryKeys";
import { ApiError } from "@/api/client";
import { toolsApi } from "@/api/tools";
import { agentsApi } from "@/api/agents";
import { appCopyFor, credentialFieldLabel } from "@/lib/app-gallery-copy";
import { advancedTabHref } from "@/pages/tools/tool-tabs";
import { AgentIcon } from "@/components/AgentIconPicker";
import { AgentMultiSelect } from "@/components/AgentMultiSelect";
import { InlineBanner } from "@/components/InlineBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";
import { navigateTopLevel } from "@/lib/browserNavigation";
import { useTranslation } from "@/i18n";
import { AppLogo } from "./AppLogo";
import { appSourceConnectHref, isMcpDirectOAuthConnectSlug } from "./app-connect-policy";
import { parseGoogleSheetIds } from "./google-sheets";
import { installPayload, TOOL_INSTALL_COPY } from "@/lib/tool-installs";

type Step = "gallery" | "key" | "actions" | "who" | "install" | "success";
export type OAuthConnectPhase = "entry" | "starting" | "redirecting" | "error";

const ROUTE_STAGE_BY_STEP: Partial<Record<Step, string>> = {
  key: "setup",
  actions: "actions",
  who: "access",
  install: "install",
  success: "complete",
};

function appConnectHref(appKey: string, step: Step): string {
  const stage = ROUTE_STAGE_BY_STEP[step] ?? "setup";
  const params = new URLSearchParams({ byo: "1", appKey, stage });
  return `/apps/connect?${params.toString()}`;
}
type AppAccessSelection = "all_agents" | { agentIds: string[] };
type InstallMode = "none" | "specific" | "all";
const LINK_CREDENTIAL_CONFIG_PATH = "credentials.authorization";

const STEP_LABELS = (t: (k: string) => string) => [
  t("appsConnect.stepLabels.pickApp"),
  t("appsConnect.stepLabels.addKey"),
  t("appsConnect.stepLabels.chooseActions"),
  t("appsConnect.stepLabels.chooseAccess"),
  t("appsConnect.stepLabels.installTools"),
];
const STEP_INDEX: Record<Exclude<Step, "success">, number> = {
  gallery: 0,
  key: 1,
  actions: 2,
  who: 3,
  install: 4,
};
const ZAPIER_STEP_INDEX: Record<Exclude<Step, "gallery" | "success">, number> = {
  key: 0,
  actions: 1,
  who: 2,
  install: 3,
};
const ZAPIER_STEP_LABELS = (t: (k: string) => string) => [
  t("appsConnect.stepLabels.addMcpUrl"),
  t("appsConnect.stepLabels.chooseActions"),
  t("appsConnect.stepLabels.chooseAccess"),
  t("appsConnect.stepLabels.installTools"),
];
const GOOGLE_SHEETS_STEP_LABELS = (t: (k: string) => string) => [
  t("appsConnect.stepLabels.pickApp"),
  t("appsConnect.stepLabels.shareSheet"),
  t("appsConnect.stepLabels.chooseActions"),
  t("appsConnect.stepLabels.chooseAccess"),
  t("appsConnect.stepLabels.installTools"),
];

function askFirstLevelsFrom(result: ConnectToolAppResult): string[] {
  const raw = (result.suggestedDefaults as { askFirstRiskLevels?: unknown })?.askFirstRiskLevels;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : ["write", "destructive"];
}

function isGoogleSheetsEntry(entry: AppDefinition | null): boolean {
  return entry?.slug === "google-sheets";
}

function appSourceSlug(application: ToolApplication): string | null {
  const metadata = application.metadata;
  if (!metadata) return null;
  const source = metadata.sourceTemplateKey ?? metadata.galleryKey;
  return typeof source === "string" ? source : null;
}

function connectionSourceSlug(connection: ToolConnection): string | null {
  const source = connection.config?.sourceTemplateKey ?? connection.transportConfig.sourceTemplateKey;
  return typeof source === "string" ? source : null;
}

function reusableOAuthConnection(
  sourceSlug: string | null,
  applications: ToolApplication[],
  connections: ToolConnection[],
  options: { applicationId?: string; draftOnly?: boolean } = {},
): ToolConnection | null {
  if (!sourceSlug) return null;
  const matchingApplicationIds = new Set(
    applications
      .filter((application) =>
        application.status !== "archived" &&
        appSourceSlug(application) === sourceSlug &&
        (!options.applicationId || application.id === options.applicationId)
      )
      .map((application) => application.id),
  );
  return connections.find((connection) => {
    const matchesApplication = options.applicationId
      ? connection.applicationId === options.applicationId
      : matchingApplicationIds.has(connection.applicationId) || connectionSourceSlug(connection) === sourceSlug;
    return connection.status !== "archived" &&
      (!options.draftOnly || connection.status === "draft") &&
      connection.authKind === "oauth" &&
      matchesApplication;
  }) ?? null;
}

export function AppsConnect() {
  const navigate = useNavigate();
  const routeParams = useParams<{ appKey?: string }>();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const appKey = routeParams.appKey ?? searchParams.get("appKey") ?? undefined;
  const sourceSlug = searchParams.get("source")?.trim() || null;
  const createNewConnection = searchParams.get("new") === "1";
  const directOAuthSource = isMcpDirectOAuthConnectSlug(sourceSlug) ? sourceSlug : null;
  const requestedAppKey = appKey ?? directOAuthSource ?? undefined;
  const zapierSource = sourceSlug === "zapier";

  // Prefill arrives from the app page for reconnects; read once so later
  // wizard navigation doesn't fight the URL.
  const [prefill] = useState(() => {
    const rawLink = searchParams.get("link")?.trim() ?? "";
    return {
      link: /^https?:\/\//i.test(rawLink) ? rawLink : "",
      name: searchParams.get("name")?.trim() ?? "",
      applicationId: searchParams.get("applicationId")?.trim() || undefined,
    };
  });

  const [step, setStep] = useState<Step>(requestedAppKey || prefill.link || zapierSource ? "key" : "gallery");
  const [entry, setEntry] = useState<AppDefinition | null>(null);
  const [galleryName, setGalleryName] = useState("");
  const [linkUrl, setLinkUrl] = useState(prefill.link);
  const [linkName, setLinkName] = useState(prefill.name || (zapierSource ? t("appsConnect.zapierName") : ""));
  const [linkNeedsKey, setLinkNeedsKey] = useState(false);
  const [linkKey, setLinkKey] = useState("");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [googleSheetsLinks, setGoogleSheetsLinks] = useState("");
  const [googleSheetsError, setGoogleSheetsError] = useState<string | null>(null);
  const [connectResult, setConnectResult] = useState<ConnectToolAppResult | null>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [access, setAccess] = useState<"all" | "specific">("all");
  const [agentIds, setAgentIds] = useState<Set<string>>(new Set());
  const [installMode, setInstallMode] = useState<InstallMode>("none");
  const [installAgentIds, setInstallAgentIds] = useState<Set<string>>(new Set());
  const [oauthPhase, setOAuthPhase] = useState<OAuthConnectPhase>("entry");
  const [oauthError, setOAuthError] = useState<string | null>(null);
  const directOAuthStartedRef = useRef(false);
  const directOAuthRetryingRef = useRef(false);

  const openGallery = () => {
    setEntry(null);
    setGalleryName("");
    setLinkUrl("");
    setLinkName("");
    setLinkNeedsKey(false);
    setLinkKey("");
    setCredentials({});
    setGoogleSheetsLinks("");
    setGoogleSheetsError(null);
    setConnectResult(null);
    setInstallMode("none");
    setInstallAgentIds(new Set());
    setStep("gallery");
    navigate("/apps/connect?byo=1");
  };

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Apps", href: "/apps" },
      { label: t("appsConnect.header.breadcrumbConnectApp") },
    ]);
    return () => setBreadcrumbs([]);
  }, [setBreadcrumbs, selectedCompany?.name, t]);

  const galleryQuery = useQuery({
    queryKey: queryKeys.apps.gallery(selectedCompanyId ?? "__none__"),
    queryFn: () => toolsApi.listGallery(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const applicationsQuery = useQuery({
    queryKey: queryKeys.tools.applications(selectedCompanyId ?? "__none__"),
    queryFn: () => toolsApi.listApplications(selectedCompanyId!),
    enabled: !!selectedCompanyId && !!directOAuthSource,
    refetchOnMount: "always",
  });
  const connectionsQuery = useQuery({
    queryKey: queryKeys.tools.connections(selectedCompanyId ?? "__none__"),
    queryFn: () => toolsApi.listConnections(selectedCompanyId!),
    enabled: !!selectedCompanyId && !!directOAuthSource,
    refetchOnMount: "always",
  });
  const existingOAuthConnection = useMemo(
    () => reusableOAuthConnection(
      directOAuthSource,
      applicationsQuery.data?.applications ?? [],
      connectionsQuery.data?.connections ?? [],
      createNewConnection
        ? { applicationId: prefill.applicationId, draftOnly: true }
        : {},
    ),
    [applicationsQuery.data, connectionsQuery.data, createNewConnection, directOAuthSource, prefill.applicationId],
  );

  const directOAuthEntry = entry &&
    getAvailableConnectionMethod(entry)?.auth === "oauth" &&
    isMcpDirectOAuthConnectSlug(entry.slug)
    ? entry
    : null;

  const setAppStep = (nextStep: Step) => {
    setStep(nextStep);
    if (entry) navigate(appConnectHref(entry.slug, nextStep));
  };

  const oauthStartMutation = useMutation({
    mutationFn: (connectionId: string) => toolsApi.startOAuth(connectionId),
    onSuccess: ({ authorizationUrl }) => {
      setOAuthPhase("redirecting");
      navigateTopLevel(authorizationUrl);
    },
    onError: (error) => {
      const details = error instanceof ApiError && error.body && typeof error.body === "object"
        ? (error.body as { details?: { code?: unknown } }).details
        : null;
      setOAuthPhase("error");
      setOAuthError(
        details?.code === "invalid_grant"
          ? t("appsConnect.errors.expiredAuth")
          : error instanceof Error
            ? error.message
            : t("appsConnect.errors.signInFailed"),
      );
    },
  });
  const startOAuth = oauthStartMutation.mutate;

  const connectMutation = useMutation({
    mutationFn: (entryOverride?: AppDefinition) => {
      const connectEntry = entryOverride ?? entry;
      if (connectEntry) {
        const sheetIds = isGoogleSheetsEntry(connectEntry) ? parseGoogleSheetIds(googleSheetsLinks).ids : [];
        const trimmedGalleryName = galleryName.trim();
        return toolsApi.connectApp(selectedCompanyId!, {
          galleryKey: connectEntry.slug,
          name: trimmedGalleryName || connectEntry.name,
          credentialValues: credentials,
          configValues: isGoogleSheetsEntry(connectEntry) ? { allowedSpreadsheetIds: sheetIds } : undefined,
          applicationId: prefill.applicationId,
        });
      }
      const trimmedKey = linkNeedsKey ? linkKey.trim() : "";
      const trimmedName = linkName.trim();
      return toolsApi.connectApp(selectedCompanyId!, {
        link: linkUrl,
        name: trimmedName || undefined,
        credentialValues: trimmedKey ? { [LINK_CREDENTIAL_CONFIG_PATH]: trimmedKey } : undefined,
        applicationId: prefill.applicationId,
      });
    },
    onSuccess: (result) => {
      if (result.auth?.kind === "oauth") {
        setConnectResult(result);
        const startUrl = result.auth.startUrl?.trim();
        if (!startUrl) {
          setOAuthPhase("starting");
          startOAuth(result.connectionId);
          return;
        }
        setOAuthPhase("redirecting");
        navigateTopLevel(startUrl);
        return;
      }
      setConnectResult(result);
      const defaults: Record<string, boolean> = {};
      for (const a of result.actions.readOnly) defaults[a.catalogEntryId] = true;
      for (const a of result.actions.canMakeChanges) defaults[a.catalogEntryId] = false;
      setEnabled(defaults);
      setInstallMode("none");
      setInstallAgentIds(new Set());
      setAppStep("actions");
    },
    onError: (error) => {
      const details = error instanceof ApiError && error.body && typeof error.body === "object"
        ? (error.body as { details?: { code?: unknown } }).details
        : null;
      if (isMcpDirectOAuthConnectSlug(requestedAppKey)) {
        setOAuthPhase("error");
        setOAuthError(
          details?.code === "invalid_grant"
            ? t("appsConnect.errors.expiredAuth")
            : error instanceof Error
              ? error.message
              : t("appsConnect.errors.signInFailed"),
        );
        return;
      }
      const oauthRequired = details?.code === "oauth_challenge";
      pushToast({
        title: oauthRequired ? t("appsConnect.toast.signInRequired") : t("appsConnect.toast.couldntConnect"),
        body: oauthRequired
          ? t("appsConnect.toast.signInComingSoon")
          : error instanceof Error
            ? error.message
            : t("appsConnect.toast.pleaseCheckKey"),
        tone: "error",
      });
    },
  });
  const connectApp = connectMutation.mutate;

  useEffect(() => {
    if (!requestedAppKey || galleryQuery.isLoading || !galleryQuery.data) return;

    const requestedEntry = galleryQuery.data.apps.find((candidate) => candidate.slug === requestedAppKey);
    const method = requestedEntry ? getAvailableConnectionMethod(requestedEntry) : null;
    const directOAuth = method?.auth === "oauth" && isMcpDirectOAuthConnectSlug(requestedEntry?.slug);
    const unsupportedOAuth = method?.auth === "oauth" && !directOAuth;
    if (!requestedEntry || unsupportedOAuth || requestedEntry.availability?.available === false) {
      setEntry(null);
      setStep("gallery");
      navigate("/apps/connect", { replace: true });
      return;
    }

    if (entry?.slug !== requestedEntry.slug) {
      setEntry(requestedEntry);
      setGalleryName(requestedEntry.name);
      setLinkUrl("");
      setLinkName("");
      setLinkNeedsKey(false);
      setLinkKey("");
      setCredentials({});
      setGoogleSheetsLinks("");
      setGoogleSheetsError(null);
      setConnectResult(null);
    }
    setInstallMode("none");
    setInstallAgentIds(new Set());
    setStep("key");

    if (directOAuth && (
      !applicationsQuery.isFetchedAfterMount ||
      !connectionsQuery.isFetchedAfterMount
    )) return;
    if (directOAuth && directOAuthRetryingRef.current) return;
    if (directOAuth && (applicationsQuery.isError || connectionsQuery.isError)) {
      setOAuthPhase("error");
      setOAuthError(t("appsConnect.errors.checkConnectionFailed"));
      return;
    }

    if (directOAuth && !directOAuthStartedRef.current) {
      directOAuthStartedRef.current = true;
      setOAuthError(null);
      setOAuthPhase("starting");
      if (existingOAuthConnection) {
        startOAuth(existingOAuthConnection.id);
      } else {
        connectApp(requestedEntry);
      }
    }
  }, [
    applicationsQuery.isError,
    applicationsQuery.isFetchedAfterMount,
    connectApp,
    connectionsQuery.isError,
    connectionsQuery.isFetchedAfterMount,
    entry?.slug,
    existingOAuthConnection,
    galleryQuery.data,
    galleryQuery.isLoading,
    navigate,
    requestedAppKey,
    startOAuth,
  ]);

  const finishMutation = useMutation({
    mutationFn: async () => {
      const askFirstLevels = connectResult ? askFirstLevelsFrom(connectResult) : [];
      const changeActions = connectResult?.actions.canMakeChanges ?? [];
      const enabledIds = Object.entries(enabled)
        .filter(([, on]) => on)
        .map(([id]) => id);
      const askFirstIds = changeActions
        .filter((a) => enabled[a.catalogEntryId] && askFirstLevels.includes(a.riskLevel))
        .map((a) => a.catalogEntryId);
      const selection: AppAccessSelection =
        access === "all" ? "all_agents" : { agentIds: Array.from(agentIds) };
      const result = await toolsApi.finishApp(selectedCompanyId!, connectResult!.connectionId, {
        enabledCatalogEntryIds: enabledIds,
        askFirstCatalogEntryIds: askFirstIds,
        access: selection,
      });
      const installState = installMode === "all"
        ? { onAll: true, agentIds: new Set<string>() }
        : { onAll: false, agentIds: installMode === "specific" ? installAgentIds : new Set<string>() };
      await toolsApi.putConnectionInstalls(
        connectResult!.connectionId,
        installPayload(selectedCompanyId!, installState),
      );
      return result;
    },
    onSuccess: () => setAppStep("success"),
    onError: (error) => {
      pushToast({
        title: t("appsConnect.toast.couldntFinishSetup"),
        body: error instanceof Error ? error.message : t("appsConnect.toast.pleaseTryAgain"),
        tone: "error",
      });
    },
  });

  if (!selectedCompanyId) {
    return <div className="p-6 text-sm text-muted-foreground">{t("appsConnect.selectCompany")}</div>;
  }

  if (directOAuthEntry && step === "key") {
    return (
      <OAuthConnectStateScreen
        entry={directOAuthEntry}
        phase={oauthPhase}
        error={oauthError}
        onRetry={async () => {
          setOAuthError(null);
          setOAuthPhase("starting");
          const connectionId = connectResult?.connectionId ?? existingOAuthConnection?.id;
          if (connectionId) {
            startOAuth(connectionId);
            return;
          }

          // The create request may have reached the server even when its
          // response did not reach the browser. Re-read both resources before
          // creating again so Retry resumes that durable draft instead of
          // duplicating it.
          directOAuthRetryingRef.current = true;
          try {
            const [applicationsResult, connectionsResult] = await Promise.all([
              applicationsQuery.refetch(),
              connectionsQuery.refetch(),
            ]);
            if (applicationsResult.isError || connectionsResult.isError) {
              setOAuthPhase("error");
              setOAuthError(t("appsConnect.errors.checkConnectionFailed"));
              return;
            }
            const refreshedConnection = reusableOAuthConnection(
              directOAuthSource,
              applicationsResult.data?.applications ?? [],
              connectionsResult.data?.connections ?? [],
              createNewConnection
                ? { applicationId: prefill.applicationId, draftOnly: true }
                : {},
            );
            if (refreshedConnection) {
              startOAuth(refreshedConnection.id);
            } else {
              connectMutation.mutate(directOAuthEntry);
            }
          } finally {
            directOAuthRetryingRef.current = false;
          }
        }}
        onCancel={() => navigate("/apps/browse")}
      />
    );
  }

  const appName =
    connectResult?.application.name ??
    entry?.name ??
    (linkName.trim() || defaultLinkName(linkUrl) || t("appsConnect.defaultAppName"));
  const zapierEntry = zapierSource
    ? galleryQuery.data?.apps.find((app) => app.slug === "zapier") ?? null
    : null;
  const stepLabels = zapierSource
    ? ZAPIER_STEP_LABELS(t)
    : isGoogleSheetsEntry(entry)
      ? GOOGLE_SHEETS_STEP_LABELS(t)
      : STEP_LABELS(t);
  const stepIndex = zapierSource && step !== "gallery" && step !== "success"
    ? ZAPIER_STEP_INDEX[step]
    : step === "success"
      ? stepLabels.length
      : STEP_INDEX[step];

  return (
    <div className="max-w-5xl">
      {step !== "success" && (
        <StepHeader
          subtitle={
            step === "gallery"
              ? t("appsConnect.header.subtitleGallery")
              : t("appsConnect.header.subtitleStep", { current: stepIndex + 1, total: stepLabels.length })
          }
          step={step}
          activeIndex={stepIndex}
          labels={stepLabels}
          appIdentity={
            zapierSource
              ? { name: t("appsConnect.zapierName"), logoUrl: zapierEntry?.branding.logoUrl ?? null }
              : undefined
          }
          onCancel={() => navigate("/apps")}
        />
      )}

      {step === "gallery" && (
        <GalleryStep
          loading={galleryQuery.isLoading}
          apps={galleryQuery.data?.apps ?? []}
          byo={searchParams.get("byo") === "1"}
          source={searchParams.get("source")}
          onPick={(picked) => {
            if (
              getAvailableConnectionMethod(picked)?.auth === "oauth" &&
              isMcpDirectOAuthConnectSlug(picked.slug)
            ) {
              navigate(appSourceConnectHref(picked.slug));
              return;
            }
            setEntry(picked);
            setGalleryName(picked.name);
            setLinkUrl("");
            setLinkName("");
            setLinkNeedsKey(false);
            setLinkKey("");
            setCredentials({});
            setGoogleSheetsLinks("");
            setGoogleSheetsError(null);
            setConnectResult(null);
            setInstallMode("none");
            setInstallAgentIds(new Set());
            setStep("key");
            navigate(appConnectHref(picked.slug, "key"));
          }}
          onUseLink={(url) => {
            const matchedEntry = getAppDefinitionForUrl(url, galleryQuery.data?.apps ?? []);
            setEntry(null);
            setGalleryName("");
            setLinkUrl(url);
            setLinkName(matchedEntry?.name ?? defaultLinkName(url) ?? "");
            setLinkNeedsKey(false);
            setLinkKey("");
            setCredentials({});
            setGoogleSheetsLinks("");
            setGoogleSheetsError(null);
            setInstallMode("none");
            setInstallAgentIds(new Set());
            setStep("key");
          }}
          onRunYourOwn={() => navigate(advancedTabHref("run-your-own"))}
          onPasteConfig={() => navigate(advancedTabHref("paste-config"))}
        />
      )}

      {step === "key" && entry && (
        <KeyStep
          entry={entry}
          name={galleryName}
          onNameChange={setGalleryName}
          values={credentials}
          onChange={setCredentials}
          googleSheetsLinks={googleSheetsLinks}
          googleSheetsError={googleSheetsError}
          onGoogleSheetsLinksChange={(next) => {
            setGoogleSheetsLinks(next);
            setGoogleSheetsError(null);
          }}
          submitting={connectMutation.isPending}
          onBack={openGallery}
          onConnect={() => {
            if (isGoogleSheetsEntry(entry)) {
              const parsed = parseGoogleSheetIds(googleSheetsLinks);
              if (parsed.invalidCount > 0) {
                setGoogleSheetsError(t("appsConnect.errors.invalidSheetLink"));
                return;
              }
              if (parsed.ids.length === 0) {
                setGoogleSheetsError(t("appsConnect.errors.pasteAtLeastOneSheet"));
                return;
              }
            }
            connectMutation.mutate(undefined);
          }}
        />
      )}

      {step === "key" && !entry && linkUrl && !zapierSource && (
        <LinkConnectStep
          link={linkUrl}
          name={linkName}
          onNameChange={setLinkName}
          needsKey={linkNeedsKey}
          onNeedsKeyChange={(next) => {
            setLinkNeedsKey(next);
            if (!next) setLinkKey("");
          }}
          keyValue={linkKey}
          onKeyChange={setLinkKey}
          submitting={connectMutation.isPending}
          onBack={() => setStep("gallery")}
          onConnect={() => connectMutation.mutate(undefined)}
        />
      )}

      {step === "key" && !entry && zapierSource && (
        <ZapierConnectStep
          link={linkUrl}
          onLinkChange={setLinkUrl}
          submitting={connectMutation.isPending}
          onBack={() => navigate("/apps")}
          onConnect={() => connectMutation.mutate(undefined)}
        />
      )}

      {step === "actions" && connectResult && (
        <ActionsStep
          appName={appName}
          result={connectResult}
          enabled={enabled}
          onToggle={(id, on) => setEnabled((prev) => ({ ...prev, [id]: on }))}
          onBulk={(ids, on) =>
            setEnabled((prev) => {
              const next = { ...prev };
              for (const id of ids) next[id] = on;
              return next;
            })
          }
          onBack={() => setAppStep("key")}
          onContinue={() => setAppStep("who")}
        />
      )}

      {step === "who" && connectResult && (
        <WhoStep
          appName={appName}
          companyId={selectedCompanyId}
          access={access}
          setAccess={setAccess}
          agentIds={agentIds}
          setAgentIds={setAgentIds}
          onBack={() => setAppStep("actions")}
          onContinue={() => setAppStep("install")}
        />
      )}

      {step === "install" && connectResult && (
        <InstallStep
          appName={appName}
          companyId={selectedCompanyId}
          access={access}
          accessAgentIds={agentIds}
          installMode={installMode}
          setInstallMode={setInstallMode}
          installAgentIds={installAgentIds}
          setInstallAgentIds={setInstallAgentIds}
          submitting={finishMutation.isPending}
          onBack={() => setAppStep("who")}
          onFinish={() => finishMutation.mutate()}
        />
      )}

      {step === "success" && (
        <SuccessStep
          appName={appName}
          logoUrl={entry?.branding.logoUrl}
          enabledCount={Object.values(enabled).filter(Boolean).length}
          access={access}
          installMode={installMode}
          installCount={installAgentIds.size}
          onDone={() => navigate("/apps/connections")}
        />
      )}
    </div>
  );
}

function StepHeader({
  subtitle,
  step,
  activeIndex,
  labels,
  appIdentity,
  onCancel,
}: {
  subtitle: string;
  step: Step;
  activeIndex: number;
  labels: string[];
  appIdentity?: { name: string; logoUrl: string | null };
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {appIdentity ? (
            <AppLogo name={appIdentity.name} logoUrl={appIdentity.logoUrl} size={44} />
          ) : null}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {appIdentity ? t("appsConnect.header.titleApp", { name: appIdentity.name }) : t("appsConnect.header.titleAnApp")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("appsConnect.header.cancel")}
        </Button>
      </div>
      {step !== "gallery" && (
        <div className="mt-4">
          <div className="flex gap-2">
            {labels.map((label, i) => (
              <div
                key={label}
                className={cn("h-1 w-20 rounded-full", i <= activeIndex ? "bg-foreground" : "bg-border")}
              />
            ))}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">{labels.join("   ·   ")}</div>
        </div>
      )}
    </div>
  );
}

export function OAuthConnectStateScreen({
  entry,
  phase,
  error,
  onRetry,
  onCancel,
}: {
  entry: AppDefinition;
  phase: OAuthConnectPhase;
  error?: string | null;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const status = phase === "entry"
    ? {
        title: t("appsConnect.oauthScreen.titleConnect", { name: entry.name }),
        body: t("appsConnect.oauthScreen.bodyConnect", { name: entry.name }),
      }
    : phase === "starting"
      ? {
          title: t("appsConnect.oauthScreen.titlePreparing"),
          body: t("appsConnect.oauthScreen.bodyPreparing", { name: entry.name }),
        }
      : phase === "redirecting"
        ? {
            title: t("appsConnect.oauthScreen.titleOpening", { name: entry.name }),
            body: t("appsConnect.oauthScreen.bodyOpening", { name: entry.name }),
          }
        : {
            title: t("appsConnect.oauthScreen.titleError", { name: entry.name }),
            body: error ?? t("appsConnect.oauthScreen.bodyErrorFallback"),
          };

  return (
    <div className="max-w-5xl">
      <StepHeader
        subtitle={t("appsConnect.oauthScreen.subtitle")}
        step="key"
        activeIndex={0}
        labels={[
          t("appsConnect.oauthScreen.labelConnect"),
          t("appsConnect.oauthScreen.labelReviewActions"),
          t("appsConnect.oauthScreen.labelChooseAccess"),
          t("appsConnect.oauthScreen.labelInstallTools"),
        ]}
        appIdentity={{ name: entry.name, logoUrl: entry.branding.logoUrl }}
        onCancel={onCancel}
      />
      <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-8">
        <div className="flex items-start gap-3">
          <span className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
            {phase === "error" ? (
              <Link2 className="h-5 w-5 text-destructive" />
            ) : phase === "entry" ? (
              <Lock className="h-5 w-5 text-muted-foreground" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            )}
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight">{status.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{status.body}</p>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2">
          {phase === "error" ? (
            <Button type="button" onClick={onRetry}>{t("appsConnect.oauthScreen.buttonTryAgain")}</Button>
          ) : (
            <Button type="button" disabled>
              {phase === "redirecting" ? t("appsConnect.oauthScreen.buttonOpening", { name: entry.name }) : t("appsConnect.oauthScreen.buttonPreparing")}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onCancel}>{t("appsConnect.oauthScreen.buttonBackToApps")}</Button>
        </div>
        <p className="mt-5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          {t("appsConnect.oauthScreen.footerNote")}
        </p>
      </div>
    </div>
  );
}

function ZapierConnectStep({
  link,
  onLinkChange,
  submitting,
  onBack,
  onConnect,
}: {
  link: string;
  onLinkChange: (next: string) => void;
  submitting: boolean;
  onBack: () => void;
  onConnect: () => void;
}) {
  const { t } = useTranslation();
  const normalizedLink = normalizeAppLink(link);
  const zapierHostname = normalizedLink ? new URL(normalizedLink).hostname : "";
  const isZapierLink = zapierHostname === "zapier.com" || zapierHostname.endsWith(".zapier.com");

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-8">
      <div className="flex items-start gap-3">
        <span className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
          <Link2 className="h-5 w-5 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight">{t("appsConnect.zapier.heading")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("appsConnect.zapier.description")}
          </p>
        </div>
      </div>

      <div className="mt-8">
        <label className="text-sm font-medium text-foreground">{t("appsConnect.zapier.label")}</label>
        <Input
          value={link}
          onChange={(event) => onLinkChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && isZapierLink && !submitting) onConnect();
          }}
          placeholder={t("appsConnect.zapier.placeholder")}
          className="mt-2 h-11"
          autoFocus
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {t("appsConnect.zapier.helpText")}
        </p>
        {link.trim() && !isZapierLink && (
          <p className="mt-2 text-xs text-destructive">{t("appsConnect.zapier.invalidUrl")}</p>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} disabled={submitting}>
          {t("appsConnect.zapier.back")}
        </Button>
        <Button onClick={onConnect} disabled={submitting || !isZapierLink}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitting ? t("appsConnect.zapier.checking") : t("appsConnect.zapier.checkLink")}
        </Button>
      </div>
    </div>
  );
}

function GalleryStep({
  loading,
  apps,
  byo = false,
  source = null,
  onPick,
  onUseLink,
  onRunYourOwn,
  onPasteConfig,
}: {
  loading: boolean;
  apps: AppDefinition[];
  /** Entered via the "Connect your own MCP server" card (PAP-12371, Finding C): focus the link path. */
  byo?: boolean;
  source?: string | null;
  onPick: (entry: AppDefinition) => void;
  onUseLink: (link: string) => void;
  onRunYourOwn: () => void;
  onPasteConfig: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkSectionRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  // Arriving from the BYO card: scroll the "Connect with a link" section into
  // view and focus its input so the paste-URL path is the obvious next step.
  useEffect(() => {
    if (!byo || loading) return;
    linkSectionRef.current?.scrollIntoView({ block: "center" });
    linkInputRef.current?.focus();
  }, [byo, loading]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((a) => a.name.toLowerCase().includes(q));
  }, [apps, search]);
  const normalizedLink = normalizeAppLink(linkInput);
  const matchedEntry = normalizedLink ? getAppDefinitionForUrl(normalizedLink, apps) : null;
  const zapierSource = source === "zapier";

  const continueWithLink = () => {
    const next = normalizeAppLink(linkInput);
    if (!next) {
      setLinkError(t("appsConnect.gallery.invalidLink"));
      return;
    }
    setLinkError(null);
    onUseLink(next);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("appsConnect.gallery.searchPlaceholder")}
          className="h-11 pl-9"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {filtered.map((app) => {
          const copy = appCopyFor(app.slug, app.description);
          const oauth = getAvailableConnectionMethod(app)?.auth === "oauth";
          const oauthBlocked = oauth && !isMcpDirectOAuthConnectSlug(app.slug);
          const unavailable = app.availability?.available === false;
          return (
            <button
              key={app.slug}
              type="button"
              disabled={oauthBlocked || unavailable}
              title={
                unavailable
                  ? t("appsConnect.gallery.unavailableTooltip", { name: app.name })
                  : undefined
              }
              onClick={() => onPick(app)}
              className={cn(
                "flex flex-col rounded-xl border border-border bg-card p-4 text-left transition-colors",
                oauthBlocked || unavailable ? "cursor-not-allowed opacity-60" : "hover:border-foreground/30 hover:bg-accent/40",
              )}
            >
              <AppLogo name={app.name} logoUrl={app.branding.logoUrl} size={36} />
              <div className="mt-3 text-sm font-bold text-foreground">{app.name}</div>
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{copy.tagline}</div>
              <div className="mt-3 text-xs font-semibold text-foreground">
                {unavailable ? (
                  <span className="text-muted-foreground">{t("appsConnect.gallery.notAvailableLabel")}</span>
                ) : oauthBlocked ? (
                  <span className="text-muted-foreground">{t("appsConnect.gallery.signInComingSoon")}</span>
                ) : (
                  <span>{t("appsConnect.gallery.connectLabel")}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="py-10 text-center text-sm text-muted-foreground">{t("appsConnect.gallery.noMatch", { search })}</div>
      )}

      <div
        ref={linkSectionRef}
        className={cn(
          "grid gap-4 border-t border-border pt-5 md:grid-cols-(--gtc-13)",
          byo && "-mx-3 rounded-xl border border-primary/40 bg-primary/[0.04] px-3 pb-4 md:mx-0",
        )}
      >
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            {zapierSource ? t("appsConnect.gallery.linkSectionZapier") : byo ? t("appsConnect.gallery.linkSectionByo") : t("appsConnect.gallery.linkSectionNormal")}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {zapierSource
              ? t("appsConnect.gallery.linkDescZapier")
              : byo
              ? t("appsConnect.gallery.linkDescByo")
              : t("appsConnect.gallery.linkDescNormal")}
          </p>
          {!zapierSource && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("appsConnect.gallery.linkNoteLocal", { url: "http://127.0.0.1:8848/mcp" })}{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">http://127.0.0.1:8848/mcp</code>.
            </p>
          )}
          {matchedEntry && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <AppLogo name={matchedEntry.name} logoUrl={matchedEntry.branding.logoUrl} size={24} />
                <span className="truncate">{t("appsConnect.gallery.matchedEntry", { name: matchedEntry.name })}</span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={matchedEntry.availability?.available === false}
                onClick={() => {
                  setLinkError(null);
                  if (matchedEntry.slug === "zapier") {
                    continueWithLink();
                    return;
                  }
                  onPick(matchedEntry);
                }}
              >
                {matchedEntry.availability?.available === false
                  ? t("appsConnect.gallery.notAvailable")
                  : matchedEntry.slug === "zapier"
                    ? t("appsConnect.gallery.continue")
                    : t("appsConnect.gallery.useApp", { name: matchedEntry.name })}
              </Button>
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:min-w-(--sz-360px)">
          <div className="flex gap-2">
            <Input
              ref={linkInputRef}
              value={linkInput}
              onChange={(e) => {
                setLinkInput(e.target.value);
                setLinkError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") continueWithLink();
              }}
              placeholder={zapierSource ? t("appsConnect.gallery.placeholderZapier") : t("appsConnect.gallery.placeholderNormal")}
              className="h-10"
            />
            <Button type="button" variant="outline" onClick={continueWithLink}>
              {t("appsConnect.gallery.continue")}
            </Button>
          </div>
          {linkError && <div className="text-xs text-destructive">{linkError}</div>}
        </div>
      </div>

      <div className="border-t border-border pt-5">
        <div className="text-sm font-semibold text-foreground">{t("appsConnect.gallery.moreWays")}</div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("appsConnect.gallery.moreWaysDesc")}
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <ConnectMethodRow
            icon={TerminalSquare}
            title={t("appsConnect.gallery.runYourOwn")}
            description={t("appsConnect.gallery.runYourOwnDesc")}
            onClick={onRunYourOwn}
          />
          <ConnectMethodRow
            icon={ClipboardPaste}
            title={t("appsConnect.gallery.pasteConfig")}
            description={t("appsConnect.gallery.pasteConfigDesc")}
            onClick={onPasteConfig}
          />
        </div>
      </div>
    </div>
  );
}

function ConnectMethodRow({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:border-foreground/30 hover:bg-accent/40"
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{description}</div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function normalizeAppLink(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function defaultLinkName(link: string): string | null {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function LinkConnectStep({
  link,
  name,
  onNameChange,
  needsKey,
  onNeedsKeyChange,
  keyValue,
  onKeyChange,
  submitting,
  onBack,
  onConnect,
}: {
  link: string;
  name: string;
  onNameChange: (next: string) => void;
  needsKey: boolean;
  onNeedsKeyChange: (next: boolean) => void;
  keyValue: string;
  onKeyChange: (next: string) => void;
  submitting: boolean;
  onBack: () => void;
  onConnect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-8">
      <div className="flex items-start gap-3">
        <span className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
          <Link2 className="h-5 w-5 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight">{t("appsConnect.linkConnect.heading")}</h2>
          <p className="mt-1 truncate text-sm text-muted-foreground">{link}</p>
        </div>
      </div>

      <div className="mt-8 space-y-6">
        <div>
          <label className="text-sm font-medium text-foreground">{t("appsConnect.linkConnect.nameLabel")}</label>
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t("appsConnect.linkConnect.namePlaceholder")}
            className="mt-2 h-11"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("appsConnect.linkConnect.nameDesc")}
          </p>
        </div>

        <div>
          <label className="text-sm font-medium text-foreground">{t("appsConnect.linkConnect.needsKeyLabel")}</label>
          <div className="mt-2 inline-flex rounded-lg border border-border bg-muted/50 p-1">
            <SegmentedOption
              label={t("appsConnect.linkConnect.segmentedNo")}
              selected={!needsKey}
              onClick={() => onNeedsKeyChange(false)}
            />
            <SegmentedOption
              label={t("appsConnect.linkConnect.segmentedYes")}
              selected={needsKey}
              onClick={() => onNeedsKeyChange(true)}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {needsKey
              ? t("appsConnect.linkConnect.needsKeyDesc")
              : t("appsConnect.linkConnect.noKeyDesc")}
          </p>
        </div>

        {needsKey && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">{t("appsConnect.linkConnect.appKeyLabel")}</label>
              <Input
                type="password"
                autoComplete="off"
                value={keyValue}
                onChange={(e) => onKeyChange(e.target.value)}
                placeholder={t("appsConnect.linkConnect.keyPlaceholder")}
                className="mt-2 h-11 font-mono"
              />
            </div>

            <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-4">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium text-foreground">{t("appsConnect.linkConnect.keyStoredTitle")}</div>
                <div className="text-xs text-muted-foreground">
                  {t("appsConnect.linkConnect.keyStoredBody")}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} disabled={submitting}>
          {t("appsConnect.linkConnect.back")}
        </Button>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t("appsConnect.linkConnect.checkNote")}
          </span>
          <Button onClick={onConnect} disabled={submitting || (needsKey && keyValue.trim().length === 0)}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitting ? t("appsConnect.linkConnect.checking") : t("appsConnect.linkConnect.checkLink")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SegmentedOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "min-w-(--sz-64px) rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
        selected
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function ConnectionNameField({
  name,
  onNameChange,
}: {
  name: string;
  onNameChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <label className="text-sm font-medium text-foreground">{t("appsConnect.connectionName.label")}</label>
      <Input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={t("appsConnect.connectionName.placeholder")}
        className="mt-2 h-11"
      />
      <p className="mt-2 text-xs text-muted-foreground">
        {t("appsConnect.connectionName.description")}
      </p>
    </div>
  );
}

function KeyStep({
  entry,
  name,
  onNameChange,
  values,
  onChange,
  googleSheetsLinks,
  googleSheetsError,
  onGoogleSheetsLinksChange,
  submitting,
  onBack,
  onConnect,
}: {
  entry: AppDefinition;
  name: string;
  onNameChange: (next: string) => void;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  googleSheetsLinks: string;
  googleSheetsError: string | null;
  onGoogleSheetsLinksChange: (next: string) => void;
  submitting: boolean;
  onBack: () => void;
  onConnect: () => void;
}) {
  const { t } = useTranslation();
  const copy = appCopyFor(entry.slug, entry.description);
  const method = getAvailableConnectionMethod(entry);
  const fields = (method?.credentialFields ?? []).map((field) => ({
    ...field,
    configPath: credentialConfigPath(field),
    helpUrl: method?.consoleLinks?.keys ?? method?.consoleLinks?.docs ?? "",
  }));
  const allFilled = fields.every(
    (f) => f.required === false || (values[f.configPath]?.trim().length ?? 0) > 0,
  );
  const robotEmail = entry.availability?.robotEmail ?? null;
  const unavailable = entry.availability?.available === false;

  if (isGoogleSheetsEntry(entry)) {
    const parsed = parseGoogleSheetIds(googleSheetsLinks);
    const canConnect = !unavailable && Boolean(robotEmail) && googleSheetsLinks.trim().length > 0;
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-8">
        <div className="flex items-center gap-3">
          <AppLogo name={entry.name} logoUrl={entry.branding.logoUrl} size={48} />
          <div>
            <h2 className="text-lg font-bold tracking-tight sm:text-xl">{t("appsConnect.keyStep.headingGoogleSheets")}</h2>
            <p className="text-sm text-muted-foreground">{copy.short}</p>
          </div>
        </div>

        <div className="mt-8 space-y-6">
          <ConnectionNameField name={name} onNameChange={onNameChange} />

          {robotEmail ? (
            <div>
              <label className="text-sm font-medium text-foreground">{t("appsConnect.keyStep.shareSheetLabel")}</label>
              <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row">
                <div
                  title={robotEmail}
                  className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-muted/40 px-3 py-2.5 font-mono text-xs leading-tight text-foreground break-all"
                >
                  {robotEmail}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => void copyTextToClipboard(robotEmail).catch(() => {})}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  {t("appsConnect.keyStep.copy")}
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("appsConnect.keyStep.shareSheetDesc")}
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
              {t("appsConnect.keyStep.googleSheetsUnavailable")}
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-foreground">{t("appsConnect.keyStep.pasteLinksLabel")}</label>
            <Textarea
              value={googleSheetsLinks}
              onChange={(e) => onGoogleSheetsLinksChange(e.target.value)}
              placeholder={t("appsConnect.keyStep.pasteLinksPlaceholder")}
              className="mt-2 min-h-28"
            />
            <div className="mt-2 text-xs text-muted-foreground">
              {parsed.ids.length > 0
                ? parsed.ids.length === 1
                  ? t("appsConnect.keyStep.sheetsReadyOne", { count: parsed.ids.length })
                  : t("appsConnect.keyStep.sheetsReadyMany", { count: parsed.ids.length })
                : t("appsConnect.keyStep.pasteLinksHint")}
            </div>
            {googleSheetsError && <div className="mt-2 text-xs text-destructive">{googleSheetsError}</div>}
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between">
          <Button variant="ghost" onClick={onBack} disabled={submitting}>
            {t("appsConnect.keyStep.back")}
          </Button>
          <Button onClick={onConnect} disabled={submitting || !canConnect}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitting ? t("appsConnect.keyStep.checking") : t("appsConnect.keyStep.connect")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-8">
      <div className="flex items-center gap-3">
        <AppLogo name={entry.name} logoUrl={entry.branding.logoUrl} size={48} />
        <div>
          <h2 className="text-xl font-bold tracking-tight">{t("appsConnect.keyStep.headingGeneric", { name: entry.name })}</h2>
          <p className="text-sm text-muted-foreground">{copy.short}</p>
        </div>
      </div>

      <div className="mt-8 space-y-6">
        <ConnectionNameField name={name} onNameChange={onNameChange} />

        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("appsConnect.keyStep.noKeyNeeded")}
          </p>
        ) : (
          fields.map((field) => (
            <div key={field.configPath}>
              <label className="text-sm font-medium text-foreground">
                {credentialFieldLabel(entry.name, field.label, fields.length)}
              </label>
              <Input
                type="password"
                autoComplete="off"
                value={values[field.configPath] ?? ""}
                onChange={(e) => onChange({ ...values, [field.configPath]: e.target.value })}
                placeholder={t("appsConnect.linkConnect.keyPlaceholder")}
                className="mt-2 h-11 font-mono"
              />
              {field.helpUrl && (
                <a
                  href={field.helpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-foreground underline underline-offset-2"
                >
                  {t("appsConnect.keyStep.findKeyLink")}
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
            </div>
          ))
        )}

        <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-4">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium text-foreground">{t("appsConnect.linkConnect.keyStoredTitle")}</div>
            <div className="text-xs text-muted-foreground">
              {t("appsConnect.linkConnect.keyStoredBody")}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} disabled={submitting}>
          {t("appsConnect.keyStep.back")}
        </Button>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t("appsConnect.keyStep.checkKeyNote")}
          </span>
          <Button onClick={onConnect} disabled={submitting || !allFilled}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitting ? t("appsConnect.keyStep.checking") : t("appsConnect.keyStep.connect")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ActionGroup({
  title,
  hint,
  actions,
  enabled,
  onToggle,
  bulkLabel,
  onBulk,
  askFirstLevels,
}: {
  title: string;
  hint: string;
  actions: ToolAppConnectionActionSummary[];
  enabled: Record<string, boolean>;
  onToggle: (id: string, on: boolean) => void;
  bulkLabel: string;
  onBulk: () => void;
  askFirstLevels: string[];
}) {
  const { t } = useTranslation();
  if (actions.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="text-sm">
          <span className="font-bold text-foreground">{title}</span>
          <span className="ml-2 text-muted-foreground">· {hint}</span>
        </div>
        <button
          type="button"
          onClick={onBulk}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {bulkLabel}
        </button>
      </div>
      <div className="divide-y divide-border">
        {actions.map((action) => {
          const on = enabled[action.catalogEntryId] ?? false;
          const showAskFirst = on && askFirstLevels.includes(action.riskLevel);
          return (
            <div key={action.catalogEntryId} className="flex items-center gap-4 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">
                  {action.title ?? action.toolName}
                </div>
                {action.description && (
                  <div className="truncate text-xs text-muted-foreground">{action.description}</div>
                )}
              </div>
              {showAskFirst && (
                <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  {t("appsConnect.askFirst")}
                </span>
              )}
              <ToggleSwitch checked={on} onCheckedChange={(next) => onToggle(action.catalogEntryId, next)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionsStep({
  appName,
  result,
  enabled,
  onToggle,
  onBulk,
  onBack,
  onContinue,
}: {
  appName: string;
  result: ConnectToolAppResult;
  enabled: Record<string, boolean>;
  onToggle: (id: string, on: boolean) => void;
  onBulk: (ids: string[], on: boolean) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const askFirstLevels = askFirstLevelsFrom(result);
  const { readOnly, canMakeChanges } = result.actions;
  const total = readOnly.length + canMakeChanges.length;
  const enabledCount = Object.values(enabled).filter(Boolean).length;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" />
        </span>
        <div>
          <div className="text-lg font-bold text-foreground">
            {total === 1
              ? t("appsConnect.actionsStep.headingOne", { name: appName, count: total })
              : t("appsConnect.actionsStep.headingMany", { name: appName, count: total })}
          </div>
          <div className="text-sm text-muted-foreground">
            {t("appsConnect.actionsStep.description")}
          </div>
        </div>
      </div>

      <ActionGroup
        title={t("appsConnect.actionsStep.readOnlyTitle")}
        hint={t("appsConnect.actionsStep.readOnlyHint")}
        actions={readOnly}
        enabled={enabled}
        onToggle={onToggle}
        bulkLabel={t("appsConnect.actionsStep.readOnlyBulk")}
        onBulk={() => onBulk(readOnly.map((a) => a.catalogEntryId), false)}
        askFirstLevels={askFirstLevels}
      />

      <ActionGroup
        title={t("appsConnect.actionsStep.canMakeChangesTitle")}
        hint={t("appsConnect.actionsStep.canMakeChangesHint")}
        actions={canMakeChanges}
        enabled={enabled}
        onToggle={onToggle}
        bulkLabel={t("appsConnect.actionsStep.canMakeChangesBulk")}
        onBulk={() => onBulk(canMakeChanges.map((a) => a.catalogEntryId), true)}
        askFirstLevels={askFirstLevels}
      />

      <div className="flex items-center justify-between pt-1">
        <Button variant="ghost" onClick={onBack}>
          {t("appsConnect.actionsStep.back")}
        </Button>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t("appsConnect.actionsStep.newActionsNote", { name: appName })}
          </span>
          <Button onClick={onContinue} disabled={enabledCount === 0}>
            {enabledCount === 1
              ? t("appsConnect.actionsStep.continueOne", { count: enabledCount })
              : t("appsConnect.actionsStep.continueMany", { count: enabledCount })}
          </Button>
        </div>
      </div>
    </div>
  );
}

function WhoStep({
  appName,
  companyId,
  access,
  setAccess,
  agentIds,
  setAgentIds,
  onBack,
  onContinue,
}: {
  appName: string;
  companyId: string;
  access: "all" | "specific";
  setAccess: (a: "all" | "specific") => void;
  agentIds: Set<string>;
  setAgentIds: (s: Set<string>) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: access === "specific",
  });
  const agents: Agent[] = (agentsQuery.data ?? []).filter((a) => a.status !== "terminated");
  const canFinish = access === "all" || agentIds.size > 0;

  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-2xl border border-border bg-card p-8">
        <h2 className="text-xl font-bold tracking-tight">{t("appsConnect.whoStep.heading", { name: appName })}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("appsConnect.whoStep.description")}</p>

        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={() => setAccess("all")}
            className={cn(
              "flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors",
              access === "all" ? "border-foreground bg-muted/40" : "border-border hover:border-foreground/30",
            )}
          >
            <Radio selected={access === "all"} />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">{t("appsConnect.whoStep.allAgentsLabel")}</span>
                <span className="rounded-full bg-foreground px-2 py-0.5 text-(length:--text-nano) font-bold text-background">
                  {t("appsConnect.whoStep.recommendedBadge")}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("appsConnect.whoStep.allAgentsDesc", { name: appName })}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setAccess("specific")}
            className={cn(
              "flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors",
              access === "specific" ? "border-foreground bg-muted/40" : "border-border hover:border-foreground/30",
            )}
          >
            <Radio selected={access === "specific"} />
            <div className="flex-1">
              <span className="font-semibold text-foreground">{t("appsConnect.whoStep.specificAgentsLabel")}</span>
              <p className="mt-1 text-xs text-muted-foreground">{t("appsConnect.whoStep.specificAgentsDesc", { name: appName })}</p>
            </div>
          </button>

          {access === "specific" && (
            <AgentMultiSelect
              agents={agents}
              selectedAgentIds={agentIds}
              onChange={setAgentIds}
              loading={agentsQuery.isLoading}
              showSelectionPreview={false}
            />
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          {t("appsConnect.whoStep.back")}
        </Button>
        <Button onClick={onContinue} disabled={!canFinish}>
          {t("appsConnect.whoStep.continueToInstall")}
        </Button>
      </div>
    </div>
  );
}

export function InstallStep({
  appName,
  companyId,
  access,
  accessAgentIds,
  installMode,
  setInstallMode,
  installAgentIds,
  setInstallAgentIds,
  submitting,
  onBack,
  onFinish,
}: {
  appName: string;
  companyId: string;
  access: "all" | "specific";
  accessAgentIds: Set<string>;
  installMode: InstallMode;
  setInstallMode: (mode: InstallMode) => void;
  installAgentIds: Set<string>;
  setInstallAgentIds: (ids: Set<string>) => void;
  submitting: boolean;
  onBack: () => void;
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
  });
  const agents: Agent[] = (agentsQuery.data ?? []).filter((a) => a.status !== "terminated");
  const installSpecific = () => {
    setInstallMode("specific");
    if (installAgentIds.size === 0 && access === "specific") setInstallAgentIds(new Set(accessAgentIds));
  };
  const extendingAgentIds = access === "all"
    ? []
    : installMode === "all"
      ? agents.filter((agent) => !accessAgentIds.has(agent.id)).map((agent) => agent.id)
      : [...installAgentIds].filter((id) => !accessAgentIds.has(id));
  const canFinish = installMode !== "specific" || installAgentIds.size > 0;
  const extendingLabel = extendingAgentIds.length === 1
    ? agents.find((agent) => agent.id === extendingAgentIds[0])?.name ?? "1 agent"
    : `${extendingAgentIds.length} agents`;

  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-2xl border border-border bg-card p-8">
        <h2 className="text-xl font-bold tracking-tight">{t("appsConnect.installStep.heading", { name: appName })}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("appsConnect.installStep.description")}
        </p>

        <div className="mt-5">
          <InlineBanner tone="info" compact>
            {t(TOOL_INSTALL_COPY.installInfoNotice, { appName })}
          </InlineBanner>
        </div>

        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={() => setInstallMode("none")}
            className={cn(
              "flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors",
              installMode === "none" ? "border-foreground bg-muted/40" : "border-border hover:border-foreground/30",
            )}
          >
            <Radio selected={installMode === "none"} />
            <div>
              <span className="font-semibold text-foreground">{t("appsConnect.installStep.notYetLabel")}</span>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("appsConnect.installStep.notYetDesc", { name: appName })}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={installSpecific}
            className={cn(
              "flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors",
              installMode === "specific" ? "border-foreground bg-muted/40" : "border-border hover:border-foreground/30",
            )}
          >
            <Radio selected={installMode === "specific"} />
            <div className="flex-1">
              <span className="font-semibold text-foreground">{t("appsConnect.installStep.specificAgentsLabel")}</span>
              <p className="mt-1 text-xs text-muted-foreground">{t("appsConnect.installStep.specificAgentsDesc", { name: appName })}</p>
            </div>
          </button>

          {installMode === "specific" ? (
            <div className="ml-7 border-l border-border pl-4">
              <AgentMultiSelect
                agents={agents}
                selectedAgentIds={installAgentIds}
                onChange={setInstallAgentIds}
                loading={agentsQuery.isLoading}
                showSelectionPreview={false}
              />
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setInstallMode("all")}
            className={cn(
              "flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors",
              installMode === "all" ? "border-foreground bg-muted/40" : "border-border hover:border-foreground/30",
            )}
          >
            <Radio selected={installMode === "all"} />
            <div>
              <span className="font-semibold text-foreground">{t("appsConnect.installStep.allAgentsLabel")}</span>
              <p className="mt-1 text-xs text-muted-foreground">{t(TOOL_INSTALL_COPY.installAllWarning)}</p>
            </div>
          </button>

          {extendingAgentIds.length > 0 ? (
            <InlineBanner tone="warning" compact>
              {t(TOOL_INSTALL_COPY.autoExtendNotice, { agentName: extendingLabel })}
            </InlineBanner>
          ) : null}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} disabled={submitting}>
          {t("appsConnect.installStep.back")}
        </Button>
        <Button onClick={onFinish} disabled={submitting || !canFinish}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitting ? t("appsConnect.installStep.finishing") : t("appsConnect.installStep.finishSetup")}
        </Button>
      </div>
    </div>
  );
}

function Radio({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
        selected ? "border-foreground" : "border-muted-foreground/40",
      )}
    >
      {selected && <span className="h-2 w-2 rounded-full bg-foreground" />}
    </span>
  );
}

function SuccessStep({
  appName,
  logoUrl,
  enabledCount,
  access,
  installMode,
  installCount,
  onDone,
}: {
  appName: string;
  logoUrl?: string | null;
  enabledCount: number;
  access: "all" | "specific";
  installMode: InstallMode;
  installCount: number;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const installSummary = installMode === "all"
    ? t("appsConnect.successStep.installOnAll")
    : installMode === "specific"
      ? installCount === 1
        ? t("appsConnect.successStep.installCountOne", { count: installCount })
        : t("appsConnect.successStep.installCountMany", { count: installCount })
      : t("appsConnect.successStep.permittedOnly");
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-2 border-emerald-500 bg-emerald-500/10">
        <Check className="h-9 w-9 text-emerald-600 dark:text-emerald-400" />
      </div>
      <div className="mt-6 flex items-center justify-center gap-2">
        <AppLogo name={appName} logoUrl={logoUrl} size={28} />
        <h2 className="text-2xl font-bold tracking-tight">{t("appsConnect.successStep.heading", { name: appName })}</h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {installMode === "none"
          ? t("appsConnect.successStep.noInstallDesc")
          : t("appsConnect.successStep.installedDesc")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {enabledCount === 1
          ? t("appsConnect.successStep.actionsOnOne", { count: enabledCount })
          : t("appsConnect.successStep.actionsOnMany", { count: enabledCount })}{" "}
        ·{" "}
        {access === "all" ? t("appsConnect.successStep.allAgents") : t("appsConnect.successStep.specificAgents")} · {installSummary}
      </p>
      <div className="mt-8">
        <Button size="lg" className="px-10" onClick={onDone}>
          {t("appsConnect.successStep.done")}
        </Button>
      </div>
    </div>
  );
}
