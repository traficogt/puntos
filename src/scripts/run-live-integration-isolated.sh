#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_ARGS=(-f docker-compose.e2e.standalone.yml -p "${E2E_COMPOSE_PROJECT:-puntos-live-integration}")
INTERNAL_BASE_URL="${TEST_API_URL:-http://api:3001}"
random_secret() {
  node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))"
}

E2E_APP_DB_PASSWORD="${E2E_APP_DB_PASSWORD:-$(random_secret)}"
E2E_DB_ADMIN_PASSWORD="${E2E_DB_ADMIN_PASSWORD:-$(random_secret)}"
E2E_SUPER_ADMIN_PASSWORD="${E2E_SUPER_ADMIN_PASSWORD:-$(random_secret)}"
export E2E_APP_DB_PASSWORD E2E_DB_ADMIN_PASSWORD E2E_SUPER_ADMIN_PASSWORD

APP_DB_USER="${APP_DB_USER:-loyalty_app}"
APP_DB_PASSWORD="${APP_DB_PASSWORD:-$E2E_APP_DB_PASSWORD}"
TEST_DB_HOST="${TEST_DB_HOST:-db}"
TEST_DB_PORT="${TEST_DB_PORT:-5432}"
TEST_DB_NAME="${TEST_DB_NAME:-puntos_e2e}"
TEST_DB_USER="${TEST_DB_USER:-loyalty_admin}"
TEST_DB_PASSWORD="${TEST_DB_PASSWORD:-$E2E_DB_ADMIN_PASSWORD}"

cleanup() {
  docker compose "${COMPOSE_ARGS[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}

dump_logs() {
  docker compose "${COMPOSE_ARGS[@]}" logs --tail=160 api db redis || true
}

trap 'status=$?; if [[ $status -ne 0 ]]; then echo "[live] Failure detected. Recent logs:"; dump_logs; fi; cleanup; exit $status' EXIT

cd "$ROOT_DIR"

echo "[live] Starting isolated integration stack (${COMPOSE_ARGS[-1]})..."
docker compose "${COMPOSE_ARGS[@]}" up -d --build db redis api

echo "[live] Waiting for API health (max 90s)..."
for _ in $(seq 1 45); do
  if docker compose "${COMPOSE_ARGS[@]}" exec -T api node -e "(async()=>{try{const r=await fetch('http://127.0.0.1:3001/api/health');process.exit(r.ok?0:1);}catch{process.exit(1);}})();" >/dev/null 2>&1; then
    echo "[live] API is healthy."
    break
  fi
  sleep 2
done

if ! docker compose "${COMPOSE_ARGS[@]}" exec -T api node -e "(async()=>{try{const r=await fetch('http://127.0.0.1:3001/api/health');process.exit(r.ok?0:1);}catch{process.exit(1);}})();" >/dev/null 2>&1; then
  echo "[live] API failed to become healthy. Recent logs:"
  docker compose "${COMPOSE_ARGS[@]}" logs --tail=120 api db redis || true
  exit 1
fi

echo "[live] Re-applying explicit runtime grants to the compose app role..."
docker compose "${COMPOSE_ARGS[@]}" exec -T api \
  env APP_DB_USER="$APP_DB_USER" APP_DB_PASSWORD="$APP_DB_PASSWORD" \
  node src/scripts/create-app-role.mjs

echo "[live] Restarting API under the restricted runtime role..."
docker compose "${COMPOSE_ARGS[@]}" restart api >/dev/null
TIMEOUT=90 bash src/scripts/wait-for-api.sh "http://localhost:${E2E_PORT:-3101}/api/health"

echo "[live] Running super-admin smoke gate under the restricted role..."
docker compose "${COMPOSE_ARGS[@]}" run --rm \
  -e TEST_API_URL="$INTERNAL_BASE_URL" \
  api \
  node src/scripts/deploy-smoke.mjs --base-url "$INTERNAL_BASE_URL" --require-super-login

echo "[live] Running owner-authenticated ledger certification smoke..."
docker compose "${COMPOSE_ARGS[@]}" run --rm \
  -e TEST_API_URL="$INTERNAL_BASE_URL" \
  -e SUPER_ADMIN_EMAIL="superadmin@example.com" \
  -e SUPER_ADMIN_PASSWORD="$E2E_SUPER_ADMIN_PASSWORD" \
  api \
  node src/scripts/live-ledger-certification-check.mjs

echo "[live] Running owner-authenticated ledger correction smoke..."
docker compose "${COMPOSE_ARGS[@]}" run --rm \
  -e TEST_API_URL="$INTERNAL_BASE_URL" \
  -e SUPER_ADMIN_EMAIL="superadmin@example.com" \
  -e SUPER_ADMIN_PASSWORD="$E2E_SUPER_ADMIN_PASSWORD" \
  api \
  node src/scripts/live-ledger-correction-check.mjs

echo "[live] Running refund + rollover integration tests..."
docker compose "${COMPOSE_ARGS[@]}" run --rm \
  -v "${ROOT_DIR}/tests:/app/tests:ro" \
  -e RUN_INTEGRATION=true \
  -e TEST_API_URL="$INTERNAL_BASE_URL" \
  -e TEST_DB_HOST="$TEST_DB_HOST" \
  -e TEST_DB_PORT="$TEST_DB_PORT" \
  -e TEST_DB_NAME="$TEST_DB_NAME" \
  -e TEST_DB_USER="$TEST_DB_USER" \
  -e TEST_DB_PASSWORD="$TEST_DB_PASSWORD" \
  api \
  node --test tests/integration/refund-gamification.test.js tests/integration/recurring-gamification.test.js

echo "[live] Running duplicate redeem/refund ledger check..."
docker compose "${COMPOSE_ARGS[@]}" run --rm \
  -e TEST_API_URL="$INTERNAL_BASE_URL" \
  -e SUPER_ADMIN_EMAIL="superadmin@example.com" \
  -e SUPER_ADMIN_PASSWORD="$E2E_SUPER_ADMIN_PASSWORD" \
  api \
  node src/scripts/live-staff-ledger-check.mjs
