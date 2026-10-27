#!/usr/bin/env bash
# rebuild-and-swap.sh — Rebuild UI from local master and update the dist the
# running server serves. After the OOP-3094 merge to fork master (commit
# a9513b32 in this repo, on Ericlyh/paperclip), the filter code lives in
# master source, so a vanilla `pnpm build` from master is enough — no
# cross-worktree swap is needed anymore. This script is kept for parity
# with older heartbeats; it now just rebuilds master.
set -euo pipefail

REPO_ROOT="/Users/molt/.paperclip/paperclip-src"

cd "$REPO_ROOT"
echo "==> git fetch fork"
git fetch fork master 2>/dev/null || true

echo "==> build (vite, master)"
cd "$REPO_ROOT/ui"
NODE_ENV=development ./node_modules/.bin/vite build

HASH=$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' dist/index.html | head -1)
echo "==> html now references: $HASH"
if [ -n "$HASH" ]; then
  STATUS=$(curl -s -o /tmp/oop3094-verify.js -w '%{http_code}' "http://127.0.0.1:3100/$HASH" || echo "000")
  HITS=$(grep -c 'Hide hourly-log-rotation\|hideHourlyLogRotationTasks' /tmp/oop3094-verify.js || echo 0)
  echo "==> http $STATUS  hourly-log-rotation hits: $HITS"
  if [ "$STATUS" != "200" ] || [ "$HITS" = "0" ]; then
    echo "ERROR: server is not serving the new bundle — investigate before declaring done"
    exit 2
  fi
fi

echo "==> done. dist at $REPO_ROOT/ui/dist"
