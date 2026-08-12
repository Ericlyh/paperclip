import { Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLanguage } from "../context/LanguageContext";
import { useTranslation } from "../i18n";

type LanguageToggleVariant = "icon" | "menu-action";

interface LanguageToggleProps {
  className?: string;
  /**
   * `icon` (default): compact icon button — suitable for headers,
   * floating chrome, and any surface that just wants a toggle affordance.
   *
   * `menu-action`: full-width row with label + description + icon —
   * matches the surrounding `MenuAction` rows in `SidebarAccountMenu`.
   */
  variant?: LanguageToggleVariant;
  /**
   * Called after `toggleLocale` runs. Surfaces like a popover menu use
   * this to dismiss the menu once the user has acted.
   */
  onAfterToggle?: () => void;
}

/**
 * Canonical language-toggle widget. Mounts both inside the signed-out
 * chrome and inside the in-app account menu so label, icon, and toggle
 * behaviour stay in sync as the localisation model evolves.
 *
 * The label always points at the language the user will land on after
 * clicking — so in `en` it reads "Switch to 繁體中文", and in `zh-TW`
 * it reads "切換到 English".
 */
export function LanguageToggle({ className, variant = "icon", onAfterToggle }: LanguageToggleProps) {
  const { locale, toggleLocale } = useLanguage();
  const { t } = useTranslation();
  const isChinese = locale === "zh-TW";
  const ariaLabel = isChinese ? t("languageToggle.switchToEnglish") : t("languageToggle.switchToChinese");

  function handleClick() {
    toggleLocale();
    onAfterToggle?.();
  }

  if (variant === "menu-action") {
    return (
      <button
        type="button"
        className={cn(
          "flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-accent/60",
          className,
        )}
        onClick={handleClick}
        aria-label={ariaLabel}
      >
        <span className="mt-0.5 rounded-lg border border-border bg-background/70 p-2 text-muted-foreground">
          <Languages className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">{ariaLabel}</span>
          <span className="block text-xs text-muted-foreground">{t("languageToggle.toggleDescription")}</span>
        </span>
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={handleClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn("text-muted-foreground", className)}
    >
      <Languages className={isChinese ? "text-primary" : undefined} />
    </Button>
  );
}
