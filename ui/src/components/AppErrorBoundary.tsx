import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryState = {
  error: Error | null;
  autoReloading: boolean;
};

const AUTO_RELOAD_KEY = "paperclip.errorAutoReloaded";

/**
 * Errors that mean "this tab is running an obsolete bundle" — chunk-load
 * failures (after a rebuild wiped the hash), free references to mangled names
 * (most commonly `t`, the i18next translator minified to one letter), and the
 * generic WebKit "t is not defined". The `t` regex catches every variant
 * whether or not the message says "Can't find" (WebKit), "is not defined"
 * (Chrome), or "ReferenceError" (Firefox).
 */
const STALE_BUNDLE_PATTERNS: readonly RegExp[] = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Loading chunk \S+ failed/i,
  /\bt is not defined\b/,
  /Can't find variable: t\b/,
  /\bReferenceError.*\bt\b/,
  /is not a function/i,
];

function looksLikeStaleBundle(message: string): boolean {
  return STALE_BUNDLE_PATTERNS.some((p) => p.test(message));
}

/**
 * Last-resort boundary above the router and every provider that renders app
 * chrome. `RouteErrorBoundary` only guards the routed `<Outlet />`; a crash in
 * the shell around it (sidebar, providers, layout hooks) has no boundary, so
 * React unmounts the entire root and the user is left staring at a blank
 * page with no way forward but knowing to hard-refresh. This boundary trades
 * that blank page for a reload prompt.
 *
 * Self-heals the stale-bundle case: if the error matches one of the patterns
 * above, the boundary reloads the page once per session. A sentinel in
 * sessionStorage prevents a reload loop if the same error recurs — in that
 * case the manual "Reload page" button is shown instead.
 *
 * Deliberately dependency-free: no router, no toast, no query client — the
 * crash being handled may have originated inside any of those providers.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { error: null, autoReloading: false };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
      autoReloading: false,
    };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("App shell crashed", { error, componentStack: info.componentStack });
    if (this.state.autoReloading) return;
    const message = this.state.error?.message ?? "";
    if (!looksLikeStaleBundle(message)) return;
    if (typeof window === "undefined") return;
    try {
      if (window.sessionStorage.getItem(AUTO_RELOAD_KEY)) return; // already retried this session
      window.sessionStorage.setItem(AUTO_RELOAD_KEY, "1");
    } catch {
      return; // privacy mode / storage blocked — fall through to manual UI
    }
    this.setState({ autoReloading: true });
    // Defer so the setState commits and the user briefly sees the boundary
    // before the reload. Without this they sometimes see only a flash.
    setTimeout(() => {
      window.location.reload();
    }, 80);
  }

  override render() {
    const { error, autoReloading } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center space-y-4 px-4 py-10">
        <div>
          <h1 className="text-lg font-semibold">Paperclip hit an error</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {autoReloading
              ? "Reloading to recover from an out-of-date bundle…"
              : "Something went wrong while running the app. Reloading usually fixes this."}
          </p>
        </div>
        <pre className="overflow-auto rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive whitespace-pre-wrap">
          {error.message}
        </pre>
        {autoReloading ? null : (
          <div>
            <button
              type="button"
              className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                try {
                  window.sessionStorage.removeItem(AUTO_RELOAD_KEY);
                } catch {
                  /* ignore */
                }
                window.location.reload();
              }}
            >
              Reload page
            </button>
          </div>
        )}
      </div>
    );
  }
}
