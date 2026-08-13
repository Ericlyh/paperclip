import { useTranslation } from ".";

/**
 * Renders the translation for `k` and re-renders on locale change.
 *
 * Primitives like `Button` are rendered thousands of times per page, so they
 * must not mount a `useTranslation()` subscription unconditionally. Rendering
 * this component only when a caller opts into `translationKey` keeps the
 * subscription cost proportional to the number of translated labels.
 */
export function Translated({ k }: { k: string }) {
  const { t } = useTranslation();
  return <>{t(k)}</>;
}
