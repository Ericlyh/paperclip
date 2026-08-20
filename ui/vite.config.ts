import path from "path";
import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createUiDevWatchOptions } from "./src/lib/vite-watch";
import { createApiProxy } from "./src/lib/vite-api-proxy";

const apiProxy = createApiProxy();

/**
 * Refuse to emit a bundle that cannot compile.
 *
 * `vite build` reads the working tree, not HEAD, and agents on this host rebuild
 * `ui/dist` from a dirty tree many times a day — so a mid-edit tree can be
 * compiled and served. That is how a bundle with a free `t` reference reached the
 * browser ("Can't find variable: t") while every commit and the current bundle
 * were clean. Once served, an open tab keeps running that JS until a manual reload.
 *
 * This lives in the vite config rather than a package.json script on purpose:
 * callers invoke `npx vite build` directly, which would bypass a script wrapper.
 *
 * Escape hatches: SKIP_BUILD_GATE=1, ALLOW_DIRTY_BUILD=1 (see scripts/guard-build.mjs).
 */
function buildGate() {
  return {
    name: "paperclip-build-gate",
    apply: "build" as const,
    buildStart() {
      if (process.env.SKIP_BUILD_GATE === "1") return;
      try {
        execFileSync(process.execPath, [path.resolve(__dirname, "scripts/guard-build.mjs")], {
          stdio: "inherit",
        });
      } catch {
        // guard-build.mjs already printed the actionable detail; a rollup stack
        // trace on top of it only buries the message.
        throw new Error("build gate failed — see above. Nothing was written to dist/.");
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [buildGate(), react(), tailwindcss()],
  build: {
    minify: "esbuild",
  },
  esbuild:
    mode === "production"
      ? {
          drop: ["console", "debugger"],
          legalComments: "none",
        }
      : undefined,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      lexical: path.resolve(__dirname, "./node_modules/lexical/dist/Lexical.mjs"),
    },
  },
  server: {
    port: 5173,
    watch: createUiDevWatchOptions(process.cwd()),
    proxy: apiProxy,
  },
  preview: {
    port: 3101,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: apiProxy,
  },
}));
