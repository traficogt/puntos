#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PROJECT="${DRILL_COMPOSE_PROJECT:-puntos-failure-drill}"
DRILL_PORT="${DRILL_PORT:-3401}"
DRILL_WORKER_PORT="${DRILL_WORKER_PORT:-3402}"
BASE_URL="${DRILL_BASE_URL:-http://localhost:${DRILL_PORT}}"
WORKER_BASE_URL="${DRILL_WORKER_BASE_URL:-http://localhost:${DRILL_WORKER_PORT}}"
SMOKE_SUPER_EMAIL="${SMOKE_SUPER_EMAIL:-super@example.com}"
SMOKE_SUPER_PASSWORD="${SMOKE_SUPER_PASSWORD:-super_password_123456}"
LOAD_REQUESTS="${LOAD_REQUESTS:-60}"
LOAD_CONCURRENCY="${LOAD_CONCURRENCY:-6}"
ALERTS_TOKEN="${ALERTS_TOKEN:-test-metrics-token}"
COMPOSE_ARGS=(-f docker-compose.e2e.standalone.yml -p "$PROJECT")

cleanup() {
  docker compose "${COMPOSE_ARGS[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

run_smoke() {
  SMOKE_SUPER_EMAIL="$SMOKE_SUPER_EMAIL" \
  SMOKE_SUPER_PASSWORD="$SMOKE_SUPER_PASSWORD" \
    npm run ops:smoke -- --base-url "$BASE_URL" --require-super-login
}

run_load() {
  LOAD_SUPER_EMAIL="$SMOKE_SUPER_EMAIL" \
  LOAD_SUPER_PASSWORD="$SMOKE_SUPER_PASSWORD" \
    node src/scripts/load-critical.mjs \
      --base-url "$BASE_URL" \
      --scenario mixed \
      --requests "$LOAD_REQUESTS" \
      --concurrency "$LOAD_CONCURRENCY"
}

run_alerts() {
  npm run ops:alerts:check -- \
    --scope all \
    --base-url "$BASE_URL" \
    --worker-base-url "$WORKER_BASE_URL" \
    --metrics-token "$ALERTS_TOKEN" \
    --mode evaluate
}

wait_stack() {
  TIMEOUT=90 bash src/scripts/wait-for-api.sh "${BASE_URL}/api/health"
  TIMEOUT=90 bash src/scripts/wait-for-api.sh "${WORKER_BASE_URL}/health"
}

restart_and_verify() {
  local service="$1"
  echo "[failure-drill] Restarting ${service}..."
  docker compose "${COMPOSE_ARGS[@]}" restart "$service"
  wait_stack
  run_smoke
  run_load
  run_alerts
}

export E2E_PORT="$DRILL_PORT"
export E2E_WORKER_PORT="$DRILL_WORKER_PORT"

echo "[failure-drill] Starting isolated stack (${PROJECT})..."
docker compose "${COMPOSE_ARGS[@]}" up -d --build db redis api worker
wait_stack

echo "[failure-drill] Baseline smoke + load"
run_smoke
run_load
run_alerts

restart_and_verify db
restart_and_verify redis
restart_and_verify api
restart_and_verify worker

echo "[failure-drill] PASS base_url=${BASE_URL} worker_base_url=${WORKER_BASE_URL}"
