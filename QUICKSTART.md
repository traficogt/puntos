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

2. Point the stack at a PostgreSQL server. `docker-compose.yml` has **no database service**:
   `api` and `worker` read `DB_HOST` from `APP_DB_HOST`, which defaults to the central database
   VM (`10.10.1.51`, PostgreSQL 17; see `DEPLOYMENT_GUIDE.md` and `AGENTS.md`). For a machine
   without access to that VM, run your own PostgreSQL 16 or 17 and set `APP_DB_HOST`,
   `DB_NAME`, `DB_USER` and the password secret files in `.env` to match it. The `DB_HOST=db`
   line that `bootstrap-dev.sh` writes into `.env.dev` is overridden by `APP_DB_HOST` inside
   Compose; `DB_HOST` is only read by host-side tooling such as `npm run ops:migrate`.

3. Start the stack:

```bash
docker compose up -d --build
```

4. Open:
- `http://localhost:3001/`
- `http://localhost:3001/admin`
- `http://localhost:3001/staff/login`

Nothing publishes a PostgreSQL port: the database is reached over the network you
configured in step 2.

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

`npm test` needs no database or Docker. The suites that need a real PostgreSQL
(`npm run test:db`, `npm run test:e2e`) start their own containers; see `TESTING.md`.
