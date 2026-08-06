import { Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLanguage } from "../context/LanguageContext";

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

// Per-locale copy so the toggle label reads naturally in whichever
// language the user is currently looking at. The label always points
// at the language the user will land on after clicking.
const MENU_ACTION_LABELS = {
  en: { label: "Switch to 繁體中文", description: "Toggle the interface language." },
  "zh-TW": { label: "切換到 English", description: "切換介面語言。" },
} as const;

const ICON_LABELS = {
  en: "Switch to 繁體中文",
  "zh-TW": "切換到 English",
} as const;

/**
 * Canonical language-toggle widget. Mounts both inside the signed-out
 * chrome and inside the in-app account menu so label, icon, and toggle
 * behaviour stay in sync as the localisation model evolves.
 */
export function LanguageToggle({ className, variant = "icon", onAfterToggle }: LanguageToggleProps) {
  const { locale, toggleLocale } = useLanguage();
  const isChinese = locale === "zh-TW";
  const ariaLabel = ICON_LABELS[locale];

  function handleClick() {
    toggleLocale();
    onAfterToggle?.();
  }

  if (variant === "menu-action") {
    const copy = MENU_ACTION_LABELS[locale];
    return (
      <button
        type="button"
        className={cn(
          "flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-accent/60",
          className,
        )}
        onClick={handleClick}
        aria-label={copy.label}
      >
        <span className="mt-0.5 rounded-lg border border-border bg-background/70 p-2 text-muted-foreground">
          <Languages className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">{copy.label}</span>
          <span className="block text-xs text-muted-foreground">{copy.description}</span>
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
