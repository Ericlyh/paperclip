import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Remove the bare `lexical` alias so it resolves consistently with
      // @lexical/* packages through the same Vite transform pipeline.
      // The old alias pointed to Lexical.mjs which statically imports both
      // dev/prod and picks at runtime via process.env.NODE_ENV — that caused
      // a dual-instance mismatch when test.env = { NODE_ENV: "test" } was
      // set (lexical → dev, @lexical/link → prod).  Inlining lexical below
      // lets Vite's define plugin substitute NODE_ENV consistently for all
      // Lexical packages.
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Tell React to load its development build where `act` is exported.
    // Without this, 81 test files fail with "act is not a function" because
    // the production build has no act export.
    env: { NODE_ENV: "test" },
  },
  // Inline lexical and @lexical/* so they all go through the Vite transform
  // pipeline together.  This ensures process.env.NODE_ENV is consistently
  // replaced ("test") for every Lexical package, fixing the dev/prod split
  // that the old bare `lexical` alias created.
  server: {
    deps: {
      inline: [/^lexical$/, /^@lexical\//],
    },
  },
});
