#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DB_NAME="${DB_NAME:-puntos}"
DB_USER="${DB_USER:-loyalty}"
DB_PASSWORD="${DB_PASSWORD:-}"
OUT_DIR="${1:-backups}"
STAMP="$(date +%Y%m%d_%H%M%S)"
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

echo "Creating backup: ${OUT_FILE}"
docker compose exec -T \
  -e PGPASSWORD="$DB_PASSWORD" \
  db pg_dump \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
  | gzip -9 > "$OUT_FILE"

SHA256="$(sha256_file "$OUT_FILE")"
BYTES="$(wc -c < "$OUT_FILE" | tr -d ' ')"

if [[ -n "$SHA256" ]]; then
  printf "%s  %s\n" "$SHA256" "$(basename "$OUT_FILE")" > "$SHA_FILE"
  echo "SHA256: $SHA256"
fi

node src/scripts/write-ops-report.mjs \
  --output "$MANIFEST_FILE" \
  --field type=backup \
  --field status=pass \
  --field file="$OUT_FILE" \
  --field bytes="$BYTES" \
  --field sha256="$SHA256" \
  --field db_name="$DB_NAME" \
  --field db_user="$DB_USER"

node src/scripts/verify-backup.mjs --file "$OUT_FILE"

echo "Backup complete."
echo "Backup file: $OUT_FILE"
echo "Backup manifest: $MANIFEST_FILE"
