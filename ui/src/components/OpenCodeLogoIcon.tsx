import { cn } from "../lib/utils";
import { useTranslation } from "../i18n";

interface OpenCodeLogoIconProps {
  className?: string;
}

export function OpenCodeLogoIcon({ className }: OpenCodeLogoIconProps) {
  const { t } = useTranslation();
  return (
    <>
      <img
        src="/brands/opencode-logo-light-square.svg"
        alt={t("openCodeLogoIcon.alt.opencode")}
        className={cn("dark:hidden", className)}
      />
      <img
        src="/brands/opencode-logo-dark-square.svg"
        alt={t("openCodeLogoIcon.alt.opencode")}
        className={cn("hidden dark:block", className)}
      />
    </>
  );
}
