import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Folder,
  GitBranch,
  Hash,
  Lightbulb,
  Network,
  ScrollText,
  Users,
} from "lucide-react";
import type {
  WorkspaceContextBundle,
  WorkspaceContextDecisionSummary,
  WorkspaceContextDocumentSummary,
  WorkspaceContextIssueSummary,
  WorkspaceContextRunSummary,
} from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { ApiError } from "../api/client";
import { workspaceContextApi } from "../api/workspaceContext";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "../i18n";
import { queryKeys } from "../lib/queryKeys";

type Props = {
  issueId: string;
};

const SUMMARY_LABEL_KEYS: Record<keyof WorkspaceContextBundle["summary"], string> = {
  issueCount: "issues.title",
  openIssueCount: "status.open",
  decisionCount: "sidebar.decisions",
  documentCount: "workspaceContext.documents",
  runCount: "workspaceContext.runs",
  memberCount: "companyAccess.breadcrumb",
  generatedAt: "workspaceContext.generated",
};

function hasNoProjectError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 404 &&
    typeof err.body === "object" &&
    err.body !== null &&
    (err.body as { error?: string }).error === "issue_has_no_project"
  );
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return (
    <Badge variant="outline" className="border-border bg-muted/40 text-muted-foreground">
      {status}
    </Badge>
  );
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <p className="rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
      {label}
    </p>
  );
}

function ProjectHeader({
  bundle,
}: {
  bundle: WorkspaceContextBundle;
}) {
  const { t } = useTranslation();
  const project = bundle.project;
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {project ? project.name : t("workspaceContext.projectNotFound")}
          </h3>
          {project?.description ? (
            <p className="text-xs text-muted-foreground">{project.description}</p>
          ) : null}
        </div>
        {project ? <StatusBadge status={project.status} /> : null}
      </div>
      {project?.urlKey ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">/{project.urlKey}</span>
        </p>
      ) : null}
    </section>
  );
}

function SummaryPanel({ bundle }: { bundle: WorkspaceContextBundle }) {
  const { t } = useTranslation();
  const entries: Array<[keyof typeof SUMMARY_LABEL_KEYS, string | number]> = [
    ["issueCount", bundle.summary.issueCount],
    ["openIssueCount", bundle.summary.openIssueCount],
    ["decisionCount", bundle.summary.decisionCount],
    ["documentCount", bundle.summary.documentCount],
    ["runCount", bundle.summary.runCount],
    ["memberCount", bundle.summary.memberCount],
  ];
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h3 className="text-sm font-semibold">{t("workspaceContext.summary")}</h3>
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        {entries.map(([key, value]) => (
          <div key={key} className="space-y-0.5">
            <dt className="text-muted-foreground">{t(SUMMARY_LABEL_KEYS[key])}</dt>
            <dd className="font-mono text-sm text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-(length:--text-micro) text-muted-foreground">
        {t("workspaceContext.generatedAt", { value: formatTimestamp(bundle.summary.generatedAt) })}
      </p>
    </section>
  );
}

function IssuesList({ items }: { items: WorkspaceContextIssueSummary[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return <EmptyBlock label={t("workspaceContext.noRecentIssues")} />;
  return (
    <ul className="-mx-1 flex flex-col">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md px-1 py-1.5 hover:bg-accent/40"
        >
          <Link
            to={`/issues/${item.id}`}
            className="text-xs font-mono text-foreground hover:underline"
          >
            {item.identifier ?? item.id.slice(0, 8)}
          </Link>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {item.title}
          </span>
          <StatusBadge status={item.status} />
        </li>
      ))}
    </ul>
  );
}

function DecisionsList({ items }: { items: WorkspaceContextDecisionSummary[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return <EmptyBlock label={t("workspaceContext.noRecentDecisions")} />;
  return (
    <ul className="-mx-1 flex flex-col">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md px-1 py-1.5 hover:bg-accent/40"
        >
          <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
          <StatusBadge status={item.status ?? item.executionStatus ?? undefined} />
          {item.originIssueIdentifier ? (
            <span className="text-xs text-muted-foreground font-mono">
              {item.originIssueIdentifier}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function DocumentsList({ items }: { items: WorkspaceContextDocumentSummary[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return <EmptyBlock label={t("workspaceContext.noRecentDocuments")} />;
  return (
    <ul className="-mx-1 flex flex-col">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md px-1 py-1.5 hover:bg-accent/40"
        >
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {item.title ?? t("workspaceContext.untitledDocument")}
          </span>
          {item.format ? (
            <span className="text-xs text-muted-foreground">{item.format}</span>
          ) : null}
          {typeof item.latestRevisionNumber === "number" ? (
            <span className="text-xs text-muted-foreground">
              {t("workspaceContext.revision", { value: item.latestRevisionNumber })}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function RunsList({ items }: { items: WorkspaceContextRunSummary[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return <EmptyBlock label={t("workspaceContext.noRecentRuns")} />;
  return (
    <ul className="-mx-1 flex flex-col">
      {items.map((item) => (
        <li
          key={item.runId}
          className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md px-1 py-1.5 hover:bg-accent/40"
        >
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {item.agentName ?? item.agentId?.slice(0, 8) ?? "run"}
          </span>
          <StatusBadge status={item.status ?? undefined} />
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(item.startedAt ?? item.createdAt ?? undefined)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function MembersPanel({
  members,
}: {
  members: WorkspaceContextBundle["members"];
}) {
  const { t } = useTranslation();
  const hasAny = members.users.length > 0 || members.agents.length > 0;
  if (!hasAny) return <EmptyBlock label={t("workspaceContext.noMembers")} />;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-muted-foreground">{t("workspaceContext.users")}</h4>
        {members.users.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("workspaceContext.noHumanMembers")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {members.users.map((member) => (
              <li key={member.id}>
                <Badge variant="outline" className="border-border bg-muted/40">
                  <Users className="mr-1 h-3 w-3" />
                  {member.name}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-muted-foreground">{t("companyAccess.removeDialog.agentsGroup")}</h4>
        {members.agents.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("workspaceContext.noAgentMembers")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {members.agents.map((member) => (
              <li key={member.id}>
                <Badge variant="outline" className="border-border bg-muted/40">
                  <Network className="mr-1 h-3 w-3" />
                  {member.name}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function BundleSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function BundleError({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {message}
    </div>
  );
}

function NoProjectPlaceholder() {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-muted/30 px-4 py-6 text-center">
      <Folder className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">{t("workspaceContext.noProjectLinkage")}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("workspaceContext.noProjectLinkageBody")}
      </p>
    </div>
  );
}

export function IssueWorkspaceContextTab({ issueId }: Props) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: queryKeys.issues.workspaceContext(issueId),
    queryFn: () => workspaceContextApi.forIssue(issueId),
    retry: (failureCount, err) => !hasNoProjectError(err) && failureCount < 2,
  });

  if (hasNoProjectError(query.error)) {
    return <NoProjectPlaceholder />;
  }
  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <BundleSkeleton />
      </div>
    );
  }
  if (query.isError) {
    return (
      <BundleError
        message={
          query.error instanceof Error
            ? query.error.message
            : t("workspaceContext.loadFailed")
        }
      />
    );
  }
  const bundle = query.data;
  if (!bundle) {
    return <BundleError message={t("workspaceContext.bundleEmpty")} />;
  }

  return (
    <div className="space-y-4">
      <ProjectHeader bundle={bundle} />
      <SummaryPanel bundle={bundle} />

      <section className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center gap-1.5">
          <Hash className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t("workspaceContext.recentIssues")}</h3>
        </div>
        <IssuesList items={bundle.recentIssues} />
      </section>

      <section className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t("workspaceContext.recentDecisions")}</h3>
        </div>
        <DecisionsList items={bundle.recentDecisions} />
      </section>

      <section className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center gap-1.5">
          <ScrollText className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t("workspaceContext.recentDocuments")}</h3>
        </div>
        <DocumentsList items={bundle.recentDocuments} />
      </section>

      <section className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t("routines.recentRuns")}</h3>
        </div>
        <RunsList items={bundle.recentRuns} />
      </section>

      <section className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t("companyAccess.breadcrumb")}</h3>
        </div>
        <MembersPanel members={bundle.members} />
      </section>
    </div>
  );
}
