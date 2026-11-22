#!/usr/bin/env bash
# Mirror the local backup directory to an offsite Hetzner Storage Box over SSH.
# Key-based auth only (no password in automation); config from the environment
# (see /etc/puntos-backup.env). Unset/disabled OFFSITE_HOST is a safe no-op.
set -euo pipefail
umask 077
if [[ -f ".env" ]]; then set -a; source .env; set +a; fi

DIR="${1:-${BACKUP_DIR:-/var/backups/puntos}}"
HOST="${OFFSITE_HOST:-}"; USER_="${OFFSITE_USER:-}"; PORT="${OFFSITE_PORT:-23}"
REMOTE="${OFFSITE_PATH:-backups}"; KEY="${OFFSITE_SSH_KEY:-/root/.ssh/pf_storagebox}"

if [[ "${OFFSITE_ENABLED:-0}" != "1" || -z "$HOST" || -z "$USER_" ]]; then
  echo "OFFSITE_SYNC=SKIP (offsite not configured)"; exit 0
fi
[[ -d "$DIR" ]] || { echo "OFFSITE_SYNC=ERROR missing local dir $DIR" >&2; exit 1; }
# Safety: never let an empty local dir wipe the offsite copy via --delete.
ls "$DIR"/*.sql.gz >/dev/null 2>&1 || { echo "OFFSITE_SYNC=SKIP (no backups to sync)"; exit 0; }

rsync -az --delete \
  -e "ssh -p ${PORT} -i ${KEY} -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
  "${DIR}/" "${USER_}@${HOST}:${REMOTE}/"
echo "OFFSITE_SYNC=OK dir='${DIR}' remote='${USER_}@${HOST}:${REMOTE}'"
