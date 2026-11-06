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
    at src/services/native-runtime/native-session-resume.test.ts:950:23
```

### Correction to an earlier framing

The defect is real, but upstream master is **not** red on its own CI. The failing test is gated on `existsSync(defaultCapabilityRunnerdBinary())`. That function resolves to `packages/paperclip-runner/runner/target/debug/paperclip-runnerd`, and the `general-server` vitest lane does not build the Rust runner, so the test is **skipped** there (`57 tests | 2 skipped`). It fails in any checkout where the runner binary is built.

### The fix

Commit `586c8e442ffe163b8056622535c21600863f89f5` on branch `fix/native-session-resume-continuity-archive-epoch`, one file changed, 17 insertions and 5 deletions:

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
| Upstream master content | `Test Files 1 failed (1)` / `Tests 1 failed \| 56 passed (57)` — ENOENT at `native-session-resume.test.ts:950` |
| This branch | `Test Files 1 passed (1)` / `Tests 57 passed (57)` |
| Upstream master `8621bcf53` (2026-11-07) | Defect still present at current master; this change applies cleanly (`git apply --check`, no fuzz) |

### Duplicate search

Searched upstream pull requests for `native-session-resume`, `authority-epochs`, `continuity-breaks` and `continuity break archive`. No open pull request touches this assertion. The related pull requests #19373 (origin of the change), #17616, #18846 and #17925 are all closed.

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
    at src/services/native-runtime/native-session-resume.test.ts:950:23
```

The failing test is `native-session-resume.test.ts > archives a damaged prior epoch before completing guarded same-task replacement with real runnerd`.

**Why it happens**

#19373 made `authority-epochs` a continuity-state entry. A continuity break now moves that directory into `continuity-breaks/<archive>/`. The test still read the epoch from the session root:

```ts
const [epoch] = await readdir(join(root, "authority-epochs"));
```

After the break the epoch lives at `continuity-breaks/<archive>/authority-epochs/<epoch>/runner-state.json`.

**Why CI did not catch it**

That test is gated on `existsSync(defaultCapabilityRunnerdBinary())`. That function resolves to `packages/paperclip-runner/runner/target/debug/paperclip-runnerd`, and the `general-server` vitest lane does not build the Rust runner, so the test is skipped there (`57 tests | 2 skipped`). It fails in any checkout where the runner binary is built.

## What Changed

- Read the damaged prior epoch from the continuity archive instead of from the session root
- Assert that the session root no longer holds `authority-epochs` after the continuity break
- No runtime code changes

## Verification

Before this change, with the same tree and the same command:

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

