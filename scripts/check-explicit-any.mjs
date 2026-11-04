#!/usr/bin/env node
/**
 * Boundary typing guard: finds explicit `any` in the modules where data from
 * outside the process crosses a trust boundary.
 *
 * The typing policy (OOP-7260) allows `any` internally and bans it at
 * boundaries. `tsc` already rejects *implicit* `any` under `strict`, and
 * `useUnknownInCatchVariables` makes every catch variable `unknown`, so the
 * only case the compiler cannot catch is an `any` written by hand. This finds
 * those.
 *
 * Rules:
 *   explicit-any-cast  `value as any`
 *   explicit-any-type  `any` written in a type position
 *
 * The guard is a ratchet, not a lint gate: `scripts/check-explicit-any.baseline.json`
 * records the `any` each boundary file already has, and only sites *beyond* the
 * baseline fail. Existing debt is not a failure; growth is. That keeps the
 * check green on the tree it was written against while stopping the boundary
 * surface from widening.
 *
 * Baseline entries carry the reason the site is still `any`; when a site goes
 * away, drop its entry and the baseline shrinks with it.
 *
 * Usage:
 *   node scripts/check-explicit-any.mjs              report only, exit 0
 *   node scripts/check-explicit-any.mjs --enforce    exit 1 on sites beyond the baseline
 *   node scripts/check-explicit-any.mjs --summary    counts only
 *   node scripts/check-explicit-any.mjs --write-baseline
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(repoRoot, "scripts", "check-explicit-any.baseline.json");

/**
 * The modules where data from outside the process enters the program. `files`
 * is matched against the basename; `reason` is why the module is a boundary.
 */
export const BOUNDARIES = [
  {
    dir: "server/src/services",
    files: [/^plugin-.*\.ts$/, /^railway\.ts$/, /^company-portability\.ts$/],
    reason: "plugin SDK, external API, and import-manifest payloads",
  },
  {
    dir: "server/src/services/connectors",
    files: [/.*/],
    reason: "external service responses",
  },
  { dir: "server/src/middleware", files: [/.*/], reason: "HTTP request and response" },
  { dir: "server/src/routes", files: [/.*/], reason: "HTTP request and response" },
  { dir: "server/src/http", files: [/.*/], reason: "HTTP request and response" },
  { dir: "ui/src/api", files: [/.*/], reason: "HTTP responses" },
];

export const RULES = [
  { id: "explicit-any-cast", description: "casts a value to any" },
  { id: "explicit-any-type", description: "writes any in a type position" },
];

function isCheckable(name) {
  if (!/\.(ts|tsx)$/.test(name)) return false;
  if (/\.(test|spec|stories)\.(ts|tsx)$/.test(name)) return false;
  if (/\.d\.ts$/.test(name)) return false;
  return true;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (isCheckable(entry.name)) out.push(full);
  }
  return out;
}

// A `/` opens a regex literal rather than dividing, based on what came before
// it. Getting this wrong in either direction is silent, so the rule stays
// conservative: after punctuation a slash is division, and only after a
// keyword that expects an expression is it a regex.
const REGEX_AFTER_PUNCTUATION = new Set("(,=:[!&|?{};+-*%^~<>".split(""));
const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "case", "do", "else", "yield", "await", "throw",
]);

/**
 * Blanks out comments, string bodies, and regex literals, keeping every
 * newline so line numbers survive. Without this, `any` inside a string or a
 * comment reads as a type.
 */
export function stripCommentsAndStrings(source) {
  const out = [];
  let index = 0;
  let lastChar = "";
  let lastWord = null;
  const blank = (text) => text.replace(/[^\n]/g, " ");

  const emit = (text) => {
    out.push(text);
    const trimmed = text.trim();
    if (!trimmed) return;
    lastChar = trimmed[trimmed.length - 1];
    lastWord = null;
  };

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      out.push(blank(source.slice(index, stop)));
      index = stop;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      out.push(blank(source.slice(index, stop)));
      index = stop;
      continue;
    }

    const startsRegex =
      char === "/" &&
      next !== "/" &&
      next !== "*" &&
      ((lastWord !== null && REGEX_AFTER_WORD.has(lastWord)) ||
        (lastWord === null && REGEX_AFTER_PUNCTUATION.has(lastChar)));
    if (startsRegex) {
      let cursor = index + 1;
      let inClass = false;
      while (cursor < source.length) {
        const current = source[cursor];
        if (current === "\\") {
          cursor += 2;
          continue;
        }
        if (current === "[") inClass = true;
        else if (current === "]") inClass = false;
        else if (current === "/" && !inClass) break;
        else if (current === "\n") break;
        cursor += 1;
      }
      const stop = Math.min(cursor + 1, source.length);
      out.push(blank(source.slice(index, stop)));
      index = stop;
      lastChar = "/";
      lastWord = null;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      let cursor = index + 1;
      while (cursor < source.length && source[cursor] !== quote) {
        if (source[cursor] === "\\") cursor += 1;
        // A quote that never closes would otherwise swallow the rest of the
        // file and hide every later site, so stop at the line break.
        else if (quote !== "`" && source[cursor] === "\n") break;
        cursor += 1;
      }
      const stop = Math.min(cursor + 1, source.length);
      out.push(blank(source.slice(index, stop)));
      index = stop;
      lastChar = quote;
      lastWord = null;
      continue;
    }

    if (/[A-Za-z_$]/.test(char)) {
      let cursor = index;
      while (cursor < source.length && /[\w$]/.test(source[cursor])) cursor += 1;
      const word = source.slice(index, cursor);
      out.push(word);
      lastChar = word[word.length - 1];
      lastWord = word;
      index = cursor;
      continue;
    }

    if (/\s/.test(char)) {
      out.push(char);
      index += 1;
      continue;
    }

    emit(char);
    index += 1;
  }
  return out.join("");
}

/** The `any` sites in one file's source, in file order. */
export function scanSource(sourceText, path) {
  const stripped = stripCommentsAndStrings(sourceText);
  const findings = [];
  for (const match of stripped.matchAll(/\bany\b/g)) {
    const start = match.index;
    const before = stripped.slice(0, start);
    const line = before.split("\n").length;
    const text = sourceText.split("\n")[line - 1]?.trim() ?? "";
    const isCast = /\bas\s+$/.test(before);
    findings.push({
      path,
      line,
      rule: isCast ? "explicit-any-cast" : "explicit-any-type",
      text,
    });
  }
  return findings;
}

export function loadBaseline() {
  if (!existsSync(baselinePath)) return {};
  return JSON.parse(readFileSync(baselinePath, "utf8"));
}

export function writeBaseline(baseline) {
  const sorted = Object.fromEntries(
    Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`);
}

export function boundaryFiles(root = repoRoot) {
  const files = new Map();
  for (const boundary of BOUNDARIES) {
    const dir = join(root, boundary.dir);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir, [])) {
      const name = file.split(sep).pop() ?? "";
      if (!boundary.files.some((pattern) => pattern.test(name))) continue;
      const path = relative(root, file).split(sep).join("/");
      files.set(path, boundary);
    }
  }
  return files;
}

export function scanExplicitAny({ root = repoRoot, baseline = loadBaseline() } = {}) {
  const findings = [];
  for (const [path] of boundaryFiles(root)) {
    const source = readFileSync(join(root, path), "utf8");
    const sites = scanSource(source, path);
    const allowed = baseline[path] ?? {};
    // The baseline is a count per rule, so the first N sites in file order are
    // the recorded debt and anything past them is new.
    const seen = {};
    for (const site of sites) {
      seen[site.rule] = (seen[site.rule] ?? 0) + 1;
      if (seen[site.rule] > (allowed[site.rule] ?? 0)) findings.push(site);
    }
  }
  return findings;
}

function baselineFor(root) {
  const baseline = {};
  for (const [path] of boundaryFiles(root)) {
    const source = readFileSync(join(root, path), "utf8");
    const counts = {};
    for (const site of scanSource(source, path)) {
      counts[site.rule] = (counts[site.rule] ?? 0) + 1;
    }
    if (Object.keys(counts).length > 0) baseline[path] = counts;
  }
  return baseline;
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--write-baseline")) {
    const baseline = baselineFor(repoRoot);
    writeBaseline(baseline);
    const files = Object.keys(baseline).length;
    const total = Object.values(baseline).reduce(
      (sum, counts) => sum + Object.values(counts).reduce((a, b) => a + b, 0),
      0,
    );
    console.log(`check-explicit-any: wrote ${total} baseline site(s) across ${files} file(s)`);
    return;
  }

  const summaryOnly = args.has("--summary");
  const findings = scanExplicitAny();

  if (!summaryOnly) {
    for (const finding of findings) {
      console.log(`${finding.path}:${finding.line}  [${finding.rule}]  ${finding.text}`);
    }
  }
  console.log("");
  console.log(`check-explicit-any: ${findings.length} site(s) beyond the baseline`);
  for (const rule of RULES) {
    const count = findings.filter((finding) => finding.rule === rule.id).length;
    console.log(`  ${rule.id.padEnd(20)} ${String(count).padStart(5)}  ${rule.description}`);
  }
  if (findings.length === 0) {
    console.log("No new explicit `any` at a trust boundary.");
    return;
  }
  console.log("");
  console.log("Use `unknown` for data crossing a trust boundary and narrow it where it is used.");
  if (!args.has("--enforce")) {
    console.log("Report-only mode. Pass --enforce to fail on sites beyond the baseline.");
    return;
  }
  process.exitCode = 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
