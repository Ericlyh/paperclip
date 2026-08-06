import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { i18n } from "../i18n";

type Locale = "en" | "zh-TW";

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  availableLocales: readonly Locale[];
}

const LOCALE_STORAGE_KEY = "paperclip.locale";

// The user-facing toggle cycles between English and Traditional Chinese.
// The i18n bundle ships 42 locales; exposing all of them in the toggle
// would push the picker out of the account menu. To add more, extend
// this list AND the labels below in `LanguageToggle`.
const AVAILABLE_LOCALES: readonly Locale[] = ["en", "zh-TW"];
const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && AVAILABLE_LOCALES.includes(value as Locale);
}

function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isSupportedLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

function persistLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore localStorage write failures (e.g. privacy-restricted iframes).
  }
}

function applyLocale(locale: Locale) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
  void i18n.changeLanguage(locale);
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = readStoredLocale();
    const initial = stored ?? "en";
    // Switch i18n synchronously so the first React render already reads
    // from the persisted bundle. i18next updates its `language` getter
    // immediately; resource resolution still resolves to the eager bundle
    // we configured in `src/i18n/index.ts`.
    if (i18n.language !== initial) {
      applyLocale(initial);
    }
    return initial;
  });

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
    applyLocale(next);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((current) => {
      const next: Locale = current === "en" ? "zh-TW" : "en";
      persistLocale(next);
      applyLocale(next);
      return next;
    });
  }, []);

  // Keep `<html lang>` in sync even if some other code path mutates `locale`
  // without going through the context's setters (defense in depth).
  useEffect(() => {
    if (typeof document !== "undefined" && document.documentElement.lang !== locale) {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      toggleLocale,
      availableLocales: AVAILABLE_LOCALES,
    }),
    [locale, setLocale, toggleLocale],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}

export const LANGUAGE_STORAGE_KEY = LOCALE_STORAGE_KEY;
