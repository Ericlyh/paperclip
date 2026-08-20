#!/usr/bin/env node
/**
 * Guard against the recurring "Can't find variable: t" runtime crash that
 * the OOP-3438 i18n wiring task has produced repeatedly (Aug 2026).
 *
 * Pattern that breaks:
 *   // some component, no useTranslation import
 *   <button aria-label={t("foo.bar")}>...</button>
 *
 * The `t` is a free reference → ReferenceError at first render → blank page.
 * TypeScript does not catch this because `t` is in scope at module level via
 * the `t as translate` named import even when no component destructures it.
 *
 * Rule: any `.tsx` file under `ui/src/` that contains `t("...")` (or
 * destructures `{ t }` from useTranslation) MUST also import `useTranslation`
 * from `../i18n` (or any sub-path like `../../i18n`).
 *
 * Exit non-zero on the first violation so `pnpm check:i18n-wiring` fails
 * CI before a broken bundle ships.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(
  new URL("..", import.meta.url).pathname,
  "ui/src",
);

const T_CALL = /\b(?:const\s*\{[^}]*\bt\b[^}]*\}\s*=\s*useTranslation|\bt\s*\(\s*["'`])/;
const USE_TRANS = /\buseTranslation\b/;

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && full.endsWith(".tsx")) {
      yield full;
    }
  }
}

async function main() {
  let total = 0;
  let scanned = 0;
  const violations = [];
  for await (const file of walk(ROOT)) {
    const base = path.basename(file);
    if (
      base.endsWith(".test.tsx") ||
      base.endsWith(".stories.tsx") ||
      base.endsWith(".test-utils.tsx")
    ) {
      continue;
    }
    scanned++;
    const text = await fs.readFile(file, "utf8");
    if (!T_CALL.test(text)) continue;
    total++;
    if (USE_TRANS.test(text)) continue;
    const rel = path.relative(path.resolve(ROOT, "..", ".."), file);
    const lines = text.split(/\r?\n/);
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      if (/\bt\s*\(\s*["'`]/.test(lines[i])) {
        hits.push(`L${i + 1}: ${lines[i].trim().slice(0, 140)}`);
        if (hits.length >= 4) break;
      }
    }
    violations.push({ file: rel, hits });
  }

  if (violations.length === 0) {
    console.log(
      `[check:i18n-wiring] OK — scanned ${scanned} tsx files, ${total} use t() — all import useTranslation.`,
    );
    process.exit(0);
  }
  console.error(
    `[check:i18n-wiring] FAIL — ${violations.length} file(s) use t() without importing useTranslation.`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}`);
    for (const h of v.hits) console.error(`    ${h}`);
  }
  console.error(
    "\nFix: add `import { useTranslation } from \"../i18n\"` (path depth varies) " +
      "and `const { t } = useTranslation();` at the top of the offending component.",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("[check:i18n-wiring] crashed:", err);
  process.exit(2);
});