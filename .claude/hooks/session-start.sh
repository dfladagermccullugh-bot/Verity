#!/bin/bash
set -euo pipefail

# Verity SessionStart hook — installs dependencies so typecheck, lint, and the
# vitest suite run immediately in Claude Code on the web. A fresh remote clone
# has no node_modules; without this the first `npm test`/`npm run lint` fails.
#
# Web-only: skip on local machines (developers manage their own installs).
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# `npm install` (not `ci`) so a warm, cached container reuses node_modules and
# this is cheap to re-run; idempotent and non-interactive.
npm install --no-audit --no-fund
