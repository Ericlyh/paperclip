#!/usr/bin/env node
// One-shot: derive ui/src/i18n/locales/zh-CN.json from zh-TW.json via opencc-js.
//
// Why not the hinet/paperclip-lang plugin? That plugin translates at the DOM layer
// via MutationObserver, which would clobber the 4367-key i18next system already
// shipped in the same repo. opencc-js is deterministic, runs in <1s, and the
// result is a real locale file that the i18n system already knows how to use.
//
// Usage: node scripts/zh-TW-to-zh-CN.mjs [--write]
//   default: dry run, prints stats
//   --write: actually overwrite ui/src/i18n/locales/zh-CN.json

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Converter } from "opencc-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const LOCALES = resolve(ROOT, "src/i18n/locales");
const TW = resolve(LOCALES, "zh-TW.json");
const CN = resolve(LOCALES, "zh-CN.json");

const args = new Set(process.argv.slice(2));
const write = args.has("--write");

const c = Converter({ from: "twp", to: "cn" }); // twp = tw + phrase segmentation

function convert(s) {
  if (typeof s !== "string") return s;
  return c(s);
}

const before = JSON.parse(readFileSync(CN, "utf8"));
const src = JSON.parse(readFileSync(TW, "utf8"));

function* flat(t, p = "") {
  for (const [k, v] of Object.entries(t)) {
    if (typeof v === "object" && v !== null) yield* flat(v, p + k + ".");
    else yield p + k;
  }
}

function setAt(tree, dotted, value) {
  const parts = dotted.split(".");
  let n = tree;
  for (const p of parts.slice(0, -1)) n = (n[p] ??= {});
  n[parts.at(-1)] = value;
}

let translated = 0;
let same = 0;
let cnOnly = 0;
const out = JSON.parse(JSON.stringify(src));

for (const key of flat(src)) {
  const rawTW = key.split(".").reduce((o, k) => o?.[k], src);
  if (typeof rawTW !== "string") continue;
  const cnValue = c(rawTW);
  setAt(out, key, cnValue);
  if (cnValue !== rawTW) translated++;
  else same++;
}

// Preserve any CN-only keys that exist in the current zh-CN.json but not in zh-TW
for (const key of flat(before)) {
  if (![...flat(src)].includes(key)) {
    const val = key.split(".").reduce((o, k) => o?.[k], before);
    if (val !== undefined) {
      setAt(out, key, val);
      cnOnly++;
    }
  }
}

const stats = { translated, unchanged: same, cnOnlyPreserved: cnOnly, totalKeys: [...flat(out)].length };
console.log(JSON.stringify(stats, null, 2));

if (write) {
  writeFileSync(CN, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${CN}`);
} else {
  console.log("\nDRY RUN — pass --write to actually overwrite zh-CN.json");
}
