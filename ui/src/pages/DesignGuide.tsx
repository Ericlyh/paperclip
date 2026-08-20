import { useState } from "react";
import { useTranslation } from "../i18n";
import {
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  CircleDot,
  Command as CommandIcon,
  DollarSign,
  Hexagon,
  History,
  Inbox,
  LayoutDashboard,
  ListTodo,
  Mail,
  Plus,
  Search,
  Settings,
  Target,
  Trash2,
  Upload,
  User,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InlineBanner } from "@/components/InlineBanner";
import { BuiltInLifecycleChip } from "@/components/BuiltInAgentBadges";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable-panels";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar";
import { AgentCapsule, AGENT_GRADIENT_COUNT } from "@/components/AgentCapsule";
import { StatusBadge, IssueStatusBadge } from "@/components/StatusBadge";
import { StatusIcon } from "@/components/StatusIcon";
import { EnforcementBanner } from "@/components/EnforcementBanner";
import { ActionCard, ActionCardMobile, BindingsTable } from "@/components/actions/ActionCard";
import { PriorityIcon } from "@/components/PriorityIcon";
import { SHOW_TASK_PRIORITY_UI } from "@/lib/ui-flags";
import { agentStatusDot, agentStatusDotDefault } from "@/lib/status-colors";
import { EntityRow } from "@/components/EntityRow";
import { EmptyState } from "@/components/EmptyState";
import { MetricCard } from "@/components/MetricCard";
import { FilterBar, type FilterValue } from "@/components/FilterBar";
import { InlineEditor } from "@/components/InlineEditor";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Identity } from "@/components/Identity";
import { IssueReferencePill } from "@/components/IssueReferencePill";
import { MembershipAction } from "@/components/MembershipAction";
import { IssueOutputSection } from "@/components/issue-output/IssueOutputSection";
import { EnvironmentVariablesEditor } from "@/components/environment-variables-editor";
import type { CompanySecret, EnvBinding } from "@paperclipai/shared";
import {
  EnvInputsList,
  ExternalSourcesList,
  RequiredSkillsList,
  StepSkillPlan,
  StepSourcePolicy,
  TeamCard,
  TeamHierarchyPreview,
  TeamRow,
} from "@/pages/TeamCatalog";
import {
  currentInstalledState,
  onboardingTeams,
  optionalTeam,
  outOfDateInstalledState,
  sampleSkillPreparations,
  sampleTeam,
  warnTeam,
} from "@/pages/TeamCatalog.fixtures";
import type { IssueWorkProduct } from "@paperclipai/shared";

/* ------------------------------------------------------------------ */
/*  Sample data for the Issue Output surface showcase                  */
/* ------------------------------------------------------------------ */

function sampleOutput(
  id: string,
  attachmentId: string,
  contentType: string,
  filename: string,
  opts: { byteSize: number; isPrimary?: boolean; createdAt: string },
): IssueWorkProduct {
  const contentPath = `/api/attachments/${attachmentId}/content`;
  return {
    id,
    companyId: "demo-company",
    projectId: null,
    issueId: "demo-issue",
    executionWorkspaceId: null,
    runtimeServiceId: null,
    type: "artifact",
    provider: "paperclip",
    externalId: null,
    title: filename,
    url: null,
    status: "active",
    reviewState: "none",
    isPrimary: Boolean(opts.isPrimary),
    healthStatus: "unknown",
    summary: null,
    createdByRunId: null,
    createdAt: new Date(opts.createdAt),
    updatedAt: new Date(opts.createdAt),
    metadata: {
      attachmentId,
      contentType,
      byteSize: opts.byteSize,
      contentPath,
      openPath: contentPath,
      downloadPath: `${contentPath}?download=1`,
      originalFilename: filename,
    },
  } as IssueWorkProduct;
}

const DESIGN_GUIDE_OUTPUTS: IssueWorkProduct[] = [
  sampleOutput("wp-vid", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "video/mp4", "q3-summary.mp4", {
    byteSize: 19_293_798,
    isPrimary: true,
    createdAt: "2026-05-30T12:00:00Z",
  }),
  sampleOutput("wp-pdf", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "application/pdf", "talking-points.pdf", {
    byteSize: 421_888,
    createdAt: "2026-05-30T11:52:00Z",
  }),
];

const DESIGN_GUIDE_DEGRADED_OUTPUTS: IssueWorkProduct[] = [
  {
    ...sampleOutput("wp-broken", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "video/mp4", "corrupt-output.mp4", {
      byteSize: 0,
      isPrimary: true,
      createdAt: "2026-05-30T12:01:00Z",
    }),
    // Strip the path metadata so it fails the shared artifact schema.
    metadata: { attachmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", contentType: "video/mp4" },
  } as IssueWorkProduct,
];

/* ------------------------------------------------------------------ */
/*  Section wrapper                                                    */
/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        {title}
      </h3>
      <Separator />
      {children}
    </section>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">{title}</h4>
      {children}
    </div>
  );
}

// Onboarding seam (design §6 + §12.5): the TeamCard tile in its "Pick a starter
// team" 3-col grid, with the first defaultInstall tile selected.
function TeamCardShowcase() {
  const [selectedId, setSelectedId] = useState(onboardingTeams[0]?.id ?? null);
  return (
    <div className="grid max-w-2xl gap-4 md:grid-cols-2 lg:grid-cols-3">
      {onboardingTeams.map((team) => (
        <TeamCard
          key={team.id}
          team={team}
          selected={team.id === selectedId}
          onSelect={() => setSelectedId(team.id)}
        />
      ))}
    </div>
  );
}

// Reusable environment-variables editor: one shared grid, in-field source
// switch, fuzzy secret picker, sensitive-value detection, inline health.
const DESIGN_GUIDE_SECRETS: CompanySecret[] = [
  {
    id: "dg-github",
    companyId: "dg",
    scope: "company",
    ownerUserId: null,
    userSecretDefinitionId: null,
    key: "github_token",
    name: "GITHUB_TOKEN",
    provider: "local_encrypted",
    status: "active",
    managedMode: "paperclip_managed",
    externalRef: null,
    providerConfigId: null,
    providerMetadata: null,
    latestVersion: 3,
    description: null,
    lastResolvedAt: null,
    lastRotatedAt: null,
    deletedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    createdAt: new Date("2026-03-01T10:00:00.000Z"),
    updatedAt: new Date("2026-03-01T10:00:00.000Z"),
  },
  {
    id: "dg-db",
    companyId: "dg",
    scope: "company",
    ownerUserId: null,
    userSecretDefinitionId: null,
    key: "db_connection",
    name: "DB_CONNECTION",
    provider: "local_encrypted",
    status: "active",
    managedMode: "paperclip_managed",
    externalRef: null,
    providerConfigId: null,
    providerMetadata: null,
    latestVersion: 3,
    description: null,
    lastResolvedAt: null,
    lastRotatedAt: null,
    deletedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    createdAt: new Date("2026-03-01T10:00:00.000Z"),
    updatedAt: new Date("2026-03-01T10:00:00.000Z"),
  },
];

function EnvironmentVariablesEditorShowcase() {
  const [env, setEnv] = useState<Record<string, EnvBinding>>({
    NODE_ENV: { type: "plain", value: "production" },
    GH_TOKEN: { type: "secret_ref", secretId: "dg-github", version: "latest" },
    DB_URL: { type: "secret_ref", secretId: "dg-db", version: 3 },
    STRIPE_API_KEY: { type: "plain", value: "sk-live-51H8xL0aBcDeFgHiJkLmNoPq" },
  });
  return (
    <div className="max-w-(--sz-640px) rounded-md border border-border p-4">
      <EnvironmentVariablesEditor
        value={env}
        secrets={DESIGN_GUIDE_SECRETS}
        onChange={(next) => setEnv(next ?? {})}
        onCreateSecret={async (name) => ({
          ...DESIGN_GUIDE_SECRETS[0]!,
          id: `dg-${name}`,
          key: name,
          name: name.toUpperCase(),
          latestVersion: 1,
        })}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Color swatch                                                       */
/* ------------------------------------------------------------------ */

function Swatch({ name, cssVar }: { name: string; cssVar: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-8 w-8 rounded-md border border-border shrink-0"
        style={{ backgroundColor: `var(${cssVar})` }}
      />
      <div>
        <p className="text-xs font-mono">{cssVar}</p>
        <p className="text-xs text-muted-foreground">{name}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function DesignGuide() {
  const { t } = useTranslation();
  const [status, setStatus] = useState("todo");
  const [priority, setPriority] = useState("medium");
  const [selectValue, setSelectValue] = useState("in_progress");
  const [menuChecked, setMenuChecked] = useState(true);
  const [collapsibleOpen, setCollapsibleOpen] = useState(false);
  const [inlineText, setInlineText] = useState("Click to edit this text");
  const [inlineTitle, setInlineTitle] = useState("Editable Title");
  const [inlineDesc, setInlineDesc] = useState(
    "This is an editable description. Click to edit it — the textarea auto-sizes to fit the content without layout shift."
  );
  const [filters, setFilters] = useState<FilterValue[]>([
    { key: "status", label: "Status", value: "Active" },
    // PAP-411: priority filter demo row suppressed while SHOW_TASK_PRIORITY_UI is off.
    ...(SHOW_TASK_PRIORITY_UI
      ? [{ key: "priority", label: "Priority", value: "High" } as FilterValue]
      : []),
  ]);
  const [allowExternal, setAllowExternal] = useState(false);
  const [allowUnpinned, setAllowUnpinned] = useState(false);
  const [allowLocalPath, setAllowLocalPath] = useState(false);

  return (
    <div className="space-y-10 max-w-4xl">
      {/* Page header */}
      <div>
        <h2 className="text-xl font-bold">{t("designGuide.page.title")}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t("designGuide.page.description")}
        </p>
      </div>

      {/* ============================================================ */}
      {/*  COVERAGE                                                     */}
      {/* ============================================================ */}
      <Section title={t("designGuide.coverage.title")}>
        <p className="text-sm text-muted-foreground">
          {t("designGuide.coverage.description")}
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          <SubSection title={t("designGuide.coverage.uiPrimitives")}>
            <div className="flex flex-wrap gap-2">
              {[
                "avatar", "badge", "breadcrumb", "button", "card", "checkbox", "collapsible",
                "command", "dialog", "dropdown-menu", "input", "label", "popover", "resizable-panels",
                "scroll-area", "select", "separator", "sheet", "skeleton", "tabs", "textarea", "tooltip",
              ].map((name) => (
                <Badge key={name} variant="outline" className="font-mono text-(length:--text-nano)">
                  {name}
                </Badge>
              ))}
            </div>
          </SubSection>
          <SubSection title={t("designGuide.coverage.appComponents")}>
            <div className="flex flex-wrap gap-2">
              {[
                "StatusBadge", "StatusIcon", "PriorityIcon", "EntityRow", "EmptyState", "MetricCard",
                "FilterBar", "InlineEditor", "PageSkeleton", "Identity", "CommentThread", "MarkdownEditor",
                "PropertiesPanel", "Sidebar", "CommandPalette", "EnvironmentVariablesEditor",
                "InlineBanner", "BuiltInAgentGate", "BuiltInLifecycleChip",
              ].map((name) => (
                <Badge key={name} variant="ghost" className="font-mono text-(length:--text-nano)">
                  {name}
                </Badge>
              ))}
            </div>
          </SubSection>
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  COLORS                                                       */}
      {/* ============================================================ */}
      <Section title={t("designGuide.colors.title")}>
        <SubSection title={t("designGuide.colors.core")}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Swatch name={t("designGuide.colors.swatch.background")} cssVar="--background" />
            <Swatch name={t("designGuide.colors.swatch.foreground")} cssVar="--foreground" />
            <Swatch name={t("designGuide.colors.swatch.card")} cssVar="--card" />
            <Swatch name={t("designGuide.colors.swatch.primary")} cssVar="--primary" />
            <Swatch name={t("designGuide.colors.swatch.primaryForeground")} cssVar="--primary-foreground" />
            <Swatch name={t("designGuide.colors.swatch.secondary")} cssVar="--secondary" />
            <Swatch name={t("designGuide.colors.swatch.muted")} cssVar="--muted" />
            <Swatch name={t("designGuide.colors.swatch.mutedForeground")} cssVar="--muted-foreground" />
            <Swatch name={t("designGuide.colors.swatch.accent")} cssVar="--accent" />
            <Swatch name={t("designGuide.colors.swatch.destructive")} cssVar="--destructive" />
            <Swatch name={t("designGuide.colors.swatch.border")} cssVar="--border" />
            <Swatch name={t("designGuide.colors.swatch.ring")} cssVar="--ring" />
          </div>
        </SubSection>

        <SubSection title={t("designGuide.colors.sidebar")}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Swatch name={t("designGuide.colors.swatch.sidebarBackground")} cssVar="--sidebar" />
            <Swatch name={t("designGuide.colors.swatch.sidebarBorder")} cssVar="--sidebar-border" />
          </div>
        </SubSection>

        <SubSection title={t("designGuide.colors.chart")}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Swatch name={t("designGuide.colors.swatch.chart1")} cssVar="--chart-1" />
            <Swatch name={t("designGuide.colors.swatch.chart2")} cssVar="--chart-2" />
            <Swatch name={t("designGuide.colors.swatch.chart3")} cssVar="--chart-3" />
            <Swatch name={t("designGuide.colors.swatch.chart4")} cssVar="--chart-4" />
            <Swatch name={t("designGuide.colors.swatch.chart5")} cssVar="--chart-5" />
          </div>
        </SubSection>
      </Section>

      {/* ============================================================ */}
      {/*  TYPOGRAPHY                                                   */}
      {/* ============================================================ */}
      <Section title={t("designGuide.typography.title")}>
        <div className="space-y-3">
          <h2 className="text-xl font-bold">{t("designGuide.typography.pageTitle")}</h2>
          <h2 className="text-lg font-semibold">{t("designGuide.typography.sectionTitle")}</h2>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {t("designGuide.typography.sectionHeading")}
          </h3>
          <p className="text-sm font-medium">{t("designGuide.typography.cardTitle")}</p>
          <p className="text-sm font-semibold">{t("designGuide.typography.cardTitleAlt")}</p>
          <p className="text-sm">{t("designGuide.typography.bodyText")}</p>
          <p className="text-sm text-muted-foreground">
            {t("designGuide.typography.mutedDescription")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("designGuide.typography.tinyLabel")}
          </p>
          <p className="text-sm font-mono text-muted-foreground">
            {t("designGuide.typography.monoIdentifier")}
          </p>
          <p className="text-2xl font-bold">{t("designGuide.typography.largeStat")}</p>
          <p className="font-mono text-xs">{t("designGuide.typography.logCodeText")}</p>
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  SPACING & RADIUS                                             */}
      {/* ============================================================ */}
      <Section title={t("designGuide.radius.title")}>
        <div className="flex items-end gap-4 flex-wrap">
          {[
            ["sm", "var(--radius-sm)"],
            ["md", "var(--radius-md)"],
            ["lg", "var(--radius-lg)"],
            ["xl", "var(--radius-xl)"],
            ["full", "9999px"],
          ].map(([label, radius]) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <div
                className="h-12 w-12 bg-primary"
                style={{ borderRadius: radius }}
              />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  BUTTONS                                                      */}
      {/* ============================================================ */}
      <Section title={t("designGuide.buttons.title")}>
        <SubSection title={t("designGuide.buttons.variants")}>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="default">{t("designGuide.buttons.label.default")}</Button>
            <Button variant="secondary">{t("designGuide.buttons.label.secondary")}</Button>
            <Button variant="outline">{t("designGuide.buttons.label.outline")}</Button>
            <Button variant="ghost">{t("designGuide.buttons.label.ghost")}</Button>
            <Button variant="destructive">{t("designGuide.buttons.label.destructive")}</Button>
            <Button variant="link">{t("designGuide.buttons.label.link")}</Button>
          </div>
        </SubSection>

        <SubSection title={t("designGuide.buttons.sizes")}>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="xs">{t("designGuide.buttons.label.extraSmall")}</Button>
            <Button size="sm">{t("designGuide.buttons.label.small")}</Button>
            <Button size="default">{t("designGuide.buttons.label.default")}</Button>
            <Button size="lg">{t("designGuide.buttons.label.large")}</Button>
          </div>
        </SubSection>

        <SubSection title={t("designGuide.buttons.iconButtons")}>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="icon-xs"><Search /></Button>
            <Button variant="ghost" size="icon-sm"><Search /></Button>
            <Button variant="outline" size="icon"><Search /></Button>
            <Button variant="outline" size="icon-lg"><Search /></Button>
          </div>
        </SubSection>

        <SubSection title={t("designGuide.buttons.withIcons")}>
          <div className="flex items-center gap-2 flex-wrap">
            <Button><Plus /> {t("designGuide.buttons.label.newIssue")}</Button>
            <Button variant="outline"><Upload /> {t("designGuide.buttons.label.upload")}</Button>
            <Button variant="destructive"><Trash2 /> {t("designGuide.buttons.label.delete")}</Button>
            <Button size="sm"><Plus /> {t("designGuide.buttons.label.add")}</Button>
          </div>
        </SubSection>

        <SubSection title={t("designGuide.buttons.states")}>
          <div className="flex items-center gap-2 flex-wrap">
            <Button disabled>{t("designGuide.buttons.label.disabled")}</Button>
            <Button variant="outline" disabled>{t("designGuide.buttons.label.disabledOutline")}</Button>
          </div>
        </SubSection>
      </Section>

      {/* ============================================================ */}
      {/*  BADGES                                                       */}
      {/* ============================================================ */}
      <Section title={t("designGuide.badges.title")}>
        <SubSection title={t("designGuide.badges.variants")}>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="default">{t("designGuide.badges.label.default")}</Badge>
            <Badge variant="secondary">{t("designGuide.badges.label.secondary")}</Badge>
            <Badge variant="outline">{t("designGuide.badges.label.outline")}</Badge>
            <Badge variant="destructive">{t("designGuide.badges.label.destructive")}</Badge>
            <Badge variant="ghost">{t("designGuide.badges.label.ghost")}</Badge>
          </div>
        </SubSection>
      </Section>

      {/* ============================================================ */}
      {/*  STATUS BADGES & ICONS                                        */}
      {/* ============================================================ */}
      <Section title={t("designGuide.statusSystem.title")}>
        <SubSection title={t("designGuide.statusSystem.allStatuses")}>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              "active", "running", "paused", "idle", "archived", "planned",
              "achieved", "completed", "failed", "timed_out", "succeeded", "error",
              "pending_approval", "backlog", "todo", "in_progress", "in_review", "blocked",
              "done", "terminated", "cancelled", "pending", "revision_requested",
              "approved", "rejected",
            ].map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
        </SubSection>

        <SubSection title={t("designGuide.statusSystem.issueStatusBadge")}>
          <div className="flex items-center gap-2 flex-wrap">
            {["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"].map(
              (s) => (
                <IssueStatusBadge key={s} status={s} />
              )
            )}
          </div>
        </SubSection>

        <SubSection title={t("designGuide.statusSystem.statusIconInteractive")}>
          <div className="flex items-center gap-3 flex-wrap">
            {["backlog", "todo", "in_progress", "in_review", "done", "cancelled", "blocked"].map(
              (s) => (
                <div key={s} className="flex items-center gap-1.5">
                  <StatusIcon status={s} />
                  <span className="text-xs text-muted-foreground">{s}</span>
                </div>
              )
            )}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <StatusIcon status={status} onChange={setStatus} />
            <span className="text-sm">{t("designGuide.statusSystem.statusInteractiveHint", { status })}</span>
          </div>
        </SubSection>

        {/* PAP-411: PriorityIcon showcase gated behind SHOW_TASK_PRIORITY_UI per board decision. */}
        {SHOW_TASK_PRIORITY_UI && (
        <SubSection title={t("designGuide.statusSystem.priorityIconInteractive")}>
          <div className="flex items-center gap-3 flex-wrap">
            {["critical", "high", "medium", "low"].map((p) => (
              <div key={p} className="flex items-center gap-1.5">
                <PriorityIcon priority={p} />
                <span className="text-xs text-muted-foreground">{p}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <PriorityIcon priority={priority} onChange={setPriority} />
            <span className="text-sm">{t("designGuide.statusSystem.priorityInteractiveHint", { priority })}</span>
          </div>
        </SubSection>
        )}

        <SubSection title={t("designGuide.statusSystem.agentStatusDots")}>
          <div className="flex items-center gap-4 flex-wrap">
            {(["running", "active", "paused", "error", "archived"] as const).map((label) => (
              <div key={label} className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className={`inline-flex h-full w-full rounded-full ${agentStatusDot[label] ?? agentStatusDotDefault}`} />
                </span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </SubSection>

        <SubSection title={t("designGuide.statusSystem.runInvocationBadges")}>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              ["timer", "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"],
              ["assignment", "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"],
              ["on_demand", "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300"],
              ["automation", "bg-muted text-muted-foreground"],
            ].map(([label, cls]) => (
              <Badge variant="ghost" key={label} className={`px-1.5 text-(length:--text-nano) ${cls}`}>
                {label}
              </Badge>
            ))}
          </div>
        </SubSection>

        <SubSection title={t("designGuide.statusSystem.issueReferencePill")}>
          <p className="text-xs text-muted-foreground">
            {t("designGuide.statusSystem.issueReferencePillDescription")}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <IssueReferencePill issue={{ id: "demo-1", identifier: "PAP-123", title: "Identifier only — no status yet" }} />
            <IssueReferencePill issue={{ id: "demo-2", identifier: "PAP-456", title: "With in_progress status", status: "in_progress" }} />
            <IssueReferencePill issue={{ id: "demo-3", identifier: "PAP-789", title: "Done status", status: "done" }} />
            <IssueReferencePill issue={{ id: "demo-4", identifier: "PAP-101", title: "Blocked status", status: "blocked" }} />
            <IssueReferencePill strikethrough issue={{ id: "demo-5", identifier: "PAP-202", title: "Removed (strikethrough)", status: "todo" }} />
          </div>
        </SubSection>
      </Section>

      {/* ============================================================ */}
      {/*  AGENT CAPSULE                                                */}
      {/* ============================================================ */}
      <Section title={t("designGuide.agentCapsule.title")}>
        <p className="text-sm text-muted-foreground max-w-prose">
          {t("designGuide.agentCapsule.description")}
        </p>
        <SubSection title={t("designGuide.agentCapsule.states")}>
          <div className="flex items-end gap-10">
            <div className="flex flex-col items-center gap-2">
              <AgentCapsule state="slot" />
              <span className="text-xs text-muted-foreground">{t("designGuide.agentCapsule.stateSlot")}</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <AgentCapsule state="configured" />
              <span className="text-xs text-muted-foreground">{t("designGuide.agentCapsule.stateConfigured")}</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <AgentCapsule state="online" gradient={5} />
              <span className="text-xs text-muted-foreground">{t("designGuide.agentCapsule.stateOnline")}</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <AgentCapsule state="online" gradient={5} glow="blue" />
              <span className="text-xs text-muted-foreground">{t("designGuide.agentCapsule.stateOnlineBlueGlow")}</span>
            </div>
          </div>
        </SubSection>
        <SubSection title={t("designGuide.agentCapsule.sizes")}>
          <div className="flex items-end gap-8">
            <div className="flex flex-col items-center gap-2">
              <AgentCapsule state="online" size="sm" gradient={1} />
              <span className="text-xs text-muted-foreground">{t("designGuide.agentCapsule.sizeSm")}</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <AgentCapsule state="online" size="md" gradient={4} />
              <span className="text-xs text-muted-foreground">{t("designGuide.agentCapsule.sizeMd")}</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <AgentCapsule state="online" size="lg" gradient={8} />
              <span className="text-xs text-muted-foreground">{t("designGuide.agentCapsule.sizeLg")}</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <AgentCapsule state="online" size={{ width: 28, height: 96 }} gradient={6} />
              <span className="text-xs text-muted-foreground">{t("designGuide.agentCapsule.sizeCustomPx")}</span>
            </div>
          </div>
        </SubSection>
        <SubSection title={t("designGuide.agentCapsule.gradients")}>
          <div className="flex items-end gap-3 flex-wrap">
            {Array.from({ length: AGENT_GRADIENT_COUNT }, (_, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <AgentCapsule state="online" size="sm" gradient={i + 1} />
                <span className="text-(length:--text-nano) font-mono text-muted-foreground">{i + 1}</span>
              </div>
            ))}
          </div>
        </SubSection>
      </Section>

      {/* ============================================================ */}
      {/*  FORM ELEMENTS                                                */}
      {/* ============================================================ */}
      <Section title={t("designGuide.formElements.title")}>
        <div className="grid gap-6 md:grid-cols-2">
          <SubSection title={t("designGuide.formElements.input")}>
            <Input placeholder={t("designGuide.formElements.placeholder.default")} />
            <Input placeholder={t("designGuide.formElements.placeholder.disabled")} disabled className="mt-2" />
          </SubSection>

          <SubSection title={t("designGuide.formElements.textarea")}>
            <Textarea placeholder={t("designGuide.formElements.placeholder.writeSomething")} />
          </SubSection>

          <SubSection title={t("designGuide.formElements.checkboxLabel")}>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox id="check1" defaultChecked />
                <Label htmlFor="check1">{t("designGuide.formElements.label.checked")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="check2" />
                <Label htmlFor="check2">{t("designGuide.formElements.label.unchecked")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="check3" disabled />
                <Label htmlFor="check3">{t("designGuide.formElements.label.disabled")}</Label>
              </div>
            </div>
          </SubSection>

          <SubSection title={t("designGuide.formElements.inlineEditor")}>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("designGuide.formElements.editor.title")}</p>
                <InlineEditor
                  value={inlineTitle}
                  onSave={setInlineTitle}
                  as="h2"
                  className="text-xl font-bold"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("designGuide.formElements.editor.body")}</p>
                <InlineEditor
                  value={inlineText}
                  onSave={setInlineText}
                  as="p"
                  className="text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("designGuide.formElements.editor.description")}</p>
                <InlineEditor
                  value={inlineDesc}
                  onSave={setInlineDesc}
                  as="p"
                  className="text-sm text-muted-foreground"
                  placeholder="Add a description..."
                  multiline
                />
              </div>
            </div>
          </SubSection>
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  SELECT                                                       */}
      {/* ============================================================ */}
      <Section title={t("designGuide.select.title")}>
        <div className="grid gap-6 md:grid-cols-2">
          <SubSection title={t("designGuide.select.defaultSize")}>
            <Select value={selectValue} onValueChange={setSelectValue}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("designGuide.select.placeholder.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="backlog">{t("designGuide.select.item.backlog")}</SelectItem>
                <SelectItem value="todo">{t("designGuide.select.item.todo")}</SelectItem>
                <SelectItem value="in_progress">{t("designGuide.select.item.inProgress")}</SelectItem>
                <SelectItem value="in_review">{t("designGuide.select.item.inReview")}</SelectItem>
                <SelectItem value="done">{t("designGuide.select.item.done")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("designGuide.select.currentValue", { value: selectValue })}</p>
          </SubSection>
          <SubSection title={t("designGuide.select.smallTrigger")}>
            <Select defaultValue="high">
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="critical">{t("designGuide.select.item.critical")}</SelectItem>
                <SelectItem value="high">{t("designGuide.select.item.high")}</SelectItem>
                <SelectItem value="medium">{t("designGuide.select.item.medium")}</SelectItem>
                <SelectItem value="low">{t("designGuide.select.item.low")}</SelectItem>
              </SelectContent>
            </Select>
          </SubSection>
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  DROPDOWN MENU                                                */}
      {/* ============================================================ */}
      <Section title={t("designGuide.dropdownMenu.title")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              {t("designGuide.dropdownMenu.trigger")}
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem>
              <Check className="h-4 w-4" />
              {t("designGuide.dropdownMenu.markAsDone")}
              <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <BookOpen className="h-4 w-4" />
              {t("designGuide.dropdownMenu.openDocs")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={menuChecked}
              onCheckedChange={(value) => setMenuChecked(value === true)}
            >
              {t("designGuide.dropdownMenu.watchIssue")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem variant="destructive">
              <Trash2 className="h-4 w-4" />
              {t("designGuide.dropdownMenu.deleteIssue")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>

      {/* ============================================================ */}
      {/*  POPOVER                                                      */}
      {/* ============================================================ */}
      <Section title={t("designGuide.popover.title")}>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">{t("designGuide.popover.open")}</Button>
          </PopoverTrigger>
          <PopoverContent className="space-y-2">
            <p className="text-sm font-medium">{t("designGuide.popover.agentHeartbeat")}</p>
            <p className="text-xs text-muted-foreground">
              {t("designGuide.popover.lastRunStatus")}
            </p>
            <Button size="xs">{t("designGuide.popover.wakeNow")}</Button>
          </PopoverContent>
        </Popover>
      </Section>

      {/* ============================================================ */}
      {/*  COLLAPSIBLE                                                  */}
      {/* ============================================================ */}
      <Section title={t("designGuide.collapsible.title")}>
        <Collapsible open={collapsibleOpen} onOpenChange={setCollapsibleOpen} className="space-y-2">
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm">
              {collapsibleOpen ? t("designGuide.collapsible.hideFilters") : t("designGuide.collapsible.showFilters")}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="rounded-md border border-border p-3">
            <div className="space-y-2">
              <Label htmlFor="owner-filter">{t("designGuide.collapsible.owner")}</Label>
              <Input id="owner-filter" placeholder={t("designGuide.collapsible.filterByAgent")} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Section>

      {/* ============================================================ */}
      {/*  SHEET                                                        */}
      {/* ============================================================ */}
      <Section title={t("designGuide.sheet.title")}>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">{t("designGuide.sheet.openSidePanel")}</Button>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>{t("designGuide.sheet.issueProperties")}</SheetTitle>
              <SheetDescription>{t("designGuide.sheet.editMetadata")}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4">
              <div className="space-y-1">
                <Label htmlFor="sheet-title">Title</Label>
                <Input id="sheet-title" defaultValue="Improve onboarding docs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sheet-description">Description</Label>
                <Textarea id="sheet-description" defaultValue="Capture setup pitfalls and screenshots." />
              </div>
            </div>
            <SheetFooter>
              <Button variant="outline">{t("common.cancel")}</Button>
              <Button>{t("common.save")}</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </Section>

      {/* ============================================================ */}
      {/*  SCROLL AREA                                                  */}
      {/* ============================================================ */}
      <Section title={t("designGuide.scrollArea.title")}>
        <ScrollArea className="h-36 rounded-md border border-border">
          <div className="space-y-2 p-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="rounded-md border border-border p-2 text-sm">
                {t("designGuide.scrollArea.heartbeatRun", { n: i + 1 })}
              </div>
            ))}
          </div>
        </ScrollArea>
      </Section>

      {/* ============================================================ */}
      {/*  COMMAND                                                      */}
      {/* ============================================================ */}
      <Section title={t("designGuide.command.title")}>
        <div className="rounded-md border border-border">
          <Command>
            <CommandInput placeholder={t("designGuide.command.placeholder")} />
            <CommandList>
              <CommandEmpty>{t("designGuide.command.noResults")}</CommandEmpty>
              <CommandGroup heading={t("designGuide.command.group.pages")}>
                <CommandItem>
                  <LayoutDashboard className="h-4 w-4" />
                  {t("designGuide.command.item.dashboard")}
                </CommandItem>
                <CommandItem>
                  <CircleDot className="h-4 w-4" />
                  {t("designGuide.command.item.issues")}
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading={t("designGuide.command.group.actions")}>
                <CommandItem>
                  <CommandIcon className="h-4 w-4" />
                  {t("designGuide.command.item.openCommandPalette")}
                </CommandItem>
                <CommandItem>
                  <Plus className="h-4 w-4" />
                  {t("designGuide.command.item.createNewIssue")}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  BREADCRUMB                                                   */}
      {/* ============================================================ */}
      <Section title={t("designGuide.breadcrumb.title")}>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#">{t("designGuide.breadcrumb.projects")}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#">{t("designGuide.breadcrumb.paperclipApp")}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{t("designGuide.breadcrumb.issueList")}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </Section>

      {/* ============================================================ */}
      {/*  CARDS                                                        */}
      {/* ============================================================ */}
      <Section title={t("designGuide.cards.title")}>
        <SubSection title={t("designGuide.cards.standardCard")}>
          <Card>
            <CardHeader>
              <CardTitle>{t("designGuide.cards.cardTitleDemo")}</CardTitle>
              <CardDescription>{t("designGuide.cards.cardDescriptionDemo")}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{t("designGuide.cards.cardContentDemo")}</p>
            </CardContent>
            <CardFooter className="gap-2">
              <Button size="sm">{t("designGuide.cards.action")}</Button>
              <Button variant="outline" size="sm">{t("common.cancel")}</Button>
            </CardFooter>
          </Card>
        </SubSection>

        <SubSection title={t("designGuide.cards.metricCards")}>
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
            <MetricCard icon={Bot} value={12} label={t("designGuide.cards.metric.activeAgents")} description={t("designGuide.cards.metric.deltaThisWeek")} />
            <MetricCard icon={CircleDot} value={48} label={t("designGuide.cards.metric.openIssues")} />
            <MetricCard icon={DollarSign} value="$1,234" label={t("designGuide.cards.metric.monthlyCost")} description={t("designGuide.cards.metric.underBudget")} />
            <MetricCard icon={Zap} value="99.9%" label={t("designGuide.cards.metric.uptime")} />
          </div>
        </SubSection>
      </Section>

      {/* ============================================================ */}
      {/*  TABS                                                         */}
      {/* ============================================================ */}
      <Section title={t("designGuide.tabs.title")}>
        <SubSection title={t("designGuide.tabs.pillVariant")}>
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">{t("designGuide.tabs.overview")}</TabsTrigger>
              <TabsTrigger value="runs">{t("designGuide.tabs.runs")}</TabsTrigger>
              <TabsTrigger value="config">{t("designGuide.tabs.config")}</TabsTrigger>
              <TabsTrigger value="costs">{t("designGuide.tabs.costs")}</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <p className="text-sm text-muted-foreground py-4">{t("designGuide.tabs.content.overview")}</p>
            </TabsContent>
            <TabsContent value="runs">
              <p className="text-sm text-muted-foreground py-4">{t("designGuide.tabs.content.runs")}</p>
            </TabsContent>
            <TabsContent value="config">
              <p className="text-sm text-muted-foreground py-4">{t("designGuide.tabs.content.config")}</p>
            </TabsContent>
            <TabsContent value="costs">
              <p className="text-sm text-muted-foreground py-4">{t("designGuide.tabs.content.costs")}</p>
            </TabsContent>
          </Tabs>
        </SubSection>

        <SubSection title={t("designGuide.tabs.lineVariant")}>
          <Tabs defaultValue="summary">
            <TabsList variant="line">
              <TabsTrigger value="summary">{t("designGuide.tabs.summary")}</TabsTrigger>
              <TabsTrigger value="details">{t("designGuide.tabs.details")}</TabsTrigger>
              <TabsTrigger value="comments">{t("designGuide.tabs.comments")}</TabsTrigger>
            </TabsList>
            <TabsContent value="summary">
              <p className="text-sm text-muted-foreground py-4">{t("designGuide.tabs.content.summary")}</p>
            </TabsContent>
            <TabsContent value="details">
              <p className="text-sm text-muted-foreground py-4">{t("designGuide.tabs.content.details")}</p>
            </TabsContent>
            <TabsContent value="comments">
              <p className="text-sm text-muted-foreground py-4">{t("designGuide.tabs.content.comments")}</p>
            </TabsContent>
          </Tabs>
        </SubSection>
      </Section>

      {/* ============================================================ */}
      {/*  ENTITY ROWS                                                  */}
      {/* ============================================================ */}
      <Section title={t("designGuide.entityRows.title")}>
        <div className="border border-border rounded-md">
          <EntityRow
            leading={
              <>
                <StatusIcon status="in_progress" />
                {/* PAP-411: PriorityIcon hidden behind SHOW_TASK_PRIORITY_UI. */}
                {SHOW_TASK_PRIORITY_UI && <PriorityIcon priority="high" />}
              </>
            }
            identifier="PAP-001"
            title="Implement authentication flow"
            subtitle={t("designGuide.entityRows.subtitle.responsible")}
            trailing={<IssueStatusBadge status="in_progress" />}
            onClick={() => {}}
          />
          <EntityRow
            leading={
              <>
                <StatusIcon status="done" />
                {SHOW_TASK_PRIORITY_UI && <PriorityIcon priority="medium" />}
              </>
            }
            identifier="PAP-002"
            title="Set up CI/CD pipeline"
            subtitle={t("designGuide.entityRows.subtitle.completedAgo")}
            trailing={<IssueStatusBadge status="done" />}
            onClick={() => {}}
          />
          <EntityRow
            leading={
              <>
                <StatusIcon status="todo" />
                {SHOW_TASK_PRIORITY_UI && <PriorityIcon priority="low" />}
              </>
            }
            identifier="PAP-003"
            title="Write API documentation"
            trailing={<IssueStatusBadge status="todo" />}
            onClick={() => {}}
          />
          <EntityRow
            leading={
              <>
                <StatusIcon status="blocked" />
                {SHOW_TASK_PRIORITY_UI && <PriorityIcon priority="critical" />}
              </>
            }
            identifier="PAP-004"
            title="Deploy to production"
            subtitle={t("designGuide.entityRows.subtitle.blockedBy")}
            trailing={<IssueStatusBadge status="blocked" />}
            selected
          />
        </div>
        <SubSection title={t("designGuide.entityRows.membershipAction")}>
          <div className="border border-border rounded-md">
            <EntityRow
              title="Joined resource"
              subtitle={t("designGuide.entityRows.subtitle.hoverHint")}
              className="group"
              trailing={
                <MembershipAction
                  state="joined"
                  resourceName="Joined resource"
                  onJoin={() => {}}
                  onLeave={() => {}}
                />
              }
            />
            <EntityRow
              title="Left resource"
              subtitle={t("designGuide.entityRows.subtitle.persistentAction")}
              className="group text-foreground/55"
              trailing={
                <MembershipAction
                  state="left"
                  resourceName="Left resource"
                  onJoin={() => {}}
                  onLeave={() => {}}
                />
              }
            />
            <EntityRow
              title="Leaving resource"
              subtitle={t("designGuide.entityRows.subtitle.disabledPending")}
              className="group text-foreground/55"
              trailing={
                <MembershipAction
                  state="left"
                  pending
                  pendingState="left"
                  resourceName="Leaving resource"
                  onJoin={() => {}}
                  onLeave={() => {}}
                />
              }
            />
            <EntityRow
              title="Joining resource"
              subtitle={t("designGuide.entityRows.subtitle.targetVisible")}
              className="group"
              trailing={
                <MembershipAction
                  state="joined"
                  pending
                  pendingState="joined"
                  resourceName="Joining resource"
                  onJoin={() => {}}
                  onLeave={() => {}}
                />
              }
            />
          </div>
        </SubSection>
      </Section>

      {/* ============================================================ */}
      {/*  FILTER BAR                                                   */}
      {/* ============================================================ */}
      <Section title={t("designGuide.filterBar.title")}>
        <FilterBar
          filters={filters}
          onRemove={(key) => setFilters((f) => f.filter((x) => x.key !== key))}
          onClear={() => setFilters([])}
        />
        {filters.length === 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setFilters([
                { key: "status", label: "Status", value: "Active" },
                // PAP-411: priority filter demo row suppressed while SHOW_TASK_PRIORITY_UI is off.
                ...(SHOW_TASK_PRIORITY_UI
                  ? [{ key: "priority", label: "Priority", value: "High" } as FilterValue]
                  : []),
              ])
            }
          >
            {t("designGuide.filterBar.resetFilters")}
          </Button>
        )}
      </Section>

      {/* ============================================================ */}
      {/*  AVATARS                                                      */}
      {/* ============================================================ */}
      <Section title={t("designGuide.avatars.title")}>
        <SubSection title={t("designGuide.avatars.sizes")}>
          <div className="flex items-center gap-3">
            <Avatar size="sm"><AvatarFallback>SM</AvatarFallback></Avatar>
            <Avatar><AvatarFallback>DF</AvatarFallback></Avatar>
            <Avatar size="lg"><AvatarFallback>LG</AvatarFallback></Avatar>
          </div>
        </SubSection>

        <SubSection title={t("designGuide.avatars.group")}>
          <AvatarGroup>
            <Avatar><AvatarFallback>A1</AvatarFallback></Avatar>
            <Avatar><AvatarFallback>A2</AvatarFallback></Avatar>
            <Avatar><AvatarFallback>A3</AvatarFallback></Avatar>
            <AvatarGroupCount>+5</AvatarGroupCount>
          </AvatarGroup>
        </SubSection>
      </Section>

      {/* ============================================================ */}
      {/*  IDENTITY                                                     */}
      {/* ============================================================ */}
      <Section title={t("designGuide.identity.title")}>
        <SubSection title={t("designGuide.identity.sizes")}>
          <div className="flex items-center gap-6">
            <Identity name="Agent Alpha" size="sm" />
            <Identity name="Agent Alpha" />
            <Identity name="Agent Alpha" size="lg" />
          </div>
        </SubSection>

        <SubSection title={t("designGuide.identity.initialsDerivation")}>
          <div className="flex flex-col gap-2">
            <Identity name="CEO Agent" size="sm" />
            <Identity name="Alpha" size="sm" />
            <Identity name="Quality Assurance Lead" size="sm" />
          </div>
        </SubSection>

        <SubSection title={t("designGuide.identity.customInitials")}>
          <Identity name="Backend Service" initials="BS" size="sm" />
        </SubSection>
      </Section>

      {/* ============================================================ */}
      {/*  TOOLTIPS                                                     */}
      {/* ============================================================ */}
      <Section title={t("designGuide.tooltips.title")}>
        <div className="flex items-center gap-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm">{t("designGuide.tooltips.hoverMe")}</Button>
            </TooltipTrigger>
            <TooltipContent>{t("designGuide.tooltips.thisIsTooltip")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm"><Settings /></Button>
            </TooltipTrigger>
            <TooltipContent>{t("designGuide.tooltips.settings")}</TooltipContent>
          </Tooltip>
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  DIALOG                                                       */}
      {/* ============================================================ */}
      <Section title={t("designGuide.dialog.title")}>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">{t("designGuide.dialog.open")}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("designGuide.dialog.dialogTitle")}</DialogTitle>
              <DialogDescription>
                {t("designGuide.dialog.description")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>{t("designGuide.dialog.label.name")}</Label>
                <Input placeholder={t("designGuide.dialog.placeholder.name")} className="mt-1.5" />
              </div>
              <div>
                <Label>{t("designGuide.dialog.label.description")}</Label>
                <Textarea placeholder={t("designGuide.dialog.placeholder.describe")} className="mt-1.5" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline">{t("common.cancel")}</Button>
              <Button>{t("common.save")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      {/* ============================================================ */}
      {/*  EMPTY STATE                                                  */}
      {/* ============================================================ */}
      <Section title={t("designGuide.emptyState.title")}>
        <div className="border border-border rounded-md">
          <EmptyState
            icon={Inbox}
            message={t("designGuide.emptyState.demoMessage")}
            action={t("designGuide.emptyState.demoAction")}
            onAction={() => {}}
          />
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  PROGRESS BARS                                                */}
      {/* ============================================================ */}
      <Section title={t("designGuide.progressBars.title")}>
        <div className="space-y-3">
          {[
            { label: t("designGuide.progressBars.underBudget", { pct: 40 }), pct: 40, color: "bg-green-400" },
            { label: t("designGuide.progressBars.warning", { pct: 75 }), pct: 75, color: "bg-yellow-400" },
            { label: t("designGuide.progressBars.overBudget", { pct: 95 }), pct: 95, color: "bg-red-400" },
          ].map(({ label, pct, color }) => (
            <div key={label} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="text-xs font-mono">{t("designGuide.progressBars.percent", { pct })}</span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-(--tp-width-background-color) duration-150 ${color}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  LOG VIEWER                                                   */}
      {/* ============================================================ */}
      <Section title={t("designGuide.logViewer.title")}>
        <div className="bg-neutral-950 rounded-lg p-3 font-mono text-xs max-h-80 overflow-y-auto">
          <div className="text-foreground">{t("designGuide.logViewer.line1")}</div>
          <div className="text-foreground">{t("designGuide.logViewer.line2")}</div>
          <div className="text-yellow-400">{t("designGuide.logViewer.line3")}</div>
          <div className="text-foreground">{t("designGuide.logViewer.line4")}</div>
          <div className="text-red-400">{t("designGuide.logViewer.line5")}</div>
          <div className="text-blue-300">{t("designGuide.logViewer.line6")}</div>
          <div className="text-foreground">{t("designGuide.logViewer.line7")}</div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 animate-pulse" />
              <span className="inline-flex h-full w-full rounded-full bg-blue-500" />
            </span>
            <span className="text-blue-600 dark:text-blue-400">{t("designGuide.logViewer.live")}</span>
          </div>
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  PROPERTY ROW PATTERN                                         */}
      {/* ============================================================ */}
      <Section title={t("designGuide.propertyRow.title")}>
        <div className="border border-border rounded-md p-4 space-y-1 max-w-sm">
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-muted-foreground">{t("common.status")}</span>
            <StatusBadge status="active" />
          </div>
          {/* PAP-411: priority metadata row hidden behind SHOW_TASK_PRIORITY_UI. */}
          {SHOW_TASK_PRIORITY_UI && (
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs text-muted-foreground">{t("common.priority")}</span>
              <PriorityIcon priority="high" />
            </div>
          )}
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-muted-foreground">{t("designGuide.propertyRow.responsible")}</span>
            <div className="flex items-center gap-1.5">
              <Avatar size="sm"><AvatarFallback>A</AvatarFallback></Avatar>
              <span className="text-xs">Agent Alpha</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-muted-foreground">{t("designGuide.propertyRow.created")}</span>
            <span className="text-xs">{t("designGuide.propertyRow.demoDate")}</span>
          </div>
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  NAVIGATION PATTERNS                                          */}
      {/* ============================================================ */}
      <Section title={t("designGuide.navigation.title")}>
        <SubSection title={t("designGuide.navigation.sidebarNavItems")}>
          <Card className="block w-60 p-3 space-y-0.5">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-accent text-accent-foreground">
              <LayoutDashboard className="h-4 w-4" />
              {t("designGuide.navigation.item.dashboard")}
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground cursor-pointer">
              <CircleDot className="h-4 w-4" />
              {t("designGuide.navigation.item.issues")}
              <Badge variant="ghost" className="ml-auto bg-primary text-primary-foreground px-1.5">
                12
              </Badge>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground cursor-pointer">
              <Bot className="h-4 w-4" />
              {t("designGuide.navigation.item.agents")}
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground cursor-pointer">
              <Hexagon className="h-4 w-4" />
              {t("designGuide.navigation.item.projects")}
            </div>
          </Card>
        </SubSection>

        <SubSection title={t("designGuide.navigation.viewToggle")}>
          <div className="flex items-center border border-border rounded-md w-fit">
            <button className="px-3 py-1.5 text-xs font-medium bg-accent text-foreground rounded-l-md">
              <ListTodo className="h-3.5 w-3.5 inline mr-1" />
              {t("designGuide.navigation.toggle.list")}
            </button>
            <button className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent/50 rounded-r-md">
              <Target className="h-3.5 w-3.5 inline mr-1" />
              {t("designGuide.navigation.toggle.org")}
            </button>
          </div>
        </SubSection>
      </Section>

      {/* ============================================================ */}
      {/*  GROUPED LIST (Issues pattern)                                */}
      {/* ============================================================ */}
      <Section title={t("designGuide.groupedList.title")}>
        <div>
          <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 rounded-t-md">
            <StatusIcon status="in_progress" />
            <span className="text-sm font-medium">{t("designGuide.groupedList.inProgress")}</span>
            <span className="text-xs text-muted-foreground ml-1">2</span>
          </div>
          <div className="border border-border rounded-b-md">
            {/* PAP-411: leading PriorityIcon hidden behind SHOW_TASK_PRIORITY_UI. */}
            <EntityRow
              leading={SHOW_TASK_PRIORITY_UI ? <PriorityIcon priority="high" /> : undefined}
              identifier="PAP-101"
              title="Build agent heartbeat system"
              onClick={() => {}}
            />
            <EntityRow
              leading={SHOW_TASK_PRIORITY_UI ? <PriorityIcon priority="medium" /> : undefined}
              identifier="PAP-102"
              title="Add cost tracking dashboard"
              onClick={() => {}}
            />
          </div>
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  COMMENT THREAD PATTERN                                       */}
      {/* ============================================================ */}
      <Section title={t("designGuide.commentThread.title")}>
        <div className="space-y-3 max-w-2xl">
          <h3 className="text-sm font-semibold">{t("designGuide.commentThread.heading", { count: 2 })}</h3>
          <div className="space-y-3">
            <div className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-muted-foreground">{t("designGuide.commentThread.author.agent")}</span>
                <span className="text-xs text-muted-foreground">{t("designGuide.commentThread.demoDate1")}</span>
              </div>
              <p className="text-sm">{t("designGuide.commentThread.body1")}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-muted-foreground">{t("designGuide.commentThread.author.human")}</span>
                <span className="text-xs text-muted-foreground">{t("designGuide.commentThread.demoDate2")}</span>
              </div>
              <p className="text-sm">{t("designGuide.commentThread.body2")}</p>
            </div>
          </div>
          <div className="space-y-2">
            <Textarea placeholder={t("designGuide.commentThread.placeholder")} rows={3} />
            <Button size="sm">{t("designGuide.commentThread.submit")}</Button>
          </div>
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  COST TABLE PATTERN                                           */}
      {/* ============================================================ */}
      <Section title={t("designGuide.costTable.title")}>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="border-b border-border bg-accent/20">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t("designGuide.costTable.header.model")}</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t("designGuide.costTable.header.tokens")}</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t("designGuide.costTable.header.cost")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="px-3 py-2">claude-sonnet-4-20250514</td>
                <td className="px-3 py-2 font-mono">1.2M</td>
                <td className="px-3 py-2 font-mono">$18.00</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-3 py-2">claude-haiku-4-20250506</td>
                <td className="px-3 py-2 font-mono">500k</td>
                <td className="px-3 py-2 font-mono">$1.25</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">{t("designGuide.costTable.total")}</td>
                <td className="px-3 py-2 font-mono">1.7M</td>
                <td className="px-3 py-2 font-mono font-medium">$19.25</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  SKELETONS                                                    */}
      {/* ============================================================ */}
      <Section title={t("designGuide.skeletons.title")}>
        <SubSection title={t("designGuide.skeletons.individual")}>
          <div className="space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-8 w-full max-w-sm" />
            <Skeleton className="h-20 w-full" />
          </div>
        </SubSection>

        <SubSection title={t("designGuide.skeletons.pageList")}>
          <div className="border border-border rounded-md p-4">
            <PageSkeleton variant="list" />
          </div>
        </SubSection>

        <SubSection title={t("designGuide.skeletons.pageDetail")}>
          <div className="border border-border rounded-md p-4">
            <PageSkeleton variant="detail" />
          </div>
        </SubSection>
      </Section>

      {/* ============================================================ */}
      {/*  SEPARATOR                                                    */}
      {/* ============================================================ */}
      <Section title={t("designGuide.separator.title")}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("designGuide.progressBars.horizontal")}</p>
          <Separator />
          <div className="flex items-center gap-4 h-8">
            <span className="text-sm">{t("designGuide.progressBars.left")}</span>
            <Separator orientation="vertical" />
            <span className="text-sm">{t("designGuide.progressBars.right")}</span>
          </div>
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  ICON REFERENCE                                               */}
      {/* ============================================================ */}
      {/*  TEAM CATALOG                                                 */}
      {/* ============================================================ */}
      <Section title={t("designGuide.teamCatalog.title")}>
        <p className="text-sm text-muted-foreground">
          {t("designGuide.teamCatalog.description")}
        </p>

        <SubSection title={t("designGuide.teamCatalog.teamRow")}>
          <div className="w-(--sz-28rem) rounded-md border border-border">
            <div className="px-3 py-2 text-(length:--text-micro) font-semibold uppercase tracking-wide text-muted-foreground">
              {t("designGuide.teamCatalog.bundled", { count: 1 })}
            </div>
            <TeamRow team={sampleTeam} selected onSelect={() => {}} />
            <div className="px-3 py-2 text-(length:--text-micro) font-semibold uppercase tracking-wide text-muted-foreground">
              {t("designGuide.teamCatalog.optional", { count: 2 })}
            </div>
            <TeamRow team={optionalTeam} selected={false} onSelect={() => {}} />
            <div className="px-3 py-2 text-(length:--text-micro) font-semibold uppercase tracking-wide text-muted-foreground">
              {t("designGuide.teamCatalog.installed", { count: 2 })}
            </div>
            <TeamRow team={sampleTeam} selected={false} onSelect={() => {}} installed={outOfDateInstalledState} />
            <TeamRow team={warnTeam} selected={false} onSelect={() => {}} installed={currentInstalledState} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("designGuide.teamCatalog.installedNote")}
          </p>
        </SubSection>

        <SubSection title={t("designGuide.teamCatalog.teamCard")}>
          <p className="text-xs text-muted-foreground">
            {t("designGuide.teamCatalog.teamCardDescription")}
          </p>
          <TeamCardShowcase />
        </SubSection>

        <SubSection title={t("designGuide.teamCatalog.teamHierarchyPreview")}>
          <div className="max-w-md">
            <TeamHierarchyPreview team={sampleTeam} />
          </div>
        </SubSection>

        <SubSection title={t("designGuide.teamCatalog.requiredSkillsList")}>
          <div className="max-w-xl">
            <RequiredSkillsList skills={sampleTeam.requiredSkills} />
          </div>
        </SubSection>

        <SubSection title={t("designGuide.teamCatalog.envInputsList")}>
          <div className="max-w-xl">
            <EnvInputsList inputs={sampleTeam.envInputs} />
          </div>
        </SubSection>

        <SubSection title={t("designGuide.teamCatalog.externalSourcesList")}>
          <div className="max-w-xl">
            <ExternalSourcesList sources={sampleTeam.sourceRefs} />
          </div>
        </SubSection>

        <SubSection title={t("designGuide.teamCatalog.sourcePolicyStep")}>
          <div className="max-w-xl rounded-md border border-border p-4">
            <StepSourcePolicy
              team={warnTeam}
              allowExternalSources={allowExternal}
              allowUnpinnedOptionalSources={allowUnpinned}
              allowLocalPathSources={allowLocalPath}
              onChange={(key, value) => {
                if (key === "external") setAllowExternal(value);
                if (key === "unpinned") setAllowUnpinned(value);
                if (key === "localPath") setAllowLocalPath(value);
              }}
            />
          </div>
        </SubSection>

        <SubSection title={t("designGuide.teamCatalog.skillPlanStep")}>
          <div className="max-w-xl rounded-md border border-border p-4">
            <StepSkillPlan team={sampleTeam} preparations={sampleSkillPreparations} />
          </div>
        </SubSection>
      </Section>

      {/* ============================================================ */}
      <Section title={t("designGuide.commonIcons.title")}>
        <div className="grid grid-cols-4 md:grid-cols-6 gap-4">
          {[
            ["Inbox", Inbox],
            ["ListTodo", ListTodo],
            ["CircleDot", CircleDot],
            ["Hexagon", Hexagon],
            ["Target", Target],
            ["LayoutDashboard", LayoutDashboard],
            ["Bot", Bot],
            ["DollarSign", DollarSign],
            ["History", History],
            ["Search", Search],
            ["Plus", Plus],
            ["Trash2", Trash2],
            ["Settings", Settings],
            ["User", User],
            ["Mail", Mail],
            ["Upload", Upload],
            ["Zap", Zap],
          ].map(([name, Icon]) => {
            const LucideIcon = Icon as React.FC<{ className?: string }>;
            return (
              <div key={name as string} className="flex flex-col items-center gap-1.5 p-2">
                <LucideIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-(length:--text-nano) text-muted-foreground font-mono">{name as string}</span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  KEYBOARD SHORTCUTS                                           */}
      {/* ============================================================ */}
      <Section title={t("designGuide.keyboardShortcuts.title")}>
        <div className="border border-border rounded-md divide-y divide-border text-sm">
          {[
            ["Cmd+K / Ctrl+K", t("designGuide.keyboardShortcuts.openCommandPalette")],
            ["C", t("designGuide.keyboardShortcuts.newIssue")],
            ["[", t("designGuide.keyboardShortcuts.toggleSidebar")],
            ["]", t("designGuide.keyboardShortcuts.togglePropertiesPanel")],

            ["Cmd+Enter / Ctrl+Enter", t("designGuide.keyboardShortcuts.submitMarkdownComment")],
          ].map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between px-4 py-2">
              <span className="text-muted-foreground">{desc}</span>
              <kbd className="px-2 py-0.5 text-xs font-mono bg-muted rounded border border-border">
                {key}
              </kbd>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("designGuide.issueOutput.title")}>
        <SubSection title={t("designGuide.issueOutput.multipleOutputs")}>
          <IssueOutputSection workProducts={DESIGN_GUIDE_OUTPUTS} />
        </SubSection>
        <SubSection title={t("designGuide.issueOutput.degradedOutput")}>
          <IssueOutputSection workProducts={DESIGN_GUIDE_DEGRADED_OUTPUTS} />
        </SubSection>
        <SubSection title={t("designGuide.issueOutput.empty")}>
          <p className="text-xs text-muted-foreground">
            {t("designGuide.issueOutput.emptyDescription")}
          </p>
        </SubSection>
      </Section>

      {/* ============================================================ */}
      {/*  TOOLS & ACCESS (PAP-10389)                                   */}
      {/* ============================================================ */}
      <Section title={t("designGuide.toolsAndAccess.title")}>
        <SubSection title={t("designGuide.toolsAndAccess.enforcementBannerDefault")}>
          <div className="space-y-3">
            <EnforcementBanner companyId="" forceVariant="default" recentDenialCount={0} />
            <EnforcementBanner companyId="" forceVariant="denied-detected" recentDenialCount={3} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("designGuide.toolsAndAccess.enforcementBannerDescription1")}
          </p>
        </SubSection>

        <SubSection title={t("designGuide.toolsAndAccess.enforcementBannerTones")}>
          <div className="space-y-3">
            <EnforcementBanner
              tone="info"
              title={t("designGuide.toolsAndAccess.effectiveAccessTitle")}
              body={t("designGuide.toolsAndAccess.effectiveAccessBody")}
            />
            <EnforcementBanner
              tone="warning"
              title={t("designGuide.toolsAndAccess.localStdioTitle")}
              body={t("designGuide.toolsAndAccess.localStdioBody")}
            />
            <EnforcementBanner
              tone="error"
              title={t("designGuide.toolsAndAccess.runtimeFailedTitle")}
              body={t("designGuide.toolsAndAccess.runtimeFailedBody")}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("designGuide.toolsAndAccess.enforcementBannerDescription2")}
          </p>
        </SubSection>

        <SubSection title={t("designGuide.toolsAndAccess.actionCardPending")}>
          <div className="grid gap-4 lg:grid-cols-2">
            <ActionCard
              toolName="slack.post_message"
              risk="medium"
              isWrite
              binding={{
                application: "Slack",
                manifestVersion: "2.4.1",
                connection: "https://slack.com/api · acme-workspace",
                catalogSha256: "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
                payloadSha256: "sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
              }}
              input={{ channel: "#launch", text: "Deploy v2 is live 🎉", unfurl_links: false }}
              reason="This tool can write to your workspace, so a human signs off before the agent posts."
              policyNumber={7}
              expiresInLabel="expires in 23h 51m"
            />
            <ActionCard
              variant="stale"
              toolName="slack.post_message"
              risk="medium"
              isWrite
              binding={{
                application: "Slack",
                manifestVersion: "2.4.1",
                connection: "https://slack.com/api · acme-workspace",
                catalogSha256: "sha256:7d793037a0760186574b0282f2f435e7a4b1b2b0b822cd15d6c15b0f00a0e3f1",
                previousCatalogSha256: "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
                payloadSha256: "sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
              }}
              input={{ channel: "#launch", text: "Deploy v2 is live 🎉", unfurl_links: false }}
              reason="This tool can write to your workspace, so a human signs off before the agent posts."
              policyNumber={7}
              expiresInLabel="expires in 18h 02m"
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("designGuide.toolsAndAccess.actionCardPendingDescription")}
          </p>
        </SubSection>

        <SubSection title={t("designGuide.toolsAndAccess.actionCardMobile")}>
          <div className="w-(--sz-390px) max-w-full rounded-xl border border-border bg-background p-3">
            <ActionCardMobile
              toolName="slack.post_message"
              risk="medium"
              isWrite
              binding={{
                application: "Slack",
                manifestVersion: "2.4.1",
                connection: "https://slack.com/api · acme-workspace",
                catalogSha256: "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
                payloadSha256: "sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
              }}
              input={{ channel: "#launch", text: "Deploy v2 is live 🎉" }}
              reason="This tool can write to your workspace, so a human signs off before the agent posts."
              policyNumber={7}
              expiresInLabel="expires in 23h 51m"
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("designGuide.toolsAndAccess.actionCardMobileDescription")}
          </p>
        </SubSection>

        <SubSection title={t("designGuide.toolsAndAccess.bindingsTable")}>
          <BindingsTable
            rows={[
              { label: "Application", value: "Slack · manifest v2.4.1" },
              { label: "Connection", value: "https://slack.com/api · acme-workspace", mono: true },
              { label: "Catalog", value: "sha256:9f86d081…f00a08", mono: true },
              { label: "Payload", value: "sha256:2c26b46b…66e7ae", mono: true },
            ]}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("designGuide.toolsAndAccess.bindingsTableDescription")}
          </p>
        </SubSection>

        <SubSection title={t("designGuide.toolsAndAccess.toolAccessStatusKeys")}>
          <div className="flex flex-wrap items-center gap-2">
            {[
              "allowed", "denied", "block", "require-approval", "redacted", "rate-limit",
              "deferred", "hidden", "quarantined", "healthy", "degraded", "runtime-error", "unchecked",
            ].map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("designGuide.toolsAndAccess.toolAccessStatusDescription")}
          </p>
        </SubSection>

        <SubSection title={t("designGuide.toolsAndAccess.emptyStateCanonical")}>
          <EmptyState
            icon={Inbox}
            message={t("designGuide.toolsAndAccess.emptyStateMessage")}
            description={t("designGuide.toolsAndAccess.emptyStateDescription")}
            action={t("designGuide.toolsAndAccess.emptyStateAction")}
            onAction={() => {}}
          />
        </SubSection>
      </Section>

      <Section title={t("designGuide.envVarsEditor.title")}>
        <p className="text-sm text-muted-foreground">
          {t("designGuide.envVarsEditor.description")}
        </p>
        <EnvironmentVariablesEditorShowcase />
      </Section>

      <Section title={t("designGuide.resizablePanels.title")}>
        <p className="text-sm text-muted-foreground">
          {t("designGuide.resizablePanels.description")}
        </p>
        <div className="h-48 max-w-2xl overflow-hidden rounded-md border border-border">
          <ResizablePanelGroup>
            <ResizablePanel id="a" minSize="120px" className="bg-muted/30">
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {t("designGuide.resizablePanels.panelA")}
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="b" minSize="120px" collapsible collapsedSize="40px" className="bg-muted/10">
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {t("designGuide.resizablePanels.panelB")}
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="c" minSize="120px" className="bg-muted/30">
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {t("designGuide.resizablePanels.panelC")}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  INLINE BANNER + BUILT-IN AGENTS                              */}
      {/* ============================================================ */}
      <Section title={t("designGuide.inlineBanner.title")}>
        <p className="text-sm text-muted-foreground">
          {t("designGuide.inlineBanner.description")}
        </p>
        <div className="space-y-3">
          <InlineBanner
            tone="info"
            title={t("designGuide.inlineBanner.builtInAgent")}
            actions={<Button variant="outline" size="sm">{t("designGuide.inlineBanner.resetToDefaults")}</Button>}
          >
            {t("designGuide.inlineBanner.builtInAgentBody")}
          </InlineBanner>
          <InlineBanner
            tone="warning"
            title={t("designGuide.inlineBanner.briefsPausedTitle")}
            actions={
              <>
                <Button variant="ghost" size="sm">{t("designGuide.inlineBanner.viewAgent")}</Button>
                <Button size="sm">{t("designGuide.inlineBanner.resumeAgent")}</Button>
              </>
            }
          >
            {t("designGuide.inlineBanner.briefsPausedBody")}
          </InlineBanner>
          <InlineBanner
            tone="danger"
            title={t("designGuide.inlineBanner.summaryFailedTitle")}
            actions={<Button size="sm">{t("designGuide.inlineBanner.retry")}</Button>}
          >
            {t("designGuide.inlineBanner.summaryFailedBody")}
          </InlineBanner>
          <InlineBanner tone="info" compact>
            {t("designGuide.inlineBanner.compactBody")}
          </InlineBanner>
        </div>
      </Section>

      <Section title={t("designGuide.builtInLifecycle.title")}>
        <p className="text-sm text-muted-foreground">
          {t("designGuide.builtInLifecycle.description1")}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <BuiltInLifecycleChip status="needs_setup" />
          <BuiltInLifecycleChip status="pending_approval" />
          <BuiltInLifecycleChip status="needs_setup" compact />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {t("designGuide.builtInLifecycle.description2")}
        </p>
      </Section>
    </div>
  );
}
