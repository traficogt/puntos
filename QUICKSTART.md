# Quickstart

## Development

1. Bootstrap a local environment:

```bash
./src/scripts/bootstrap-dev.sh
```

This creates:
- `.env.dev`
- `.env` if it does not already exist
- an external secrets directory at `${XDG_STATE_HOME:-$HOME/.local/state}/puntos/secrets-dev`

2. Start the stack:

```bash
docker compose up -d --build
```

3. Open:
- `http://localhost:3001/`
- `http://localhost:3001/admin`
- `http://localhost:3001/staff/login`

Postgres is exposed on `127.0.0.1:5432` only in the dev profile.

## Manual secret setup

Generate QR keys into an external directory:

```bash
node src/scripts/gen-keys.mjs "$HOME/.local/state/puntos/secrets-dev"
```

Create the remaining secret files in the same directory:
- `db_password`
- `db_migrations_password`
- `jwt_secret`
- `metrics_token`
- `super_admin_password_hash`
- `webhook_secret_enc_key`

Then point `SECRETS_DIR` at that directory in `.env`.

## Rebuild after code changes

```bash
docker compose up -d --build api
```

## Useful follow-up

```bash
npm run typecheck
npm run lint
npm test
```
