import { Eye } from "lucide-react";
import type { IssueProductivityReview } from "@paperclipai/shared";
import { Link } from "../lib/router";
import { cn } from "../lib/utils";
import { createIssueDetailPath } from "../lib/issueDetailBreadcrumb";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { t as i18nT, useTranslation } from "../i18n";

export function productivityReviewTriggerLabel(
  trigger: IssueProductivityReview["trigger"],
): string {
  if (!trigger) return i18nT("productivityReview.fallback");
  const labels: Record<string, string> = {
    no_comment_streak: i18nT("productivityReview.trigger.noCommentStreak"),
    long_active_duration: i18nT("productivityReview.trigger.longActiveDuration"),
    high_churn: i18nT("productivityReview.trigger.highChurn"),
  };
  return labels[trigger] ?? i18nT("productivityReview.fallback");
}

export function ProductivityReviewBadge({
  review,
  className,
  hideLabel = false,
}: {
  review: IssueProductivityReview;
  className?: string;
  hideLabel?: boolean;
}) {
  const { t } = useTranslation();
  const reviewStatusLabels: Record<string, string> = {
    todo: t("common.open"),
    in_progress: t("productivityReview.status.inProgress"),
    in_review: t("productivityReview.status.inReview"),
    blocked: t("issues.status.blocked"),
    backlog: t("common.open"),
  };
  const label = productivityReviewTriggerLabel(review.trigger);
  const reviewIdentifier = review.reviewIdentifier ?? review.reviewIssueId.slice(0, 8);
  const reviewPath = createIssueDetailPath(review.reviewIdentifier ?? review.reviewIssueId);
  const statusLabel = reviewStatusLabels[review.status] ?? review.status.replace(/_/g, " ");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={reviewPath}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-(length:--text-nano) font-medium text-amber-700 dark:text-amber-300 shrink-0 hover:bg-amber-500/20 transition-colors",
            className,
          )}
          aria-label={t("productivityReview.aria.underReview", {
            identifier: reviewIdentifier,
            trigger: label,
          })}
        >
          <Eye className="h-3 w-3" aria-hidden />
          {hideLabel ? null : <span>{t("productivityReview.underReview")}</span>}
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-1 text-xs">
          <div className="font-semibold">{t("productivityReview.tooltip.title")}</div>
          <div>
            <span className="text-muted-foreground">{t("productivityReview.tooltip.triggerLabel")}</span> {label}
          </div>
          {typeof review.noCommentStreak === "number" && review.noCommentStreak > 0 ? (
            <div>
              <span className="text-muted-foreground">{t("productivityReview.tooltip.noCommentStreakLabel")}</span>{" "}
              {t("productivityReview.tooltip.noCommentStreakValue", {
                value: review.noCommentStreak,
              })}
            </div>
          ) : null}
          <div>
            <span className="text-muted-foreground">{t("productivityReview.tooltip.reviewLabel")}</span> {reviewIdentifier} ({statusLabel})
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
