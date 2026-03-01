#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_ARGS=(-f docker-compose.e2e.standalone.yml -p "${E2E_COMPOSE_PROJECT:-puntos-e2e}")
E2E_PORT="${E2E_PORT:-3101}"
# Host URL used for health checks (published port).
BASE_URL="${E2E_BASE_URL:-http://localhost:${E2E_PORT}}"
# URL used by Playwright when running inside the compose network.
INTERNAL_BASE_URL="${E2E_BASE_URL_INTERNAL:-http://api:3001}"
RUNNER="${E2E_RUNNER:-docker}" # docker | host
PLAYWRIGHT_OPTS=("$@")

cleanup() {
  docker compose "${COMPOSE_ARGS[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "$ROOT_DIR"

echo "[e2e] Starting isolated stack (${COMPOSE_ARGS[-1]})..."
export PORT="${E2E_PORT}"
export E2E_PORT
docker compose "${COMPOSE_ARGS[@]}" up -d --build

echo "[e2e] Waiting for API health (max 60s)..."
for _ in $(seq 1 30); do
  if docker compose "${COMPOSE_ARGS[@]}" exec -T api node -e "(async()=>{try{const r=await fetch('http://127.0.0.1:3001/api/health');process.exit(r.ok?0:1);}catch{process.exit(1);}})();" >/dev/null 2>&1; then
    echo "[e2e] Stack is healthy."
    if [[ "$RUNNER" == "host" ]]; then
      PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-0}" E2E_BASE_URL="$BASE_URL" npx playwright test --timeout=60000 --reporter=line "${PLAYWRIGHT_OPTS[@]}"
      exit 0
    fi

    # Default: run Playwright inside the official Playwright container (browsers included).
    pw_args=(npx playwright test --timeout=60000 --reporter=line "${PLAYWRIGHT_OPTS[@]}")
    pw_cmd="$(printf '%q ' "${pw_args[@]}")"
    docker compose "${COMPOSE_ARGS[@]}" run --rm -e CI=1 -e "E2E_BASE_URL=${INTERNAL_BASE_URL}" e2e "$pw_cmd"
    exit 0
  fi
  sleep 2
done

echo "[e2e] API did not become healthy in time. Recent logs:"
docker compose "${COMPOSE_ARGS[@]}" logs --tail=120 api db redis || true
exit 1
