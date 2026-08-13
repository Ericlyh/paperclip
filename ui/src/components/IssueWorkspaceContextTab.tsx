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
import { queryKeys } from "../lib/queryKeys";

type Props = {
  issueId: string;
};

const SUMMARY_LABELS: Record<keyof WorkspaceContextBundle["summary"], string> = {
  issueCount: "Issues",
  openIssueCount: "Open",
  decisionCount: "Decisions",
  documentCount: "Documents",
  runCount: "Runs",
  memberCount: "Members",
  generatedAt: "Generated",
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
  const project = bundle.project;
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {project ? project.name : "Project not found"}
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
  const entries: Array<[keyof typeof SUMMARY_LABELS, string | number]> = [
    ["issueCount", bundle.summary.issueCount],
    ["openIssueCount", bundle.summary.openIssueCount],
    ["decisionCount", bundle.summary.decisionCount],
    ["documentCount", bundle.summary.documentCount],
    ["runCount", bundle.summary.runCount],
    ["memberCount", bundle.summary.memberCount],
  ];
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h3 className="text-sm font-semibold">Summary</h3>
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        {entries.map(([key, value]) => (
          <div key={key} className="space-y-0.5">
            <dt className="text-muted-foreground">{SUMMARY_LABELS[key]}</dt>
            <dd className="font-mono text-sm text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-(length:--text-micro) text-muted-foreground">
        Generated {formatTimestamp(bundle.summary.generatedAt)}
      </p>
    </section>
  );
}

function IssuesList({ items }: { items: WorkspaceContextIssueSummary[] }) {
  if (items.length === 0) return <EmptyBlock label="No recent project issues." />;
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
  if (items.length === 0) return <EmptyBlock label="No recent decisions." />;
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
  if (items.length === 0) return <EmptyBlock label="No recent documents." />;
  return (
    <ul className="-mx-1 flex flex-col">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md px-1 py-1.5 hover:bg-accent/40"
        >
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {item.title ?? "(untitled document)"}
          </span>
          {item.format ? (
            <span className="text-xs text-muted-foreground">{item.format}</span>
          ) : null}
          {typeof item.latestRevisionNumber === "number" ? (
            <span className="text-xs text-muted-foreground">
              rev {item.latestRevisionNumber}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function RunsList({ items }: { items: WorkspaceContextRunSummary[] }) {
  if (items.length === 0) return <EmptyBlock label="No recent heartbeat runs." />;
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
  const hasAny = members.users.length > 0 || members.agents.length > 0;
  if (!hasAny) return <EmptyBlock label="No members associated with this project yet." />;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-muted-foreground">Users</h4>
        {members.users.length === 0 ? (
          <p className="text-xs text-muted-foreground">No human members.</p>
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
        <h4 className="text-xs font-semibold text-muted-foreground">Agents</h4>
        {members.agents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No agent members.</p>
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
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-muted/30 px-4 py-6 text-center">
      <Folder className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">No project linkage</p>
      <p className="mt-1 text-xs text-muted-foreground">
        This issue isn&apos;t assigned to a project, so a Workspace context bundle can&apos;t be
        assembled. Assign the issue to a project to surface its institutional memory here.
      </p>
    </div>
  );
}

export function IssueWorkspaceContextTab({ issueId }: Props) {
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
            : "Failed to load workspace context."
        }
      />
    );
  }
  const bundle = query.data;
  if (!bundle) {
    return <BundleError message="Workspace context bundle was empty." />;
  }

  return (
    <div className="space-y-4">
      <ProjectHeader bundle={bundle} />
      <SummaryPanel bundle={bundle} />

      <section className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center gap-1.5">
          <Hash className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Recent issues</h3>
        </div>
        <IssuesList items={bundle.recentIssues} />
      </section>

      <section className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Recent decisions</h3>
        </div>
        <DecisionsList items={bundle.recentDecisions} />
      </section>

      <section className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center gap-1.5">
          <ScrollText className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Recent documents</h3>
        </div>
        <DocumentsList items={bundle.recentDocuments} />
      </section>

      <section className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Recent runs</h3>
        </div>
        <RunsList items={bundle.recentRuns} />
      </section>

      <section className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Members</h3>
        </div>
        <MembersPanel members={bundle.members} />
      </section>
    </div>
  );
}
