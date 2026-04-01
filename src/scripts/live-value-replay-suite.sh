#!/usr/bin/env bash
set -euo pipefail

: "${DB_HOST:=127.0.0.1}"
: "${DB_PORT:=5432}"
: "${DB_NAME:=puntos}"
: "${DB_USER:=puntos_app}"
: "${APP_ORIGIN:=http://localhost:3001}"
: "${CORS_ORIGIN:=http://localhost:3001}"

if [[ -z "${SUPER_ADMIN_EMAIL:-}" || -z "${SUPER_ADMIN_PASSWORD:-}" ]]; then
  echo "SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required" >&2
  exit 1
fi

export RUN_INTEGRATION=true
export NODE_ENV=test
export DB_HOST DB_PORT DB_NAME DB_USER APP_ORIGIN CORS_ORIGIN SUPER_ADMIN_EMAIL SUPER_ADMIN_PASSWORD

node --test tests/integration/staff-ledger-idempotency.test.js
node --test tests/integration/gift-card-idempotency.test.js
node --test tests/integration/external-award-idempotency.test.js
