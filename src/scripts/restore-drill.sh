#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return
  fi
  echo ""
}

if [[ $# -lt 1 ]]; then
  echo "Usage: bash src/scripts/restore-drill.sh <backup.sql.gz|backup.sql>"
  exit 1
fi

BACKUP_FILE="$1"
if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE"
  exit 1
fi

PROJECT="${DRILL_COMPOSE_PROJECT:-puntos-restore-drill}"
DRILL_PORT="${DRILL_PORT:-3201}"
BASE_URL="${DRILL_BASE_URL:-http://localhost:${DRILL_PORT}}"
COMPOSE_ARGS=(-f docker-compose.e2e.standalone.yml -p "$PROJECT")
STAMP="$(date +%Y%m%d_%H%M%S)"
REPORT_DIR="${RESTORE_DRILL_REPORT_DIR:-artifacts/restore-drills}"
REPORT_FILE="${REPORT_DIR}/restore_drill_${STAMP}.json"
STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
STARTED_TS="$(date +%s)"
DRILL_STATUS="failed"
DRILL_STAGE="starting"

cleanup() {
  docker compose "${COMPOSE_ARGS[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}

finish() {
  local exit_code=$?
  local finished_at finished_ts duration backup_sha backup_bytes
  finished_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  finished_ts="$(date +%s)"
  duration="$(( finished_ts - STARTED_TS ))"
  backup_sha="$(sha256_file "$BACKUP_FILE")"
  backup_bytes="$(wc -c < "$BACKUP_FILE" | tr -d ' ')"
  mkdir -p "$REPORT_DIR"
  node src/scripts/write-ops-report.mjs \
    --output "$REPORT_FILE" \
    --field type=restore_drill \
    --field status="$DRILL_STATUS" \
    --field stage="$DRILL_STAGE" \
    --field started_at="$STARTED_AT" \
    --field finished_at="$finished_at" \
    --field duration_seconds="$duration" \
    --field backup_file="$BACKUP_FILE" \
    --field backup_sha256="$backup_sha" \
    --field backup_bytes="$backup_bytes" \
    --field base_url="$BASE_URL" \
    --field compose_project="$PROJECT" \
    --field exit_code="$exit_code" >/dev/null 2>&1 || true
  echo "Restore drill report: $REPORT_FILE"
  cleanup
}
trap finish EXIT

export E2E_PORT="$DRILL_PORT"

DRILL_STAGE="verify_backup"
node src/scripts/verify-backup.mjs --file "$BACKUP_FILE"

echo "[restore-drill] Starting isolated DB + Redis..."
DRILL_STAGE="start_stack"
docker compose "${COMPOSE_ARGS[@]}" up -d db redis

echo "[restore-drill] Waiting for database..."
DRILL_STAGE="wait_for_database"
for _ in $(seq 1 30); do
  if docker compose "${COMPOSE_ARGS[@]}" exec -T db pg_isready -U loyalty_admin -d puntos_e2e >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "[restore-drill] Restoring backup into clean drill database..."
DRILL_STAGE="restore_database"
if [[ "$BACKUP_FILE" == *.gz ]]; then
  gzip -dc "$BACKUP_FILE" | docker compose "${COMPOSE_ARGS[@]}" exec -T db \
    psql -v ON_ERROR_STOP=1 -U loyalty_admin -d puntos_e2e
else
  cat "$BACKUP_FILE" | docker compose "${COMPOSE_ARGS[@]}" exec -T db \
    psql -v ON_ERROR_STOP=1 -U loyalty_admin -d puntos_e2e
fi

echo "[restore-drill] Starting API against restored data..."
DRILL_STAGE="start_api"
docker compose "${COMPOSE_ARGS[@]}" up -d api

DRILL_STAGE="smoke_check"
TIMEOUT=90 bash src/scripts/wait-for-api.sh "${BASE_URL}/api/health"
node src/scripts/deploy-smoke.mjs --base-url "$BASE_URL"

DRILL_STAGE="complete"
DRILL_STATUS="pass"
echo "[restore-drill] PASS base_url=${BASE_URL}"
