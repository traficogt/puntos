#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PROJECT="${ALERTS_COMPOSE_PROJECT:-puntos-alerts-drill}"
ALERTS_PORT="${ALERTS_PORT:-3501}"
ALERTS_WORKER_PORT="${ALERTS_WORKER_PORT:-3502}"
BASE_URL="${ALERTS_BASE_URL:-http://localhost:${ALERTS_PORT}}"
WORKER_BASE_URL="${ALERTS_WORKER_BASE_URL:-http://localhost:${ALERTS_WORKER_PORT}}"
ALERTS_TOKEN="${ALERTS_TOKEN:-test-metrics-token}"
COMPOSE_ARGS=(-f docker-compose.e2e.standalone.yml -p "$PROJECT")

cleanup() {
  docker compose "${COMPOSE_ARGS[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

export E2E_PORT="$ALERTS_PORT"
export E2E_WORKER_PORT="$ALERTS_WORKER_PORT"

echo "[alerts-drill] Starting isolated stack (${PROJECT})..."
docker compose "${COMPOSE_ARGS[@]}" up -d --build db redis api worker

TIMEOUT=90 bash src/scripts/wait-for-api.sh "${BASE_URL}/api/health"
TIMEOUT=90 bash src/scripts/wait-for-api.sh "${WORKER_BASE_URL}/health"

echo "[alerts-drill] Checking metric presence"
npm run ops:alerts:check -- \
  --scope all \
  --base-url "$BASE_URL" \
  --worker-base-url "$WORKER_BASE_URL" \
  --metrics-token "$ALERTS_TOKEN" \
  --mode presence

echo "[alerts-drill] Evaluating alert thresholds"
npm run ops:alerts:check -- \
  --scope all \
  --base-url "$BASE_URL" \
  --worker-base-url "$WORKER_BASE_URL" \
  --metrics-token "$ALERTS_TOKEN" \
  --mode evaluate

echo "[alerts-drill] PASS base_url=${BASE_URL} worker_base_url=${WORKER_BASE_URL}"
