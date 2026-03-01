# Testing

## Local gates

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` currently runs:
- `tests/unit/*.test.js`
- `tests/integration/*.test.js`

## Focused runs

```bash
npm run test:unit
npm run test:integration
npm run test:coverage
```

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
