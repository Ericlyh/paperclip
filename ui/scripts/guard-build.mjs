#!/usr/bin/env node
/**
 * Pre-build gate for the UI bundle.
 *
 * Why this exists (2026-08-20): `vite build` reads the WORKING TREE, not HEAD.
 * Agents on this host rebuild `ui/dist` from a dirty tree many times a day, so a
 * mid-edit tree can be compiled and served. That is how a bundle containing a
 * free `t` reference reached the browser and produced
 * "Paperclip hit an error … Can't find variable: t" — every commit was clean and
 * the current bundle was clean, so nothing in git could explain it. Once served,
 * an open tab keeps running that JS until the user manually reloads.
 *
 * The gate makes a broken bundle unable to reach `dist` in the first place.
 *
 * Escape hatches (deliberate, must be explicit):
 *   ALLOW_DIRTY_BUILD=1   build even though the working tree has changes
 *   SKIP_BUILD_GATE=1     skip every check (emergency only)
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(UI_DIR, "..");

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

function die(title, detail) {
  console.error(`\n${RED}✗ build gate: ${title}${OFF}\n`);
  if (detail) console.error(detail.trimEnd() + "\n");
  process.exit(1);
}

function run(cmd, args, cwd) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

if (process.env.SKIP_BUILD_GATE === "1") {
  console.warn(`${YELLOW}! build gate skipped via SKIP_BUILD_GATE=1${OFF}`);
  process.exit(0);
}

// ---------------------------------------------------------------- 1. typecheck
// Test and story files carry pre-existing failures unrelated to the shipped
// bundle, and none of them are compiled into it — so only app code gates here.
const IGNORED = /(\.test\.|\.stories\.|__tests__|\.test-utils\.)/;
const tsc = run("node", ["node_modules/typescript/bin/tsc", "--noEmit"], UI_DIR);
const tsErrors = tsc.out
  .split("\n")
  .filter((l) => l.includes("error TS") && !IGNORED.test(l));

if (tsErrors.length) {
  die(
    `${tsErrors.length} TypeScript error(s) in app code`,
    tsErrors.slice(0, 25).join("\n") +
      (tsErrors.length > 25 ? `\n… and ${tsErrors.length - 25} more` : "") +
      `\n\n${DIM}A bundle built from this tree can crash at runtime. Fix these, then build.${OFF}`,
  );
}

// ------------------------------------------------------- 2. i18n wiring guard
const i18n = run("node", ["scripts/check-i18n-wiring.mjs"], REPO);
if (!i18n.ok) {
  die(
    "i18n wiring guard failed",
    i18n.out + `\n${DIM}A component calls t() without useTranslation in scope — this ships a blank page.${OFF}`,
  );
}

// ------------------------------------------------------------ 3. dirty tree
// Building from a dirty tree is what shipped the broken bundle. It is still a
// legitimate deploy workflow here, so it is allowed — but only on purpose.
const status = run("git", ["-C", REPO, "status", "--short", "--", "ui/src"], REPO);
const dirty = status.ok
  ? status.out.split("\n").filter((l) => l.trim() && !l.startsWith("??"))
  : [];

if (dirty.length) {
  if (process.env.ALLOW_DIRTY_BUILD === "1") {
    console.warn(
      `${YELLOW}! building from a dirty tree — ${dirty.length} uncommitted file(s) under ui/src${OFF}\n` +
        `${DIM}${dirty.slice(0, 8).map((l) => "    " + l).join("\n")}${dirty.length > 8 ? `\n    … and ${dirty.length - 8} more` : ""}${OFF}\n` +
        `${DIM}  Allowed via ALLOW_DIRTY_BUILD=1. The bundle will not match any commit.${OFF}`,
    );
  } else {
    die(
      `${dirty.length} uncommitted file(s) under ui/src`,
      dirty.slice(0, 12).map((l) => "  " + l).join("\n") +
        (dirty.length > 12 ? `\n  … and ${dirty.length - 12} more` : "") +
        `\n\n${DIM}vite build reads the working tree, not HEAD, so this bundle would match no commit\n` +
        `and could not be reproduced or reverted. Commit first, or build on purpose with:\n${OFF}` +
        `\n    ALLOW_DIRTY_BUILD=1 pnpm --filter @paperclipai/ui build\n`,
    );
  }
}

console.log(
  `${GREEN}✓ build gate: typecheck clean, i18n wiring clean${OFF}` +
    (dirty.length ? `${YELLOW} (dirty tree allowed)${OFF}` : ", tree clean"),
);
