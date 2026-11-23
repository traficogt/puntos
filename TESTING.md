# Testing

## Local gates

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` currently runs:
- `tests/unit/*.test.js`
- the `test:integration` selection of `tests/integration/*.test.js`: browser
  shells plus the two files that stub `pool.query` (`api-security`,
  `customer-flow`). Every `RUN_INTEGRATION`-gated file in that list is
  `describe.skip` here, so `npm test` needs neither Docker nor PostgreSQL and
  never touches a real database. See "Real database" below for those suites.

## Focused runs

```bash
npm run test:unit
npm run test:integration
npm run test:coverage
```

## Real database (`npm run test:db`)

```bash
npm run test:db     # ephemeral Postgres 16 + Redis + API in Docker, then every gated suite
npm run test:all    # npm test, then npm run test:db
```

`npm run test:db` runs [run-live-integration-isolated.sh](/opt/puntos/src/scripts/run-live-integration-isolated.sh)
(the same script as the `live-gamification-integration` CI job). It needs Docker
and nothing else on the host; `npm test` stays Docker-free. The script:

1. builds the API image and starts `db` (PostgreSQL 16), `redis` and `api` from
   `docker-compose.e2e.standalone.yml` under the compose project
   `puntos-live-integration`, database `puntos_e2e`, migrations auto-applied;
2. re-applies the explicit grants of the restricted runtime role (`loyalty_app`:
   `NOSUPERUSER`, no `BYPASSRLS`) and restarts the API under it, so every request
   runs with row-level security enforced, as in production;
3. runs the super-admin smoke gate and the owner ledger certification and
   correction smokes;
4. runs every `RUN_INTEGRATION`-gated file in `tests/integration` inside the
   `api` image with `node --test --test-concurrency=1` (tests mounted read-only,
   `RUN_INTEGRATION=true`, `TEST_API_URL`, `TEST_DB_*` admin connection,
   `SUPER_ADMIN_PASSWORD`): external-award, gift-card, order-returns and orders
   idempotency, plan enforcement, recurring and refund gamification, staff
   ledger idempotency, super gift cards and transaction pool isolation;
5. runs the duplicate redeem/refund ledger check, then `docker compose down -v`
   (also on failure, after printing the last API/db/redis log lines).

Expect about 1.5 minutes once the base images are present (measured 74 s
including the `npm ci` image layer: the ten suites themselves take under 10 s,
the rest is image build, migrations, the role restart and the smoke gates);
pulling the PostgreSQL, Redis and Node base images for the first time adds a few
minutes. Generated secrets are random per run.

Knobs (all optional):
- `E2E_PORT` host port for the API (default `3101`); `E2E_COMPOSE_PROJECT`
  (default `puntos-live-integration`) to run two stacks side by side.
- `E2E_APP_DB_PASSWORD`, `E2E_DB_ADMIN_PASSWORD`, `E2E_SUPER_ADMIN_PASSWORD`
  (random when unset).
- `TEST_DB_HOST`/`TEST_DB_PORT`/`TEST_DB_NAME`/`TEST_DB_USER`/`TEST_DB_PASSWORD`
  admin connection the suites use for fixtures (defaults: `db`/`5432`/
  `puntos_e2e`/`loyalty_admin`/the admin password).
- Focused run: pass test paths to the script, for example
  `bash src/scripts/run-live-integration-isolated.sh tests/integration/orders-idempotency.test.js`.

The `*_TEST_DB_URL`-gated domain suites (automations, campaigns, merchant
operations, wallets and so on) are a separate gate with their own private
PostgreSQL container: `npm run test:integration:domains` (CI job
`domain-integration`).

## E2E

```bash
npm run test:e2e
npm run test:e2e:local
npm run test:e2e:visual
```

Playwright specs live under [tests/e2e](/opt/puntos/tests/e2e).

## CI gates

Main CI in [ci.yml](/opt/puntos/.github/workflows/ci.yml) runs:
- install
- migration lock check
- typecheck
- lint
- unit/integration tests
- OpenAPI freshness check
- migration apply
- RLS check
- security scan
- perf sanity
- dependency audit
- secret scan
- container image scan
- HTTP smoke gate
- Playwright smoke E2E

Nightly CI in [nightly-e2e.yml](/opt/puntos/.github/workflows/nightly-e2e.yml) runs:
- browser matrix E2E
- visual regression checks

Release gating in [release-gate.yml](/opt/puntos/.github/workflows/release-gate.yml) runs:
- build/test + DB verification
- dependency audit
- secret scan
- container image scan
- Semgrep
- HTTP smoke
- Chromium smoke/flows/adversarial checks
- Chromium visual regression

## Run GitHub checks now

To prove the network-enabled scans and GitHub gates outside this sandbox:

1. Open GitHub Actions.
2. Run `CI` with `Run workflow` on your branch.
3. Run `Release Gate` with `Run workflow`.

What to look for:
- `CI`
  - `build-test`
  - `secret-scan`
  - `container-scan`
  - `smoke-e2e`
  - `observability-drill`
  - `semgrep`
- `Release Gate`
  - `release-verify`
  - `release-secret-scan`
  - `release-container-scan`
  - `release-semgrep`
  - `release-smoke`
  - `release-observability`
  - `release-browser-gate`
  - `release-summary`

The network-enabled security proof you want is already inside those workflows:
- `npm audit --omit=dev --audit-level=high --ignore-scripts`
- Gitleaks
- Trivy image scan
- Semgrep

## Deploy smoke

Use the HTTP smoke gate after any staging or production rollout:

```bash
npm run ops:smoke -- --base-url https://your-domain.example --require-super-login
```

It checks health/readiness/info, HTML entry pages, the OpenAPI document, and the super login/logout path when credentials are present in env or passed as flags.

## Load and failure drills

Critical-path load:

```bash
npm run ops:load:critical -- --base-url https://your-domain.example --require-super
```

Docker restart drill:

```bash
npm run ops:failure:drill
```

The restart drill boots an isolated stack, runs smoke + load, then restarts `db`, `redis`, and `api` one at a time and reruns the checks after each restart.

## Backup and restore evidence

Create and verify a backup:

```bash
npm run ops:backup
npm run ops:backup:verify -- --file backups/<file>.sql.gz
```

That produces:
- `backups/<file>.sql.gz`
- `backups/<file>.sql.gz.sha256`
- `backups/<file>.sql.gz.json`

Restore drill evidence:

```bash
npm run ops:restore:drill -- backups/<file>.sql.gz
```

That writes a drill report under `artifacts/restore-drills/`.

## Alert checks

Validate alert inputs against live metrics:

```bash
npm run ops:alerts:check -- --scope api --base-url https://your-domain.example --metrics-token <token>
npm run ops:alerts:check -- --scope worker --worker-base-url https://worker.example.internal:3002 --metrics-token <token> --mode evaluate
npm run ops:alerts:drill
```

## Notes
- Dependency CVE status depends on registry access. Local `npm audit` can fail in offline environments.
- E2E uses generated test secrets and does not require the repo to contain live production secrets.
