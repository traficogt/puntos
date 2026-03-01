# Playwright E2E

This repo uses Playwright for browser regression coverage.

## Included

- Config: `playwright.config.mjs`
- Smoke suite: `tests/e2e/smoke.spec.js`
- npm scripts:
  - `npm run test:e2e`
  - `npm run test:e2e:local`
  - `npm run test:e2e:headed`
  - `npm run test:e2e:install`
  - `npm run test:e2e:install:deps`

## Setup

1. Install deps:
   - `npm ci`
2. Run tests in an isolated Docker stack (recommended):
   - `npm run test:e2e`

This uses `docker-compose.e2e.standalone.yml` and a separate project/DB, so test data does not pollute your real instance.

3. Optional: run tests against an already running app (host-run Playwright):
   - install Playwright browsers (Chromium + Firefox):
     - `npm run test:e2e:install`
     - If your environment needs OS packages too (e.g. CI runners), use: `npm run test:e2e:install:deps`

   Note: the scripts set `PLAYWRIGHT_BROWSERS_PATH=0` so browsers are installed under `node_modules/.cache/` (portable + works in restricted environments).

4. Optional: run tests against an already running app:
   - `npm run test:e2e:local`

## Deploy use

Use [src/scripts/deploy-smoke.mjs](/opt/puntos/src/scripts/deploy-smoke.mjs) for the post-deploy HTTP gate. Use Playwright when you need browser-backed validation, not for the first-line health/smoke check.

## Env

- `E2E_BASE_URL` to target another URL when using local mode.
  - Example: `E2E_BASE_URL=https://tu-dominio.gt npm run test:e2e:local`

## Next high-value tests to add

- Staff award flow (`/staff`) with real QR scan token fixture.
- Admin templates and plan toggle flow (`/admin` + `/super`).
- Customer login/signup routing and OTP happy path (`/c`).
- Gift card create/redeem authorization matrix by role.
