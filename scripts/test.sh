#!/usr/bin/env bash
# Run all automated smoke tests.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "── Backend (pytest)";  (cd "$ROOT/backend" && .venv/bin/python -m pytest -q)
echo "── Frontend (vitest)"; (cd "$ROOT/frontend" && npx vitest run)
echo "── Frontend typecheck + build"; (cd "$ROOT/frontend" && npx tsc -p . && npx vite build >/dev/null && echo "build ok")
