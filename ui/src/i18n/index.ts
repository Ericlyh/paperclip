import i18n, { type InitOptions, type TOptions, type TFunction } from "i18next";
import { initReactI18next, useTranslation as useReactI18nextTranslation, Trans as ReactI18nextTrans } from "react-i18next";

import { DEFAULT_LOCALE, i18nextResources, loadLocaleMessages, supportedLocales } from "./locales";

const i18nextOptions: InitOptions = {
  resources: i18nextResources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: supportedLocales,
  defaultNS: "translation",
  interpolation: { escapeValue: false },
  returnObjects: false,
  initAsync: false,
};

void i18n.use(initReactI18next).init(i18nextOptions).catch((error: unknown) => {
  console.error("Failed to initialize i18next", error);
});

const loadedLocales = new Set(Object.keys(i18nextResources));

/**
 * Locales outside the eagerly bundled set are fetched on demand. i18next is
 * initialised synchronously with the bundled locales; a locale that arrives
 * later is added to the resource store and the language re-applied so the
 * components re-render with the new bundle.
 */
async function ensureLocaleLoaded(locale: string): Promise<void> {
  if (loadedLocales.has(locale)) return;
  const messages = await loadLocaleMessages(locale);
  if (!messages) return;
  i18n.addResourceBundle(locale, "translation", messages, true, true);
  loadedLocales.add(locale);
  if (i18n.language === locale) {
    void i18n.changeLanguage(locale);
  }
}

i18n.on("languageChanged", (locale: string) => {
  void ensureLocaleLoaded(locale);
});

export function t(key: string, options: TOptions = {}) {
  return i18n.t(key, options);
}

export const useTranslation = useReactI18nextTranslation;
export const Trans = ReactI18nextTrans;
export type { TFunction };
export { i18n };
