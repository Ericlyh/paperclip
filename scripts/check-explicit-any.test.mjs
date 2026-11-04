import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BOUNDARIES,
  scanExplicitAny,
  scanSource,
  stripCommentsAndStrings,
} from "./check-explicit-any.mjs";

test("stripCommentsAndStrings blanks comments and strings but keeps line numbers", () => {
  const source = ['const a = "any";', "// any", "const b = 1;"].join("\n");
  const stripped = stripCommentsAndStrings(source);
  assert.equal(stripped.split("\n").length, 3);
  assert.ok(!stripped.includes("any"));
});

test("scanSource separates a cast from a type position", () => {
  const source = ["const a = value as any;", "const b: any = value;"].join("\n");
  const findings = scanSource(source, "x.ts");
  assert.equal(findings.length, 2);
  assert.equal(findings[0].rule, "explicit-any-cast");
  assert.equal(findings[0].line, 1);
  assert.equal(findings[1].rule, "explicit-any-type");
  assert.equal(findings[1].line, 2);
});

test("scanSource ignores `any` in strings, comments, and identifiers that contain it", () => {
  const source = [
    'const message = "use any here";',
    "// any is fine in a comment",
    "/* any in a block comment */",
    "const company = 1;",
    "const template = `any ${value}`;",
  ].join("\n");
  assert.deepEqual(scanSource(source, "x.ts"), []);
});

test("scanSource ignores `any` inside a regex literal", () => {
  const source = ["const quote = /['\"]/;", "const b = value as any;"].join("\n");
  const findings = scanSource(source, "x.ts");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
});

test("scanSource does not mistake division for a regex literal", () => {
  const source = ["const half = total / 2;", "const b = value as any;"].join("\n");
  const findings = scanSource(source, "x.ts");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
});

test("scanSource reports the line a site is on when earlier lines are strings", () => {
  const source = ['const a = "line one";', "const b = value as any;"].join("\n");
  const findings = scanSource(source, "x.ts");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
});

test("the ratchet only reports sites beyond the baseline", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "explicit-any-"));
  try {
    const boundary = BOUNDARIES[0];
    const dir = path.join(root, boundary.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "railway.ts"), "const a = value as any;\n");
    const baseline = { "server/src/services/railway.ts": { "explicit-any-cast": 1 } };

    assert.deepEqual(
      scanExplicitAny({ root, baseline: { ...baseline, "server/src/services/railway.ts": { "explicit-any-cast": 1 } } })
        .filter((finding) => finding.path === "server/src/services/railway.ts"),
      [],
    );

    writeFileSync(path.join(dir, "railway.ts"), "const a = value as any;\nconst b = other as any;\n");
    const findings = scanExplicitAny({ root, baseline }).filter(
      (finding) => finding.path === "server/src/services/railway.ts",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a boundary module with no `any` produces no findings", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "explicit-any-"));
  try {
    const boundary = BOUNDARIES[0];
    const dir = path.join(root, boundary.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "railway.ts"), "const a: unknown = value;\n");
    const findings = scanExplicitAny({ root, baseline: {} }).filter(
      (finding) => finding.path === "server/src/services/railway.ts",
    );
    assert.deepEqual(findings, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the checked-in baseline matches the tree it was written against", () => {
  const findings = scanExplicitAny();
  assert.deepEqual(
    findings.map((finding) => `${finding.path}:${finding.line} ${finding.rule}`),
    [],
  );
});
