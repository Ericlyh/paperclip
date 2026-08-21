#!/usr/bin/env python3
"""Audit every t("key", opts) call in the UI against en.json.

Two blind spots in the first version produced ~100 false positives, both found by
the repair agents rather than by me:

  1. i18next plural keys are authored as `key_one` / `key_other`; the code calls the
     BARE key with a `count` option. A flat key-existence check calls that undefined
     and an agent "fixing" it by adding a bare key silently shadows the plural forms.
  2. The options object was matched with a `[^{}]*` regex, so any call whose options
     contain a nested object, template literal, or function call was read as passing
     no options at all.

This version resolves plural suffixes and scans the options object with a
brace-balanced walk.
"""
import json
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path("/Users/molt/.paperclip/paperclip-src")
UI = REPO / "ui/src"
PLURAL_SUFFIXES = ("_one", "_other", "_zero", "_two", "_few", "_many")

en = json.loads((UI / "i18n/locales/en.json").read_text())
T_START = re.compile(r"""\bt\(\s*["']([A-Za-z0-9_.\-]+)["']""")
OPT_KEY = re.compile(r"(?:^|[,{])\s*(?:\.\.\.)?([A-Za-z_][A-Za-z0-9_]*)\s*(?=[:,}])")
PH = re.compile(r"\{\{\s*-?\s*([A-Za-z0-9_.\-]+)\s*(?:,[^}]*)?\}\}")


def lookup(dotted):
    # en.json ships mixed style: nested dicts (e.g. agentConfigPrimitives.choosePathButton.choose)
    # AND flat top-level keys with literal dots (e.g. "newIssueDialog.addReviewerApprover").
    # Try the literal-dot key first, then walk any top-level namespace, then fall back to
    # the original nested-default-namespace walk for backwards compatibility.
    if dotted in en and isinstance(en[dotted], str):
        return en[dotted]
    for k, v in en.items():
        if not isinstance(v, dict):
            continue
        node = v
        ok = True
        for part in dotted.split("."):
            if isinstance(node, dict) and part in node:
                node = node[part]
            else:
                ok = False
                break
        if ok and isinstance(node, str):
            return node
    node = en
    for part in dotted.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node if isinstance(node, str) else None


def resolve(key):
    """Return (value, form) where form is 'exact' | 'plural' | None."""
    direct = lookup(key)
    if direct is not None:
        return direct, "exact"
    for suffix in PLURAL_SUFFIXES:
        val = lookup(key + suffix)
        if val is not None:
            return val, "plural"
    return None, None


def read_options(text, idx):
    """From the char after the key literal, return the option identifier names.

    Walks the argument list with a brace/paren/bracket counter so nested objects,
    template literals and calls are handled. Returns None when there is no second
    argument at all.
    """
    n = len(text)
    i = idx
    while i < n and text[i] in " \t\r\n":
        i += 1
    if i >= n or text[i] != ",":
        return None
    i += 1
    while i < n and text[i] in " \t\r\n":
        i += 1
    if i >= n or text[i] != "{":
        return set()
    depth = 0
    start = i
    while i < n:
        ch = text[i]
        if ch in "{([":
            depth += 1
        elif ch in "})]":
            depth -= 1
            if depth == 0:
                break
        i += 1
    body = text[start : i + 1]
    # only top-level identifiers: strip nested {...} bodies before matching
    flat, depth2 = [], 0
    for ch in body[1:-1]:
        if ch in "{([":
            depth2 += 1
        elif ch in "})]":
            depth2 -= 1
        flat.append(ch if depth2 == 0 else " ")
    return set(OPT_KEY.findall("{" + "".join(flat) + "}"))


def changed_files():
    out = subprocess.run(["git", "-C", str(REPO), "status", "--short"], capture_output=True, text=True).stdout
    return [
        REPO / line[3:].strip()
        for line in out.splitlines()
        if not line.startswith("??") and line[3:].strip().endswith((".ts", ".tsx"))
    ]


def main():
    scope = changed_files() if "--changed" in sys.argv else sorted(UI.rglob("*.ts*"))
    undefined, mismatch, ok = [], [], 0
    for f in scope:
        if f.name.endswith((".test.ts", ".test.tsx", ".stories.tsx")):
            continue
        try:
            text = f.read_text()
        except Exception:
            continue
        rel = str(f.relative_to(REPO))
        for m in T_START.finditer(text):
            key = m.group(1)
            if "." not in key:
                continue
            line = text[: m.start()].count("\n") + 1
            val, form = resolve(key)
            if val is None:
                undefined.append({"file": rel, "line": line, "key": key})
                continue
            opts = read_options(text, m.end())
            if opts is None:
                opts = set()
            needed = set(PH.findall(val)) - {"count", "context"}
            missing = needed - opts
            if missing:
                mismatch.append(
                    {"file": rel, "line": line, "key": key, "needs": sorted(missing),
                     "passes": sorted(opts), "value": val}
                )
            else:
                ok += 1
    print(f"scanned {len(scope)} files — {ok} calls OK, {len(undefined)} undefined key(s), {len(mismatch)} placeholder mismatch(es)")
    for u in undefined[:25]:
        print(f"  UNDEFINED {u['file']}:{u['line']}  {u['key']}")
    for m in mismatch[:25]:
        print(f"  MISMATCH  {m['file']}:{m['line']}  {m['key']} needs {m['needs']} passes {m['passes'] or 'nothing'}")
    json.dump({"undefined": undefined, "mismatch": mismatch},
              open("/Users/molt/.paperclip/run-scratch/oop-3438-sweep/audit.json", "w"), indent=1)
    return 1 if (undefined or mismatch) else 0


sys.exit(main())
