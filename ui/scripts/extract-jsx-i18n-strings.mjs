#!/usr/bin/env node
// @ts-check
//
// extract-jsx-i18n-strings.mjs
//
// Walks ui/src/pages/**/*.tsx (or a user-supplied list) and emits a JSON map
// of {relative-file: [string, ...]} covering hardcoded user-visible strings
// in JSX and adjacent JS expressions:
//
//   - JSX text content between tags      — e.g. <h1>Welcome</h1>
//   - JSX attribute string literals      — placeholder=, title=, aria-label=, alt=, label=
//   - String literals in JSX expressions — e.g. {isX ? "Yes" : "No"} or "Run exited with an error."
//
// The third category is filtered by natural-language heuristics: requires a
// space + at least one lowercase letter, rejects strings that look like
// identifiers (no spaces, all camelCase) or paths.
//
// Known limitations:
//   - Multi-line JSX is not parsed (the regexes are line-scoped).
//   - Compound text like `Hello, ${name}!` is skipped.
//   - Strings already wrapped in t() / i18n.key() calls are still emitted —
//     dedup against the existing i18n catalog before adding new keys.
//   - This is regex-based, NOT an AST parser. False positives will occur.
//     Treat the output as a starting checklist for the translator, not as
//     the source of truth.
//
// Usage:
//   node ui/scripts/extract-jsx-i18n-strings.mjs                       # all pages
//   node ui/scripts/extract-jsx-i18n-strings.mjs --out file.json
//   node ui/scripts/extract-jsx-i18n-strings.mjs ui/src/pages/Inbox.tsx

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(new URL("../..", import.meta.url).pathname);
const DEFAULT_PAGES_DIR = join(REPO_ROOT, "ui/src/pages");

// JSX text content: >Hello<  (single-line, no expressions, 3-200 chars)
const JSX_TEXT_RE = />([^<>{}]{3,200})</g;

// JSX attribute strings: placeholder="..."  (no template literals, no {})
const ATTR_STRING_RE = /\b(placeholder|title|aria-label|alt|label)\s*=\s*"([^"{}]{2,300})"/g;

// Natural-language string literals (in JSX expressions or JS object literals):
//   "Failed to approve"    — starts with capital, contains a space, has a
//                           lowercase letter, no {} interpolation, ≤200 chars
const NL_LITERAL_RE = /"([A-Z][A-Za-z0-9 .,;:!?'\-\(\)/]{4,200})"/g;

function shouldSkipLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("//")) return true;
  if (trimmed.startsWith("*")) return true;
  if (trimmed.startsWith("/*")) return true;
  return false;
}

function looksLikeNaturalLanguage(s) {
  // Heuristic: contains at least one space AND at least one lowercase letter,
  // and does not look like an identifier / path / CSS value.
  if (!s.includes(" ")) return false;
  if (!/[a-z]/.test(s)) return false;
  // Reject if it looks like a CSS value or class fragment
  if (/^[a-z0-9 ,:.()#-]+$/i.test(s) && !/[A-Z]/.test(s)) return false;
  // Reject if it looks like a file path
  if (/\.(css|tsx|ts|js|jsx|svg|png|jpg|gif)\b/.test(s)) return false;
  // Reject if it looks like a URL or query string
  if (/^https?:\/\//i.test(s)) return false;
  if (/[?&][a-z]+=/i.test(s)) return false;
  // Reject common JSON / config keys
  if (/^(true|false|null|undefined)$/i.test(s)) return false;
  return true;
}

function extractFromFile(absolutePath) {
  const source = readFileSync(absolutePath, "utf8");
  const lines = source.split(/\r?\n/);
  const strings = new Set();

  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inBlockComment) {
      const close = line.indexOf("*/");
      if (close === -1) continue;
      inBlockComment = false;
    }
    if (line.includes("/*") && !line.includes("*/")) {
      inBlockComment = true;
      continue;
    }

    if (shouldSkipLine(line)) continue;

    // 1. JSX text content between tags
    let m;
    JSX_TEXT_RE.lastIndex = 0;
    while ((m = JSX_TEXT_RE.exec(line)) !== null) {
      const text = m[1].trim();
      if (text.length < 3 || text.length > 200) continue;
      if (/=>|>=|<=|==|!=|&&|\|\|/.test(text)) continue;
      // Skip short single-word identifiers (likely className fragments)
      if (/^[a-z][a-z0-9-]*$/i.test(text) && text.length < 30 && !text.includes(" ")) continue;
      // Skip purely punctuation strings
      if (/^[\s\d.,;:!?/\\'"()[\]{}<>+=\-_*&^%$#@~`|]+$/.test(text)) continue;
      // Skip CSS/asset paths and URLs
      if (/\.(css|tsx|ts|js|jsx|svg|png|jpg|gif)\b/.test(text)) continue;
      if (/^https?:\/\//i.test(text)) continue;
      strings.add(text);
    }

    // 2. JSX attribute strings
    ATTR_STRING_RE.lastIndex = 0;
    while ((m = ATTR_STRING_RE.exec(line)) !== null) {
      const value = m[2];
      if (value.length < 2 || value.length > 300) continue;
      if (/^[a-z][a-z0-9_-]*$/i.test(value) && !value.includes(" ")) continue;
      strings.add(value);
    }

    // 3. Natural-language string literals (JSX expressions / object values)
    NL_LITERAL_RE.lastIndex = 0;
    while ((m = NL_LITERAL_RE.exec(line)) !== null) {
      const value = m[1];
      if (looksLikeNaturalLanguage(value)) {
        strings.add(value);
      }
    }
  }

  return [...strings].sort();
}

function walkPages(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...walkPages(full));
    } else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out.sort();
}

function parseArgs(argv) {
  const files = [];
  let outPath = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") {
      outPath = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: extract-jsx-i18n-strings.mjs [--out <file>] [<file>...]\n" +
          "  With no args: walks ui/src/pages/**/*.tsx (excludes .test.tsx).\n" +
          "  With positional args: extracts only those files (resolved against cwd).",
      );
      process.exit(0);
    } else if (arg.startsWith("--")) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    } else {
      files.push(resolve(arg));
    }
  }
  return { files, outPath };
}

function main() {
  const { files, outPath } = parseArgs(process.argv.slice(2));
  const targets = files.length > 0 ? files : walkPages(DEFAULT_PAGES_DIR);

  const result = {};
  let totalStrings = 0;
  for (const file of targets) {
    const strings = extractFromFile(file);
    if (strings.length === 0) continue;
    const key = relative(REPO_ROOT, file);
    result[key] = strings;
    totalStrings += strings.length;
  }

  const json = JSON.stringify(result, null, 2) + "\n";
  if (outPath) {
    writeFileSync(outPath, json);
    console.error(
      `Wrote ${Object.keys(result).length} files / ${totalStrings} strings to ${outPath}`,
    );
  } else {
    process.stdout.write(json);
  }
}

main();
