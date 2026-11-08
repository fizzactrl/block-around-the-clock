#!/usr/bin/env bash
# Start backend (Flask :5050) and frontend (Vite :5173) together. Ctrl+C stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -d "$ROOT/backend/.venv" ]; then
  echo "→ Creating Python venv and installing backend dependencies"
  python3 -m venv "$ROOT/backend/.venv"
  "$ROOT/backend/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
fi
[ -f "$ROOT/backend/.env" ] || cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
[ -d "$ROOT/frontend/node_modules" ] || (echo "→ Installing frontend dependencies" && npm --prefix "$ROOT/frontend" install)

trap 'kill 0' EXIT INT TERM
(cd "$ROOT/backend" && .venv/bin/python run.py) &
(cd "$ROOT/frontend" && npx vite --port 5173) &
echo "→ Block Around the Clock: http://localhost:5173  (API http://127.0.0.1:5050/api/health)"
wait
