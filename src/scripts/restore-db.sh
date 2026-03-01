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
  echo "Usage: bash src/scripts/restore-db.sh <backup.sql.gz|backup.sql> [--yes]"
  exit 1
fi

BACKUP_FILE="$1"
AUTO_CONFIRM="${2:-}"
STAMP="$(date +%Y%m%d_%H%M%S)"
REPORT_DIR="${RESTORE_REPORT_DIR:-artifacts/restores}"
REPORT_FILE="${REPORT_DIR}/restore_${STAMP}.json"
PRE_RESTORE_DIR="${PRE_RESTORE_DIR:-backups/pre_restore}"
STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
STARTED_TS="$(date +%s)"
RESTORE_STATUS="failed"
RESTORE_STAGE="starting"
PRE_RESTORE_BACKUP=""

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE"
  exit 1
fi

finish() {
  local exit_code=$?
  local finished_at finished_ts duration backup_sha
  finished_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  finished_ts="$(date +%s)"
  duration="$(( finished_ts - STARTED_TS ))"
  backup_sha="$(sha256_file "$BACKUP_FILE")"
  mkdir -p "$REPORT_DIR"
  node src/scripts/write-ops-report.mjs \
    --output "$REPORT_FILE" \
    --field type=restore \
    --field status="$RESTORE_STATUS" \
    --field stage="$RESTORE_STAGE" \
    --field started_at="$STARTED_AT" \
    --field finished_at="$finished_at" \
    --field duration_seconds="$duration" \
    --field backup_file="$BACKUP_FILE" \
    --field backup_sha256="$backup_sha" \
    --field pre_restore_backup="$PRE_RESTORE_BACKUP" \
    --field db_name="${DB_NAME:-}" \
    --field db_user="${DB_USER:-}" \
    --field exit_code="$exit_code" >/dev/null 2>&1 || true
  echo "Restore report: $REPORT_FILE"
}
trap finish EXIT

RESTORE_STAGE="verify_backup"
node src/scripts/verify-backup.mjs --file "$BACKUP_FILE"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DB_NAME="${DB_NAME:-puntos}"
DB_USER="${DB_USER:-loyalty}"
DB_PASSWORD="${DB_PASSWORD:-}"

if [[ "$AUTO_CONFIRM" != "--yes" ]]; then
  echo "This will overwrite current data in DB '${DB_NAME}'."
  read -r -p "Continue? (yes/no): " ANSWER
  if [[ "$ANSWER" != "yes" ]]; then
    echo "Cancelled."
    exit 1
  fi
fi

echo "Creating safety backup before restore..."
RESTORE_STAGE="safety_backup"
bash src/scripts/backup-db.sh "$PRE_RESTORE_DIR"
PRE_RESTORE_BACKUP="$(ls -1t "$PRE_RESTORE_DIR"/puntos_*.sql.gz 2>/dev/null | head -n 1 || true)"

echo "Restoring from: ${BACKUP_FILE}"
RESTORE_STAGE="restore_database"
if [[ "$BACKUP_FILE" == *.gz ]]; then
  gzip -dc "$BACKUP_FILE" | docker compose exec -T \
    -e PGPASSWORD="$DB_PASSWORD" \
    db psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME"
else
  cat "$BACKUP_FILE" | docker compose exec -T \
    -e PGPASSWORD="$DB_PASSWORD" \
    db psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME"
fi

RESTORE_STAGE="complete"
RESTORE_STATUS="pass"
echo "Restore complete."
