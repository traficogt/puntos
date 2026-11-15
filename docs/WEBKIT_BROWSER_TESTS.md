# Focused WebKit browser gate

Run on Linux with Node 24.22.2–24.x and local Docker:

```sh
npm ci --ignore-scripts
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install --with-deps webkit
node --test tests/unit/webkit-runner.test.js
node src/scripts/run-webkit-isolated.mjs
```

The acceptance runner runs exactly four tests in the opt-in `webkit` Playwright
project: two flows at 1440 pixels and the same flows at 390 pixels. It checks
test names and count before creating fixtures, then checks the JSON results.
Missing browsers, failures, skipped tests, expected failures, retries, extra tests
and missing tests fail the gate. It accepts no filters or target arguments.
The existing Firefox and Chromium selections retain their suites; this focused
spec belongs only to the opt-in WebKit project. Chromium launch flags are scoped
to Chromium.

Each test creates synthetic business data through the existing signup API.
The browser then operates the actual enrollment forms and customer pages:

- Request the development OTP, submit it with Enter, and open the customer card.
- Render the customer QR, reload the page, log out, and sign in again to the same
  customer identity.
- Correct a phone number and recover after an incorrect OTP.
- Check focus transitions, browser-only fallback when Wallet is unconfigured,
  and absence of horizontal overflow at both widths.

The returning-access tests wait for the real 60-second OTP cooldown. A normal
run therefore takes roughly two to three minutes; authentication limits are not
weakened for the fixture. Each test uses a distinct synthetic client address and
phone numbers to avoid sharing rate-limit counters across scenarios.

The runner uses the existing domain-test environment and command helpers. It
creates a fresh PostgreSQL container and Node 24 application container on a
private Docker network with no external network access. A temporary HTTP relay
on a randomly allocated loopback port reaches only this run's application
container; Docker ports are not published. The application mounts only `src`,
`public`, `node_modules`, and `package.json`, read-only. It has a temporary writable
`/tmp`, development message provider, generated fixture credentials, in-memory
rate limiting and disabled background workers. Database data is disposable.
No checkout `.env`, inherited database/provider credentials, deployed data,
native source, cloud builds or real messages are used. Browser requests outside
the fixture origin are blocked, including analytics and hosted fonts.

Playwright runs from an empty temporary working directory with an allowlisted
environment. The runner removes its own containers, volumes and network when it
finishes or receives SIGINT/SIGTERM. Evidence remains in
`test-results/webkit/report.json`, `api.log`, and failure traces/screenshots/video
under `traces/`. The dedicated `WebKit customer browser` CI workflow uses the same
command and uploads those artifacts.

This is Linux WebKit web-engine evidence. The narrow viewport is responsive
layout coverage, not an emulated physical iPhone acceptance test. Service workers
are blocked to keep enrollment documents stable; the existing PWA suite covers
its own lifecycle separately. The gate does not establish Safari on a physical
iPhone, Apple/Google Wallet installation, native-app behavior, real message
delivery, external-font rendering, or provider readiness.
