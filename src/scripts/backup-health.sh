#!/usr/bin/env bash
set -euo pipefail

DIR="backups"
MAX_AGE_HOURS=24
WARN_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      DIR="${2:-backups}"
      shift 2
      ;;
    --max-age-hours)
      MAX_AGE_HOURS="${2:-24}"
      shift 2
      ;;
    --warn-only)
      WARN_ONLY=1
      shift
      ;;
    *)
      echo "Unknown arg: $1"
      echo "Usage: bash src/scripts/backup-health.sh [--dir backups] [--max-age-hours 24] [--warn-only]"
      exit 1
      ;;
  esac
done

mkdir -p "$DIR"

LATEST_FILE="$(ls -1t "$DIR"/puntos_*.sql.gz 2>/dev/null | head -n 1 || true)"
if [[ -z "$LATEST_FILE" ]]; then
  echo "BACKUP_HEALTH=FAIL message='No backup files found' dir='${DIR}'"
  if [[ "$WARN_ONLY" -eq 1 ]]; then
    exit 0
  fi
  exit 2
fi

NOW_EPOCH="$(date +%s)"
FILE_EPOCH="$(stat -c %Y "$LATEST_FILE")"
AGE_SEC=$(( NOW_EPOCH - FILE_EPOCH ))
AGE_HOURS=$(( AGE_SEC / 3600 ))

if [[ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]]; then
  echo "BACKUP_HEALTH=FAIL message='Backup too old' file='${LATEST_FILE}' age_hours=${AGE_HOURS} max_age_hours=${MAX_AGE_HOURS}"
  if [[ "$WARN_ONLY" -eq 1 ]]; then
    exit 0
  fi
  exit 3
fi

if command -v stat >/dev/null 2>&1; then
  SIZE_BYTES="$(stat -c %s "$LATEST_FILE" 2>/dev/null || echo 0)"
else
  SIZE_BYTES=0
fi

echo "BACKUP_HEALTH=OK file='${LATEST_FILE}' age_hours=${AGE_HOURS} max_age_hours=${MAX_AGE_HOURS} size_bytes=${SIZE_BYTES}"
