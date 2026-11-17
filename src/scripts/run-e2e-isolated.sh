#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_ARGS=(-f docker-compose.e2e.standalone.yml -p "${E2E_COMPOSE_PROJECT:-puntos-e2e}")
E2E_PORT="${E2E_PORT:-3101}"
# Host URL used for health checks (published port).
BASE_URL="${E2E_BASE_URL:-http://localhost:${E2E_PORT}}"
# URL used by Playwright inside the API container's network namespace.
INTERNAL_BASE_URL="${E2E_BASE_URL_INTERNAL:-http://localhost:3001}"
RUNNER="${E2E_RUNNER:-docker}" # docker | host
PLAYWRIGHT_OPTS=("$@")

if [[ "$RUNNER" == "docker" ]]; then
  # Containerized browsers reach the API as localhost:3001, not the host-published
  # port. Links and redirects built from the app and marketing origins use it too.
  export E2E_APP_ORIGIN="${E2E_APP_ORIGIN:-$INTERNAL_BASE_URL}"
  export E2E_MARKETING_ORIGIN="${E2E_MARKETING_ORIGIN:-$INTERNAL_BASE_URL}"
fi

# Healthy and no longer restarting. On a fresh database the API and worker race
# to apply migrations, so the API can restart right after its first health check;
# the containerized browser shares its network and would lose it on a restart.
last_restarts=""
stable_checks=0
api_ready() {
  local id restarts
  id="$(docker compose "${COMPOSE_ARGS[@]}" ps -q api)"
  restarts="$(docker inspect "$id" --format '{{.RestartCount}}' 2>/dev/null || echo unknown)"
  if docker compose "${COMPOSE_ARGS[@]}" exec -T api node -e "(async()=>{try{const r=await fetch('http://127.0.0.1:3001/api/health');process.exit(r.ok?0:1);}catch{process.exit(1);}})();" >/dev/null 2>&1 \
    && [[ "$restarts" == "$last_restarts" ]]; then
    stable_checks=$((stable_checks + 1))
  else
    stable_checks=0
  fi
  last_restarts="$restarts"
  [[ $stable_checks -ge 3 ]]
}

random_secret() {
  node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))"
}

E2E_APP_DB_PASSWORD="${E2E_APP_DB_PASSWORD:-$(random_secret)}"
E2E_DB_ADMIN_PASSWORD="${E2E_DB_ADMIN_PASSWORD:-$(random_secret)}"
E2E_SUPER_ADMIN_PASSWORD="${E2E_SUPER_ADMIN_PASSWORD:-$(random_secret)}"
export E2E_APP_DB_PASSWORD E2E_DB_ADMIN_PASSWORD E2E_SUPER_ADMIN_PASSWORD

cleanup() {
  docker compose "${COMPOSE_ARGS[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "$ROOT_DIR"

echo "[e2e] Starting isolated stack (${COMPOSE_ARGS[-1]})..."
export PORT="${E2E_PORT}"
export E2E_PORT
docker compose "${COMPOSE_ARGS[@]}" up -d --build

echo "[e2e] Waiting for a stable, healthy API (max 90s)..."
for _ in $(seq 1 45); do
  if api_ready; then
    echo "[e2e] Stack is healthy."
    if [[ "$RUNNER" == "host" ]]; then
      FIXTURE_SUPER_EMAIL="$(
        unset SUPER_ADMIN_EMAIL
        source deploy/e2e/api.env
        printf '%s' "${SUPER_ADMIN_EMAIL:?SUPER_ADMIN_EMAIL is missing from the E2E fixture}"
      )"
      SUPER_ADMIN_EMAIL="$FIXTURE_SUPER_EMAIL" SUPER_ADMIN_PASSWORD="$E2E_SUPER_ADMIN_PASSWORD" \
        PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-0}" E2E_BASE_URL="$BASE_URL" \
        npx playwright test --timeout=60000 --reporter=line "${PLAYWRIGHT_OPTS[@]}"
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
