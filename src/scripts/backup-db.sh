#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DB_NAME="${DB_NAME:-puntos}"
BACKUP_DB_USER="${BACKUP_DB_USER:-${DB_MIGRATIONS_USER:-${DB_USER:-loyalty}}}"
OUT_DIR="${1:-${BACKUP_DIR:-backups}}"
STAMP="$(date -u +%Y%m%d_%H%M%S)"
OUT_FILE="${OUT_DIR}/puntos_${STAMP}.sql.gz"
MANIFEST_FILE="${OUT_FILE}.json"
SHA_FILE="${OUT_FILE}.sha256"

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

mkdir -p "$OUT_DIR"
TMP_FILE="$(mktemp "${OUT_DIR}/.puntos_${STAMP}.XXXXXX.sql.gz")"
cleanup() {
  rm -f "$TMP_FILE" "${TMP_FILE}.sha256" "${TMP_FILE}.json"
}
trap cleanup EXIT

echo "Creating backup: ${OUT_FILE}"
# Use the database container's local socket. Never pass application passwords
# on the command line; BACKUP_DB_USER must be allowed to read all tenant rows.
docker compose exec -T db pg_dump \
    -U "$BACKUP_DB_USER" \
    -d "$DB_NAME" \
    --no-password \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
  | gzip -9 > "$TMP_FILE"

node src/scripts/verify-backup.mjs --file "$TMP_FILE" >/dev/null
SHA256="$(sha256_file "$TMP_FILE")"
BYTES="$(wc -c < "$TMP_FILE" | tr -d ' ')"

[[ -n "$SHA256" ]] || { echo "A SHA-256 checksum tool is required." >&2; exit 1; }
printf "%s  %s\n" "$SHA256" "$(basename "$OUT_FILE")" > "${TMP_FILE}.sha256"

node src/scripts/write-ops-report.mjs \
  --output "${TMP_FILE}.json" \
  --field type=backup \
  --field status=pass \
  --field file="$OUT_FILE" \
  --field bytes="$BYTES" \
  --field sha256="$SHA256" \
  --field db_name="$DB_NAME" \
  --field db_user="$BACKUP_DB_USER" >/dev/null

node src/scripts/verify-backup.mjs --file "$TMP_FILE" --require-metadata >/dev/null
# A hard link publishes only a complete verified dump and refuses collisions.
ln "$TMP_FILE" "$OUT_FILE"
mv "${TMP_FILE}.sha256" "$SHA_FILE"
mv "${TMP_FILE}.json" "$MANIFEST_FILE"

echo "Backup complete."
echo "Backup file: $OUT_FILE"
echo "Backup manifest: $MANIFEST_FILE"
