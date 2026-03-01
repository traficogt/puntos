#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_DEV="$ROOT_DIR/.env.dev"
DEFAULT_SECRETS_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/puntos/secrets-dev"
SECRETS_DIR="${SECRETS_DIR:-$DEFAULT_SECRETS_DIR}"

echo "Bootstrap PuntosFieles for a fresh VM (development defaults)"
echo "Using external secrets directory: $SECRETS_DIR"

if command -v openssl >/dev/null 2>&1; then
  PRIV_PEM=$(openssl genpkey -algorithm Ed25519 2>/dev/null | openssl pkey -outform PEM 2>/dev/null)
  PUB_PEM=$(printf "%s" "$PRIV_PEM" | openssl pkey -pubout -outform PEM 2>/dev/null)
else
  KEYS_JSON=$(node -e "const {generateKeyPairSync}=require('crypto');const {publicKey,privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});process.stdout.write(JSON.stringify({privateKey,publicKey}));")
  PRIV_PEM=$(printf '%s' "$KEYS_JSON" | node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(data.privateKey);")
  PUB_PEM=$(printf '%s' "$KEYS_JSON" | node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(data.publicKey);")
fi

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

DB_PASSWORD=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
JWT_SECRET=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
METRICS_TOKEN=$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")

printf '%s\n' "$DB_PASSWORD" > "$SECRETS_DIR/db_password"
printf '%s\n' "$DB_PASSWORD" > "$SECRETS_DIR/db_migrations_password"
printf '%s\n' "$JWT_SECRET" > "$SECRETS_DIR/jwt_secret"
printf '%s\n' "$PRIV_PEM" > "$SECRETS_DIR/qr_private_key.pem"
printf '%s\n' "$PUB_PEM" > "$SECRETS_DIR/qr_public_key.pem"
printf '%s\n' "$METRICS_TOKEN" > "$SECRETS_DIR/metrics_token"
chmod 600 "$SECRETS_DIR"/*

cat > "$ENV_DEV" <<EOF
NODE_ENV=development
PORT=3001
WORKER_PORT=3002
SECRETS_DIR=$SECRETS_DIR

DB_HOST=db
DB_PORT=5432
DB_NAME=puntos
DB_USER=puntos_app
DB_PASSWORD_FILE=/app/.secrets/db_password
DB_MIGRATIONS_USER=puntos_app
DB_MIGRATIONS_PASSWORD_FILE=/app/.secrets/db_migrations_password

JWT_SECRET_FILE=/app/.secrets/jwt_secret
QR_PRIVATE_KEY_PEM_FILE=/app/.secrets/qr_private_key.pem
QR_PUBLIC_KEY_PEM_FILE=/app/.secrets/qr_public_key.pem

TRUST_PROXY=0
CORS_ORIGIN=http://localhost:3001
APP_ORIGIN=http://localhost:3001
MESSAGE_PROVIDER=dev
METRICS_TOKEN_FILE=/app/.secrets/metrics_token

AUTO_APPLY_SCHEMA_EXTENSIONS=true
AUTO_APPLY_MIGRATIONS=true
IN_PROCESS_WORKERS=true
EOF

if [ ! -f "$ENV_FILE" ]; then
  cp "$ENV_DEV" "$ENV_FILE"
  echo "Created .env from .env.dev (development defaults)."
else
  echo ".env already exists; left untouched. Generated fresh dev template at .env.dev."
fi

echo "Next:"
echo "  1) docker compose up -d --build"
echo "  2) Open http://localhost:3001/admin"
echo "Done."
