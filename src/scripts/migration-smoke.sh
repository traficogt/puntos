#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_ARGS=(-f docker-compose.e2e.standalone.yml -p "${MIGRATION_SMOKE_PROJECT:-puntos-migration-smoke}")

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

dump_logs() {
  docker compose "${COMPOSE_ARGS[@]}" logs --tail=160 db api redis || true
}

trap 'status=$?; if [[ $status -ne 0 ]]; then echo "[migrate-smoke] Failure detected. Recent logs:"; dump_logs; fi; cleanup; exit $status' EXIT

cd "$ROOT_DIR"

echo "[migrate-smoke] Building API image..."
docker compose "${COMPOSE_ARGS[@]}" build api >/dev/null

echo "[migrate-smoke] Starting fresh DB + Redis..."
docker compose "${COMPOSE_ARGS[@]}" up -d db redis >/dev/null

echo "[migrate-smoke] Waiting for Postgres..."
for _ in $(seq 1 30); do
  if docker compose "${COMPOSE_ARGS[@]}" exec -T db pg_isready -U loyalty_admin -d puntos_e2e >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker compose "${COMPOSE_ARGS[@]}" exec -T db pg_isready -U loyalty_admin -d puntos_e2e >/dev/null

echo "[migrate-smoke] Applying migrations on an empty database..."
docker compose "${COMPOSE_ARGS[@]}" run --rm api node src/scripts/migrations.mjs apply >/dev/null

echo "[migrate-smoke] Verifying migration doctor + lock..."
docker compose "${COMPOSE_ARGS[@]}" run --rm api node src/scripts/migrations-doctor.mjs >/dev/null
docker compose "${COMPOSE_ARGS[@]}" run --rm api node src/scripts/migrations-lock.mjs >/dev/null

echo "[migrate-smoke] Re-applying migrations on a primed database..."
docker compose "${COMPOSE_ARGS[@]}" run --rm api node src/scripts/migrations.mjs apply >/dev/null

echo "[migrate-smoke] Booting API against the migrated schema..."
docker compose "${COMPOSE_ARGS[@]}" up -d api >/dev/null
TIMEOUT=90 bash src/scripts/wait-for-api.sh "http://localhost:${E2E_PORT:-3101}/api/health" >/dev/null

echo "[migrate-smoke] PASS"
