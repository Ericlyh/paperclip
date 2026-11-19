import type { Resource } from "i18next";

import { assertValidLocaleMessages } from "./locale-validation";
import en from "./locales/en.json";
import zhTW from "./locales/zh-TW.json";

export const DEFAULT_LOCALE = "en" as const;

/**
 * Locales bundled into the entry chunk.
 *
 * These are the two the user can actually select (see AVAILABLE_LOCALES in
 * ui/src/context/LanguageContext.tsx). The other 38 dictionaries used to be
 * inlined here as well — `import.meta.glob(..., { eager: true })` put 19.6 MB
 * of JSON into the entry chunk, which was 68% of the 23.3 MB bundle every
 * client downloaded. They now ship as separate chunks and are only fetched if
 * a locale outside this set is ever requested.
 */
const EAGER_LOCALE_MESSAGES: Record<string, unknown> = {
  en,
  "zh-TW": zhTW,
};

/** Locale file path → dynamic import. Keys are relative to this file. */
const localeModules = import.meta.glob("./locales/*.json", {
  import: "default",
}) as Record<string, () => Promise<unknown>>;

function localeFromPath(path: string): string | null {
  return path.match(/\/([A-Za-z0-9_-]+)\.json$/)?.[1] ?? null;
}

/** Every locale the app knows about, bundled or not. */
export const allLocales = Object.keys(localeModules)
  .map(localeFromPath)
  .filter((locale): locale is string => locale !== null);

export const supportedLocales = allLocales;

/** The eagerly bundled locales. */
export const localeMessages = EAGER_LOCALE_MESSAGES;

if (!(DEFAULT_LOCALE in localeMessages)) {
  throw new Error(`Missing default locale messages for ${DEFAULT_LOCALE}`);
}

for (const [locale, messages] of Object.entries(localeMessages)) {
  try {
    assertValidLocaleMessages(messages);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${locale} locale messages: ${message}`);
  }
}

export const i18nextResources: Resource = Object.fromEntries(
  Object.entries(localeMessages).map(([locale, messages]) => [locale, { translation: messages }]),
) as Resource;

/**
 * Load a locale's messages, fetching the chunk for locales that are not
 * bundled eagerly. Returns undefined for an unknown locale.
 */
export async function loadLocaleMessages(locale: string): Promise<unknown | undefined> {
  if (locale in EAGER_LOCALE_MESSAGES) {
    return EAGER_LOCALE_MESSAGES[locale];
  }
  const loader = localeModules[`./locales/${locale}.json`];
  if (!loader) return undefined;
  return loader();
}

export type SupportedLocale = keyof typeof localeMessages;
