import { Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n";

interface EmptyStateProps {
  icon: LucideIcon;
  /** Optional bold heading rendered above the message. */
  title?: string;
  /** i18n key for the bold heading. Takes precedence over `title` when set. */
  titleKey?: string;
  message: string;
  /** i18n key for the primary message. Takes precedence over `message` when set. */
  messageKey?: string;
  /** Optional secondary line rendered under the primary message. */
  description?: string;
  /** i18n key for the description. Takes precedence over `description` when set. */
  descriptionKey?: string;
  action?: string;
  /** i18n key for the action button label. Takes precedence over `action` when set. */
  actionKey?: string;
  onAction?: () => void;
  /** Hide the leading "+" glyph on the action button (e.g. for a "Set up" CTA). */
  hideActionIcon?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  titleKey,
  message,
  messageKey,
  description,
  descriptionKey,
  action,
  actionKey,
  onAction,
  hideActionIcon = false,
}: EmptyStateProps) {
  const { t } = useTranslation();
  const resolvedTitle = titleKey ? t(titleKey) : title;
  const resolvedMessage = messageKey ? t(messageKey) : message;
  const resolvedDescription = descriptionKey ? t(descriptionKey) : description;
  const resolvedAction = actionKey ? t(actionKey) : action;

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="bg-muted/50 p-4 mb-4">
        <Icon className="h-10 w-10 text-muted-foreground/50" />
      </div>
      {resolvedTitle ? (
        <>
          <p className="text-base font-semibold text-foreground mb-1.5">{resolvedTitle}</p>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">{resolvedMessage}</p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-foreground mb-1">{resolvedMessage}</p>
          {resolvedDescription && (
            <p className="max-w-md text-sm text-muted-foreground mb-4">{resolvedDescription}</p>
          )}
        </>
      )}
      {resolvedAction && onAction && (
        <Button onClick={onAction}>
          {!hideActionIcon && <Plus className="h-4 w-4 mr-1.5" />}
          {resolvedAction}
        </Button>
      )}
    </div>
  );
}
