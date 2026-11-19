## Summary

The `native-session-resume` test reads a retired authority epoch from the session root, but #19373 moved `authority-epochs` into the continuity archive. This PR reads the epoch from the archive.

The change is a single test-file edit; no production code is touched. `NATIVE_CONTINUITY_STATE_ENTRIES` keeps the behaviour #19373 intended.

### The defect

Upstream PR #19373 (commit `36643d937`) added `authority-epochs` and `launch-preparation.json` to `NATIVE_CONTINUITY_STATE_ENTRIES` in `server/src/services/native-runtime/native-session-root-entries.ts`. A continuity break therefore moves `authority-epochs` into `continuity-breaks/<archive>/`. That was the intent of #19373.

#19373 updated the sibling test it added (`native-recovered-owner-followup.test.ts`), but it did not update the older `server/src/services/native-runtime/native-session-resume.test.ts`, which still reads the epoch from the session root:

```ts
const [epoch] = await readdir(join(root, "authority-epochs"));
```

The failing test is `native-session-resume.test.ts > archives a damaged prior epoch before completing guarded same-task replacement with real runnerd`. It fails with:

```
Error: ENOENT: no such file or directory, scandir '<root>/authority-epochs'
    at src/services/native-runtime/native-session-resume.test.ts:1057:23
```

### Correction to an earlier framing

The defect is real, but upstream master is **not** red on its own CI — it is green at today's tip. The failing test is gated on `existsSync(defaultCapabilityRunnerdBinary())` (`packages/paperclip-runner/src/live/runnerd-codex-transport.ts`). That helper resolves to `packages/paperclip-runner/runner/target/debug/paperclip-runnerd`, and the `general-server` vitest lane does not build the Rust runner, so the test is **skipped** there. Upstream master's own check runs are green: at `1355f9354` (187 successful, 158 skipped, 159 cancelled, **0 failing**) and at the current tip `24132dac1` (**0 failing** — 33 successful, 36 skipped and 16 still running when the check was read). It fails in any checkout where the runner binary is built — a local dev tree, or a CI job that pre-builds the runner.

### The fix

Commit `457f8ac76bccee374be9d16bf10e74e090a8e59b` on branch `fix/native-session-resume-continuity-archive-epoch`, rebased onto upstream master `24132dac169fafc616615b4f3144e921aae8ad54` (2026-11-20). One file changed, 17 insertions and 5 deletions. The rebase is a semantic no-op: the patch id is identical (`bf4b4d4fca501cf7a6d1af471fde62e0ba9e68bc`) to the commit that was verified end to end below, because none of the 23 upstream commits in between touch this file:

```
server/src/services/native-runtime/native-session-resume.test.ts
```

It reads the epoch from the continuity archive, which is the layout the same retirement path produces, and asserts that the session root no longer holds `authority-epochs`.

### Verification

Same tree, same command, before and after the change:

```
node ./node_modules/vitest/vitest.mjs run --project @paperclipai/server \
  server/src/services/native-runtime/native-session-resume.test.ts
```

| Tree | Result |
| --- | --- |
| Upstream master content (2026-11-06, tree `4d49a3128`) | `Test Files 1 failed (1)` / `Tests 1 failed \| 56 passed (57)` — ENOENT at `native-session-resume.test.ts:950` |
| This branch (same tree, same command) | `Test Files 1 passed (1)` / `Tests 57 passed (57)` |
| Upstream master `1355f9354` (2026-11-19) | Defect still present; this branch rebases onto it cleanly (`git cherry-pick`, no conflict, no fuzz) |
| Upstream master `24132dac1` (2026-11-20) | Defect still present (`native-session-root-entries.ts:23` still lists `authority-epochs`; `native-session-resume.test.ts:1057` still reads the epoch from the session root); this branch rebases onto it cleanly and is 1 commit ahead of it |

On today's upstream master the defect and the fix's premise are unchanged:

- `server/src/services/native-runtime/native-session-root-entries.ts:23` still lists `authority-epochs` in `NATIVE_CONTINUITY_STATE_ENTRIES`;
- `server/src/services/native-runtime/native-session-resume.test.ts:1057` still reads `join(root, "authority-epochs")` — upstream's later edits to this file only moved the assertion down the file, the code is the same;
- `moveNativeContinuityState` (`server/src/services/native-runtime/native-session-executor.ts:6101`) still renames every continuity entry into `continuity-breaks/<archivedAt>-<uuid>/`, so the layout this PR reads is the layout the runtime produces.

Replaying the upstream implementation's own entry list and rename semantics reproduces both sides of the change:

```
OLD_PATH_ERRCODE = ENOENT
NEW_PATH_BYTES_MATCH = true
ROOT_AUTHORITY_EPOCHS_EXISTS = false
```

### Duplicate search

Searched upstream pull requests on 2026-11-20 for `native-session-resume`, `authority-epochs` and `continuity-breaks native` (open only), and listed the changed files of every open candidate: **102 open pull requests matched, and five of them touch the two files this PR touches** — #14474 (edits the environment fixture), #15389 (adds a hiring-prompt case), #15880 (pins the Codex command resolver), #18251 (targets the non-master base `codex/agent-budget-authorization`), #22152 (appends two entries to `NATIVE_SESSION_ROOT_HELD_ENTRIES`). **None of them changes the epoch read at the failing site, and no open pull request fixes this defect.** The related pull requests #19373 (origin of the change), #19806, #20146 and #19547 are closed.

---

The pull-request body:

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work
> - The native runner runtime keeps one durable state root per provider session
> - A continuity break retires that root and moves its state into `continuity-breaks/<archive>/`
> - PR #19373 added `authority-epochs` and `launch-preparation.json` to `NATIVE_CONTINUITY_STATE_ENTRIES`, so a continuity break now moves them too
> - PR #19373 updated the sibling test it added, but not the older `native-session-resume.test.ts`
> - That test still read the retired epoch from the session root, so it failed with ENOENT wherever the runner binary exists
> - This pull request reads the epoch from the continuity archive, which is the layout that the same retirement path produces
> - The benefit is a test that matches the runtime behaviour, and no red suite for any checkout that builds the runner

## Linked Issues or Issue Description

Refs: #19373

There is no upstream issue for this. The description follows the bug-report template.

**What happens**

`server/src/services/native-runtime/native-session-resume.test.ts` fails with:

```
Error: ENOENT: no such file or directory, scandir '<root>/authority-epochs'
    at src/services/native-runtime/native-session-resume.test.ts:1057:23
```

The failing test is `native-session-resume.test.ts > archives a damaged prior epoch before completing guarded same-task replacement with real runnerd`.

**Why it happens**

#19373 made `authority-epochs` a continuity-state entry. A continuity break now moves that directory into `continuity-breaks/<archive>/`. The test still read the epoch from the session root:

```ts
const [epoch] = await readdir(join(root, "authority-epochs"));
```

After the break the epoch lives at `continuity-breaks/<archive>/authority-epochs/<epoch>/runner-state.json`.

**Why CI did not catch it**

That test is gated on `existsSync(defaultCapabilityRunnerdBinary())`, which resolves to `packages/paperclip-runner/runner/target/debug/paperclip-runnerd`. The `general-server` vitest lane does not build the Rust runner, so the test is skipped there, and upstream master's own CI is green (0 failing check runs at `1355f9354` and at the current tip `24132dac1`). It fails in any checkout where the runner binary is built.

## What Changed

- Read the damaged prior epoch from the continuity archive instead of from the session root
- Assert that the session root no longer holds `authority-epochs` after the continuity break
- No runtime code changes

## Verification

Full suite, before this change, with the same tree and the same command (tree `4d49a3128`, node v24.22.1):

```
Test Files  1 failed (1)
     Tests  1 failed | 56 passed (57)
```

After this change:

```
Test Files  1 passed (1)
     Tests  57 passed (57)
```

Command:

```bash
node ./node_modules/vitest/vitest.mjs run --project @paperclipai/server \
  server/src/services/native-runtime/native-session-resume.test.ts
```

The branch was then rebased onto upstream master `1355f9354` (2026-11-19) and again onto `24132dac1` (2026-11-20). Both rebased commits carry the same patched hunk — upstream's later edits to this file only moved the assertion to line 1057 — and the second rebase is a semantic no-op (identical patch id), because none of the 23 upstream commits in between touch this file. It was re-checked on that tree: clean rebase with no conflict, the file still imports `existsSync` (so the added assertion compiles), the archive layout produced by `moveNativeContinuityState` is unchanged, and a path-level replay of the upstream rename semantics reproduces the ENOENT before the change and the correct read after it.

## Risks

Low risk. This change touches one test file. It does not change runtime behaviour. The new assertions match the layout that the sibling test added in #19373 asserts for the same retirement path.

## Model Used

- Provider and model name: MiniMax — MiniMax M3.1 Flash
- Exact model ID: `MiniMax-M3.1-Flash`
- Context window: 596k tokens
- Reasoning mode: standard (no extended thinking)
- Capability details: agentic tool use (local shell, file edits, git, GitHub API). The change was produced by an autonomous agent that reproduced the failure, wrote the fix, and ran the suite before and after.

## Checklist

- [x] I have included a thinking path that traces from project context to this change
- [x] I have specified the model used (with version and capability details)
- [x] I have checked ROADMAP.md and confirmed this PR does not duplicate planned core work
- [x] I have searched GitHub for duplicate or related PRs and linked them above
- [x] I have either (a) linked existing issues with `Fixes: #` / `Closes: #` / `Refs: #` OR (b) described the issue in-PR following the relevant issue template
- [x] I have not referenced internal/instance-local Paperclip issues or links (only public GitHub `#NNN` / `github.com/paperclipai/paperclip` URLs)
- [x] My branch name describes the change (e.g. `docs/...`, `fix/...`) and contains no internal Paperclip ticket id or instance-derived details
- [x] I have run tests locally and they pass
- [x] I have added or updated tests where applicable
- [x] I have updated relevant documentation to reflect my changes (not applicable — test-only change)
- [x] I have considered and documented any risks above
- [ ] All Paperclip CI gates are green (not run locally; the `general-server` lane skips this test)
- [ ] Greptile is 5/5 with no open P2s, recommendations, or follow-ups
- [x] I will address all Greptile and reviewer comments before requesting merge

