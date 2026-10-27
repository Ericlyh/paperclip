import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    env: {
      // Force NODE_ENV=test inside the worker pool so React's dev build
      // (which exports `act`) is loaded regardless of the shell's NODE_ENV.
      // Vitest's own `process.env.NODE_ENV ??= "test"` in the orchestrator
      // is a no-op when the shell already exports NODE_ENV=production, so
      // we have to set it here for forked workers to see it. The lexical
      // family resolves consistently because removing the bespoke
      // `lexical` alias below lets both the bare `lexical` specifier and
      // `@lexical/link`'s internal `lexical` import go through the same
      // package.json export resolution (the pnpm overrides pin every
      // @lexical/* to 0.46.0 — see #9180), so this env override no
      // longer reintroduces the pre-#9180 dual-instance mismatch.
      NODE_ENV: "test",
    },
    setupFiles: ["./vitest.setup.ts"],
  },
});
