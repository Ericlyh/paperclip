import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "@/lib/router";
import {
  onboardingStepForCompany,
  shouldRouteAgentlessCompanyToOnboarding,
} from "../lib/onboarding-route";
import { useCompanyMission } from "../hooks/useCompanyMission";
import { claimOnboardingOffer } from "../lib/onboarding-auto-open";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard";
import { activityApi } from "../api/activity";
import { accessApi } from "../api/access";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { buildCompanyUserProfileMap } from "../lib/company-members";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/EmptyState";
import { StatusIcon } from "../components/StatusIcon";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";

import { ActivityRow } from "../components/ActivityRow";
import { Identity } from "../components/Identity";
import { timeAgo } from "../lib/timeAgo";
import { useTranslation } from "../i18n";
import { cn, formatCents } from "../lib/utils";
import { Bot, CircleDot, DollarSign, ShieldCheck, LayoutDashboard, PauseCircle } from "lucide-react";
import { ActiveAgentsPanel } from "../components/ActiveAgentsPanel";
import { ChartCard, RunActivityChart, PriorityChart, IssueStatusChart, SuccessRateChart } from "../components/ActivityCharts";
import { PageSkeleton } from "../components/PageSkeleton";
import type { Agent, Issue } from "@paperclipai/shared";
import { PluginSlotOutlet } from "@/plugins/slots";
import {
  DASHBOARD_ACTIVITY_FETCH_LIMIT,
  DASHBOARD_ISSUE_FETCH_LIMIT,
  getRecentDashboardActivity,
  getRecentDashboardIssues,
} from "../lib/dashboard-feed";
import { isProductivityReviewIssue } from "../lib/issue-filters";

// Auto-generated "Review productivity for OOP-*" issues carry this origin kind.
// They are internal bookkeeping and should not clutter the dashboard surfaces
// by default, but the user can toggle them off via "Hide productivity-review
// issues". The helper lives in ui/src/lib/issue-filters.ts.
const DASHBOARD_FILTER_STORAGE_PREFIX = "paperclip:dashboard-filters";

type DashboardFilterState = {
  hideLintResidualTasks: boolean;
  hideProductivityReviewIssues: boolean;
  hideHourlyLogRotationTasks: boolean;
  hidePrefixedTasks: boolean;
};

const DEFAULT_DASHBOARD_FILTER_STATE: DashboardFilterState = {
  hideLintResidualTasks: false,
  hideProductivityReviewIssues: true,
  hideHourlyLogRotationTasks: false,
  hidePrefixedTasks: false,
};

function dashboardFilterStorageKey(companyId: string): string {
  return `${DASHBOARD_FILTER_STORAGE_PREFIX}:${companyId}`;
}

function readDashboardFilterState(companyId: string | null | undefined): DashboardFilterState {
  if (!companyId || typeof window === "undefined") return { ...DEFAULT_DASHBOARD_FILTER_STATE };
  try {
    const raw = window.localStorage.getItem(dashboardFilterStorageKey(companyId));
    if (!raw) return { ...DEFAULT_DASHBOARD_FILTER_STATE };
    const parsed = JSON.parse(raw) as Partial<DashboardFilterState>;
    return {
      hideLintResidualTasks: parsed.hideLintResidualTasks === true,
      hideProductivityReviewIssues:
        parsed.hideProductivityReviewIssues === undefined
          ? DEFAULT_DASHBOARD_FILTER_STATE.hideProductivityReviewIssues
          : parsed.hideProductivityReviewIssues === true,
      hideHourlyLogRotationTasks: parsed.hideHourlyLogRotationTasks === true,
      hidePrefixedTasks: parsed.hidePrefixedTasks === true,
    };
  } catch {
    return { ...DEFAULT_DASHBOARD_FILTER_STATE };
  }
}

function DashboardVisibilityFilters({
  filterState,
  onChange,
  testIdPrefix,
}: {
  filterState: DashboardFilterState;
  onChange: (patch: Partial<DashboardFilterState>) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <label
        className="inline-flex cursor-pointer items-center gap-2 hover:text-foreground"
        title="Hide auto-generated Review productivity issues"
      >
        <Checkbox
          checked={filterState.hideProductivityReviewIssues}
          onCheckedChange={(checked) => onChange({ hideProductivityReviewIssues: checked === true })}
          data-testid={`${testIdPrefix}-productivity-review-filter`}
        />
        <span>Hide productivity-review issues</span>
      </label>
      <label
        className="inline-flex cursor-pointer items-center gap-2 hover:text-foreground"
        title="Hide tasks whose title starts with Paperclip: Close lint residuals on PR merge"
      >
        <Checkbox
          checked={filterState.hideLintResidualTasks}
          onCheckedChange={(checked) => onChange({ hideLintResidualTasks: checked === true })}
          data-testid={`${testIdPrefix}-lint-residual-filter`}
        />
        <span>Hide lint-residual tasks</span>
      </label>
      <label
        className="inline-flex cursor-pointer items-center gap-2 hover:text-foreground"
        title="Hide tasks whose title starts with Paperclip: Hourly Log Rotation"
      >
        <Checkbox
          checked={filterState.hideHourlyLogRotationTasks}
          onCheckedChange={(checked) => onChange({ hideHourlyLogRotationTasks: checked === true })}
          data-testid={`${testIdPrefix}-hourly-log-rotation-filter`}
        />
        <span>Hide hourly-log-rotation tasks</span>
      </label>
      <label
        className="inline-flex cursor-pointer items-center gap-2 hover:text-foreground"
        title='Hide tasks whose title starts with "Paperclip:" or "Lint:"'
      >
        <Checkbox
          checked={filterState.hidePrefixedTasks}
          onCheckedChange={(checked) => onChange({ hidePrefixedTasks: checked === true })}
          data-testid={`${testIdPrefix}-prefixed-tasks-filter`}
        />
        <span>Hide Paperclip:/Lint: prefixed tasks</span>
      </label>
    </div>
  );
}

export function Dashboard() {
  const { selectedCompanyId, companies } = useCompany();
  const { openOnboarding } = useDialogActions();
  const location = useLocation();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { t } = useTranslation();
  const [animatedActivityIds, setAnimatedActivityIds] = useState<Set<string>>(new Set());
  const [filterState, setFilterState] = useState<DashboardFilterState>({
    ...DEFAULT_DASHBOARD_FILTER_STATE,
  });
  const seenActivityIdsRef = useRef<Set<string>>(new Set());
  const hydratedActivityRef = useRef(false);
  const activityAnimationTimersRef = useRef<number[]>([]);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  // A company with no agent cannot do anything — no runs, no tasks, nothing
  // to show. The banner below already says so and offers a link; this takes
  // the customer there instead of asking them to notice.
  //
  // It also closes the gap a Cloud-provisioned stack falls into. Cloud creates
  // the company before the tenant boots, so the companyless redirect never
  // fires and a seeded customer lands here, on an empty dashboard, straight
  // out of signup.
  //
  // Opened as the dialog rather than navigated to: the wizard is already
  // mounted globally, so there is no route to race and no redirect to loop.
  // Placed with the other hooks — the early returns below mean anything
  // further down would be called conditionally.
  //
  // The company and the step are both passed. Opening with empty options would
  // start the wizard at the front door with no company, and the new-company
  // path there would create a *second* company instead of giving this one an
  // agent.
  const { hasMission: companyHasMission, settled: missionSettled } =
    useCompanyMission(selectedCompanyId);
  const shouldOpenOnboarding = shouldRouteAgentlessCompanyToOnboarding({
    pathname: location.pathname,
    agentsLoaded: agents !== undefined,
    agentCount: agents?.length ?? 0,
  });
  // Auto-open once per company. Every input to the effect sits behind a query,
  // so a refetch re-runs it, and the customer can also navigate away and come
  // back — both would otherwise call `openOnboarding` again and reopen a
  // wizard that was deliberately closed. `claimOnboardingOffer` holds the
  // companies already offered; see it for why that outlives this component.
  useEffect(() => {
    if (!shouldOpenOnboarding || !selectedCompanyId) return;
    // Wait for the mission lookup to settle before opening: the wizard applies
    // the step it is given once, so a step chosen before the answer is in is
    // the step the customer is left on.
    if (!missionSettled) return;
    if (!claimOnboardingOffer(selectedCompanyId)) return;
    openOnboarding({
      companyId: selectedCompanyId,
      initialStep: onboardingStepForCompany(companyHasMission),
    });
  }, [shouldOpenOnboarding, selectedCompanyId, missionSettled, companyHasMission, openOnboarding]);

  useEffect(() => {
    setBreadcrumbs([{ label: t("dashboard.title") }]);
  }, [setBreadcrumbs, t]);

  useEffect(() => {
    setFilterState(readDashboardFilterState(selectedCompanyId));
  }, [selectedCompanyId]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: activity } = useQuery({
    queryKey: [...queryKeys.activity(selectedCompanyId!), { limit: DASHBOARD_ACTIVITY_FETCH_LIMIT }],
    queryFn: () => activityApi.list(selectedCompanyId!, { limit: DASHBOARD_ACTIVITY_FETCH_LIMIT }),
    enabled: !!selectedCompanyId,
  });

  const { data: issues } = useQuery({
    queryKey: [
      ...queryKeys.issues.list(selectedCompanyId!),
      "dashboard",
      { limit: DASHBOARD_ISSUE_FETCH_LIMIT, sortField: "updated", sortDir: "desc" },
    ],
    queryFn: () => issuesApi.list(selectedCompanyId!, {
      limit: DASHBOARD_ISSUE_FETCH_LIMIT,
      sortField: "updated",
      sortDir: "desc",
    }),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: companyMembers } = useQuery({
    queryKey: queryKeys.access.companyUserDirectory(selectedCompanyId!),
    queryFn: () => accessApi.listUserDirectory(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const userProfileMap = useMemo(
    () => buildCompanyUserProfileMap(companyMembers?.users),
    [companyMembers?.users],
  );

  // Filter dashboard issue surfaces (recent list + charts). Raw `issues` is
  // still used for activity-feed labels. Productivity-review suppression is
  // toggled by `filterState.hideProductivityReviewIssues` (default ON to keep
  // the prior "internal bookkeeping, should not clutter surfaces" behaviour).
  const visibleIssues = useMemo(
    () => (issues ?? []).filter((issue) => !filterState.hideProductivityReviewIssues || !isProductivityReviewIssue(issue)),
    [issues, filterState.hideProductivityReviewIssues],
  );

  const issueById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues ?? []) map.set(issue.id, issue);
    return map;
  }, [issues]);

  const recentIssues = useMemo(
    () =>
      getRecentDashboardIssues(
        visibleIssues,
        filterState.hideLintResidualTasks,
        filterState.hideProductivityReviewIssues,
        filterState.hideHourlyLogRotationTasks,
        filterState.hidePrefixedTasks,
      ),
    [
      visibleIssues,
      filterState.hideLintResidualTasks,
      filterState.hideProductivityReviewIssues,
      filterState.hideHourlyLogRotationTasks,
      filterState.hidePrefixedTasks,
    ],
  );
  const recentActivity = useMemo(
    () =>
      getRecentDashboardActivity(
        activity ?? [],
        issueById,
        filterState.hideLintResidualTasks,
        filterState.hideProductivityReviewIssues,
        filterState.hideHourlyLogRotationTasks,
        filterState.hidePrefixedTasks,
      ),
    [
      activity,
      issueById,
      filterState.hideLintResidualTasks,
      filterState.hideProductivityReviewIssues,
      filterState.hideHourlyLogRotationTasks,
      filterState.hidePrefixedTasks,
    ],
  );

  useEffect(() => {
    for (const timer of activityAnimationTimersRef.current) {
      window.clearTimeout(timer);
    }
    activityAnimationTimersRef.current = [];
    seenActivityIdsRef.current = new Set();
    hydratedActivityRef.current = false;
    setAnimatedActivityIds(new Set());
  }, [selectedCompanyId]);

  useEffect(() => {
    if (recentActivity.length === 0) return;

    const seen = seenActivityIdsRef.current;
    const currentIds = recentActivity.map((event) => event.id);

    if (!hydratedActivityRef.current) {
      for (const id of currentIds) seen.add(id);
      hydratedActivityRef.current = true;
      return;
    }

    const newIds = currentIds.filter((id) => !seen.has(id));
    if (newIds.length === 0) {
      for (const id of currentIds) seen.add(id);
      return;
    }

    setAnimatedActivityIds((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });

    for (const id of newIds) seen.add(id);

    const timer = window.setTimeout(() => {
      setAnimatedActivityIds((prev) => {
        const next = new Set(prev);
        for (const id of newIds) next.delete(id);
        return next;
      });
      activityAnimationTimersRef.current = activityAnimationTimersRef.current.filter((t) => t !== timer);
    }, 980);
    activityAnimationTimersRef.current.push(timer);
  }, [recentActivity]);

  useEffect(() => {
    return () => {
      for (const timer of activityAnimationTimersRef.current) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.identifier ?? i.id.slice(0, 8));
    for (const a of agents ?? []) map.set(`agent:${a.id}`, a.name);
    for (const p of projects ?? []) map.set(`project:${p.id}`, p.name);
    return map;
  }, [issues, agents, projects]);

  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.title);
    return map;
  }, [issues]);

  const agentName = (id: string | null) => {
    if (!id || !agents) return null;
    return agents.find((a) => a.id === id)?.name ?? null;
  };

  const updateDashboardFilter = (patch: Partial<DashboardFilterState>) => {
    setFilterState((prev) => {
      const next = { ...prev, ...patch };
      if (selectedCompanyId && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(dashboardFilterStorageKey(selectedCompanyId), JSON.stringify(next));
        } catch {
          // Ignore localStorage failures; the current view still updates.
        }
      }
      return next;
    });
  };

  if (!selectedCompanyId) {
    if (companies.length === 0) {
      return (
        <EmptyState
          icon={LayoutDashboard}
          title={t("dashboard.welcomeTitle")}
          message={t("dashboard.welcomeMessage")}
          action={t("dashboard.getStarted")}
          onAction={openOnboarding}
        />
      );
    }
    return (
      <EmptyState icon={LayoutDashboard} message={t("dashboard.selectCompany")} />
    );
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const hasNoAgents = agents !== undefined && agents.length === 0;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {hasNoAgents && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/25 dark:bg-amber-950/60">
          <div className="flex items-center gap-2.5">
            <Bot className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm text-amber-900 dark:text-amber-100">
              {t("dashboard.noAgentsAlert")}
            </p>
          </div>
          <button
            onClick={() => openOnboarding({ initialStep: 2, companyId: selectedCompanyId! })}
            className="text-sm font-medium text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 underline underline-offset-2 shrink-0"
          >
            {t("dashboard.createAgentHere")}
          </button>
        </div>
      )}

      <ActiveAgentsPanel companyId={selectedCompanyId!} />

      {data && (
        <>
          {data.budgets.activeIncidents > 0 ? (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-red-500/20 bg-[linear-gradient(180deg,rgba(255,80,80,0.12),rgba(255,255,255,0.02))] px-4 py-3">
              <div className="flex items-start gap-2.5">
                <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                <div>
                  <p className="text-sm font-medium text-red-950 dark:text-red-50">
                    {t("dashboard.activeIncidents", { count: data.budgets.activeIncidents })}
                  </p>
                  <p className="text-xs text-red-900/70 dark:text-red-100/70">
                    {t("dashboard.agentsPaused", { count: data.budgets.pausedAgents })} · {t("dashboard.projectsPaused", { count: data.budgets.pausedProjects })} · {t("dashboard.pendingBudgetApprovals", { count: data.budgets.pendingApprovals })}
                  </p>
                </div>
              </div>
              <Link to="/costs" className="text-sm underline underline-offset-2 text-red-100">
                Open budgets
              </Link>
            </div>
          ) : null}

          <div className="grid grid-cols-2 xl:grid-cols-4 gap-1 sm:gap-2">
            <MetricCard
              icon={Bot}
              value={data.agents.active + data.agents.running + data.agents.paused + data.agents.error}
              label={t("dashboard.metricAgents")}
              to="/agents"
              description={
                <span>
                  {t("dashboard.running", { count: data.agents.running })}{", "}
                  {t("dashboard.paused", { count: data.agents.paused })}{", "}
                  {t("dashboard.errors", { count: data.agents.error })}
                </span>
              }
            />
            <MetricCard
              icon={CircleDot}
              value={data.tasks.inProgress}
              label={t("dashboard.metricTasks")}
              to="/issues"
              description={
                <span>
                  {t("dashboard.open", { count: data.tasks.open })}{", "}
                  {t("dashboard.blocked", { count: data.tasks.blocked })}
                </span>
              }
            />
            <MetricCard
              icon={DollarSign}
              value={formatCents(data.costs.monthSpendCents)}
              label={t("dashboard.metricSpend")}
              to="/costs"
              description={
                <span>
                  {data.costs.monthBudgetCents > 0
                    ? t("dashboard.budgetPercent", { percent: data.costs.monthUtilizationPercent, budget: formatCents(data.costs.monthBudgetCents) })
                    : t("dashboard.unlimitedBudget")}
                </span>
              }
            />
            <MetricCard
              icon={ShieldCheck}
              value={data.pendingApprovals + data.budgets.pendingApprovals}
              label={t("dashboard.metricApprovals")}
              to="/approvals"
              description={
                <span>
                  {data.budgets.pendingApprovals > 0
                    ? t("dashboard.budgetOverridesAwaiting", { count: data.budgets.pendingApprovals })
                    : t("dashboard.awaitingBoardReview")}
                </span>
              }
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <ChartCard title={t("dashboard.runActivity")} subtitle={t("dashboard.last14Days")}>
              <RunActivityChart activity={data.runActivity} />
            </ChartCard>
            <ChartCard title={t("dashboard.tasksByPriority")} subtitle={t("dashboard.last14Days")}>
              <PriorityChart issues={visibleIssues} />
            </ChartCard>
            <ChartCard title={t("dashboard.tasksByStatus")} subtitle={t("dashboard.last14Days")}>
              <IssueStatusChart issues={visibleIssues} />
            </ChartCard>
            <ChartCard title={t("dashboard.successRate")} subtitle={t("dashboard.last14Days")}>
              <SuccessRateChart activity={data.runActivity} />
            </ChartCard>
          </div>

          <PluginSlotOutlet
            slotTypes={["dashboardWidget"]}
            context={{ companyId: selectedCompanyId }}
            className="grid gap-4 md:grid-cols-2"
            itemClassName="rounded-lg border bg-card p-4 shadow-sm"
          />

          <div className="grid md:grid-cols-2 gap-4">
            {/* Recent Activity */}
            {recentActivity.length > 0 && (
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  {t("dashboard.recentActivity")}
                </h3>
                <div className="border border-border divide-y divide-border overflow-hidden">
                  {recentActivity.map((event) => (
                    <ActivityRow
                      key={event.id}
                      event={event}
                      agentMap={agentMap}
                      userProfileMap={userProfileMap}
                      entityNameMap={entityNameMap}
                      entityTitleMap={entityTitleMap}
                      className={animatedActivityIds.has(event.id) ? "activity-row-enter" : undefined}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Recent Tasks */}
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {t("dashboard.recentTasks")}
                </h3>
                <DashboardVisibilityFilters
                  filterState={filterState}
                  onChange={updateDashboardFilter}
                  testIdPrefix="dashboard-recent-tasks"
                />
              </div>
              {recentIssues.length === 0 ? (
                <Card className="block p-4">
                  <p className="text-sm text-muted-foreground">{t("dashboard.noTasksYet")}</p>
                </Card>
              ) : (
                <div className="border border-border divide-y divide-border overflow-hidden">
                  {recentIssues.map((issue) => (
                    <Link
                      key={issue.id}
                      to={`/issues/${issue.identifier ?? issue.id}`}
                      className="px-4 py-3 text-sm cursor-pointer hover:bg-accent/50 transition-colors no-underline text-inherit block"
                    >
                      <div className="flex items-start gap-2 sm:items-center sm:gap-3">
                        {/* Status icon - left column on mobile */}
                        <span className="shrink-0 sm:hidden">
                          <StatusIcon status={issue.status} blockerAttention={issue.blockerAttention} />
                        </span>

                        {/* Right column on mobile: title + metadata stacked */}
                        <span className="flex min-w-0 flex-1 flex-col gap-1 sm:contents">
                          <span className="line-clamp-2 text-sm sm:order-2 sm:flex-1 sm:min-w-0 sm:line-clamp-none sm:truncate">
                            {issue.title}
                          </span>
                          <span className="flex items-center gap-2 sm:order-1 sm:shrink-0">
                            <span className="hidden sm:inline-flex"><StatusIcon status={issue.status} blockerAttention={issue.blockerAttention} /></span>
                            <span className="text-xs font-mono text-muted-foreground">
                              {issue.identifier ?? issue.id.slice(0, 8)}
                            </span>
                            {issue.assigneeAgentId && (() => {
                              const name = agentName(issue.assigneeAgentId);
                              return name
                                ? <span className="hidden sm:inline-flex"><Identity name={name} size="sm" /></span>
                                : null;
                            })()}
                            <span className="text-xs text-muted-foreground sm:hidden">&middot;</span>
                            <span className="text-xs text-muted-foreground shrink-0 sm:order-last">
                              {timeAgo(issue.updatedAt)}
                            </span>
                          </span>
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

        </>
      )}
    </div>
  );
}
