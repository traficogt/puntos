# Exact-release website/backend readiness

Run this from the root of a clean, disposable checkout of the intended full commit, using an isolated local test environment and a new output directory outside the checkout:

```sh
npm run ops:release:readiness -- --revision <full-40-character-commit-sha> --output /tmp/pf-release-readiness --run all
```

The command runs the fixed existing code checks below and writes `readiness.json` plus `readiness.md`. It does not import reports, accept status claims, evaluate submitted commands, download tools, publish a release, start native workflows, or certify external acceptance. With no `--run`, it reports every execution check as `not_tested`. For a deliberate subset, replace `all` with comma-separated IDs, for example `static,typecheck,lint,unit,merchant-unit`; every omitted check remains `not_tested`.

## Required local environment

Use the repository's supported Node 24, Git, and already-installed locked root and merchant dependencies. Provision the disposable environment before running the report. The CLI is an evidence collector, **not an OS sandbox**: use the existing isolated local runner or equivalent no-egress isolation with dummy settings, no production credentials, no `.env` or `.secrets` files, and bounded scratch/resources. Children receive that environment, but it is never included in the report. Do not run against a production checkout or a live database/provider.

Git must be able to read the checkout's metadata, including the common Git directory of a worktree. A source mount containing only a dangling `.git` pointer is insufficient. Output must have an existing parent, must not already exist, and must be outside the checkout, including after resolving its parent symlinks. Source hashing compares tracked content with the actual HEAD blobs (including files hidden by Git assume-unchanged/skip-worktree flags) and covers tracked and nonignored untracked file bytes, symlink targets, and executable mode. Ignored runtime files and installed dependencies are outside that source digest; dependency lockfiles are inside it, and the executed Node and relevant package versions are recorded.

For the complete catalog, also provision:

- Local Docker for the **existing** isolated PostgreSQL domain runner. It creates its own disposable databases and cleans up its containers. Its required suite list comes directly from the existing domain catalog, so new registered suites become required automatically. Preload its pinned PostgreSQL image in the isolated environment. Each container is bounded to one CPU, 1 GiB RAM and 128 processes; PostgreSQL listens on a random loopback-only published port. The runner allowlists its environment and marks it `PF_DOMAIN_ISOLATED=1`.
- Installed Playwright Chromium **and Firefox** and their local system dependencies. `PLAYWRIGHT_BROWSERS_PATH` may locate an already-installed browser (the catalog and npm cache-privacy script default it to `0` while preserving an explicit path); the report never installs one.
- A disposable running application and local database, with test users/keys required by the existing browser and opt-in core integration suites. Core integration also needs the existing test database settings pointed at that same disposable migrated database, including the runtime and migration-role credentials used by those suites. `E2E_BASE_URL` must be a loopback HTTP(S) URL. Start that application from the same clean checkout with `RELEASE_SHA` set to the exact requested SHA; its existing `/api/info` must report that `build_sha` before and after the core and browser checks. Missing, stale or changed application identity prevents a pass. This is a check on the trusted local fixture, not a cryptographic remote-server attestation. The core catalog enables its existing live suites with `RUN_INTEGRATION=true` and overrides `TEST_API_URL` to the exact verified `E2E_BASE_URL`. The PWA check separately starts the established static fixture. The cache-privacy regression also runs through `npm run test:integration`/`npm test`, so existing CI jobs retain this browser-install prerequisite. No provider acceptance is inferred from either.
- A writable disposable checkout for the merchant build. The catalog explicitly uses `NODE_ENV=production` for this build while other checks use test mode. The build regenerates the existing committed website assets; any source/content change invalidates readiness and requires committing the correct generated output followed by a fresh run. A read-only checkout can run other selected checks.

## Fixed code checks

| ID | Scope | Existing execution |
| --- | --- | --- |
| `static` | Static | Existing release checklist: required files/scripts/workflow text and migration checksums |
| `typecheck` | Static | Root configured TypeScript check |
| `lint` | Static | Root configured ESLint scope |
| `unit` | Functional | Existing root `tests/unit/*.test.js` selection with Node TAP |
| `core` | Functional | Existing `test:integration:core` file list with Node TAP and live suites enabled against the verified disposable API; some tests stub database access |
| `merchant-unit` | Functional | Existing merchant `tests/*.test.js` selection with Node TAP |
| `merchant-typecheck` | Static | All production merchant source plus strict API/form contracts and negative compile fixtures |
| `merchant-build` | Static/build | Existing merchant build, followed by source identity verification |
| `domains` | Database | Existing isolated PostgreSQL domain runner and its per-suite JSONL results |
| `pwa` | Browser | Existing Chromium PWA tests and static-server fixture with Playwright JSON |
| `cache-privacy` | Browser | Real Chromium service-worker privacy regression with Node TAP |
| `merchant-browser` | Browser | Navigation, pending import, owner workspace, launch activation, branded QR and typed-boundary synthetic browser runners, wrapped in Node TAP with completion assertions |
| `customer-offline` | Browser | Offline customer wallet shell regression with Node TAP |
| `staff-offline` | Browser | Staff offline/selection suite in **both Chromium and Firefox**, requiring results for each engine, zero retries |
| `browser` | Browser | Existing Chromium smoke, auth-security, flows, adversarial and visual suites with Playwright JSON, zero retries |

These checks do not replace the full release workflow. The catalog states its exact scope; it is not a claim that every repository test, security scan, operational drill, native platform or deployed service has been verified.

## Reading the result

Each check has `passed`, `failed`, or `not_tested`. The report records the requested SHA, actual HEAD/tree/content identity, source cleanliness, fixed command, relevant tool versions, UTC start/end, duration, exit/signal, reporter test/pass/fail/cancel/skip/todo counts when available, and SHA-256 digests and lengths for captured stdout/stderr.

A test check passes only after direct execution in this invocation, exit zero, complete matching reporter output, at least one test, and no failed, skipped, cancelled, todo or flaky/retried results. Node TAP requires observed results and a complete summary; Playwright rejects focused-only tests and requires individual results, every fixed required spec file/project pair, and matching totals; domain JSONL requires every registered suite and matching totals. An unavailable wrapper or absent/zero test observations is `not_tested`. Observed failing or skipped tests are not a pass. Command timeout, cancellation (even if a signal handler exits zero), or bounded-output truncation cannot pass. Interrupted commands normally receive two seconds to stop; the existing domain wrapper receives a bounded 135-second grace period so its own child termination and 120-second Docker cleanup can finish before an outer forced kill.

Evidence must match the exact clean revision and content before/after execution and at report time. Wrong revisions, dirty/content-changed checkouts, missing artifacts, digest changes, invalid timestamps or evidence older than 24 hours cannot pass. Failed or missing required checks are not dropped from the denominator. An interrupted run attempts to write its partial report; later checks remain `not_tested`.

`codeReadiness` combines the stated code catalog and clean-source check. `pilotReadiness` remains `not_tested` even when code readiness passes, because physical enrollment/device checks, selected provider capability acceptance, independent security/release gates, and deployment/operations/owner approval are separate external checks. Those are explicitly `not_tested`; this CLI cannot mark them passed. A code failure produces `pilotReadiness: failed`.

Exit codes describe **code readiness**, not permission to launch a pilot: `0` means all catalog code checks passed, `1` means a code/source failure or invalid invocation, `2` means required code evidence is missing, and `130` means interruption. Read `pilotReadiness` and complete the external acceptance process before declaring a pilot ready.

## Evidence privacy and trust

The output directory is private (`0700`), and reports, receipts and raw captured streams are created with `0600` permissions. Public report fields use fixed labels, numeric counts and constrained metadata; they omit environment dumps, raw output, test names, exception messages and user records. Raw reporter artifacts in `private/` **can contain diagnostic secrets or personal data**: keep that directory internal and do not publish it. Browser trace/screenshot output also stays beneath that private directory. Share only reviewed `readiness.json`/`readiness.md`.

Receipts and artifact hashes support diagnosis and integrity checks, not authenticated remote attestation. There is intentionally no import path that could turn a hand-written report, stale CI artifact or arbitrary “passed” field into a passed code gate. Generate fresh evidence with the documented command in a trusted runner. A copied or edited final report is not cryptographic proof of an execution; retain the trusted runner's own run records with the report.


## Failure simulations and larger fixtures

The domain catalog includes `failure-simulations` and `merchant-scale`; `--run all` runs both.
For diagnosis without repeating the whole release gate:

```sh
npm run test:integration:domains -- failure-simulations merchant-scale
```

The failure suite disconnects only its own database session, kills only its own fixture worker,
uses fake queue/provider transports, and verifies durable state after retries and overlapping writes.
The scale suite seeds 10,000 fictional customers and 100,000 purchases, plus a second tenant,
then measures real overview, customer-search, audience and 5,000-row import paths.
Both require the runner marker, a dedicated database, a non-default loopback port, and no `.env`.
Successful JSONL output includes bounded synthetic diagnostic records. Those records provide
measurements and scenario counters; actual TAP results and process exits still decide readiness.
Timing budgets are deliberately generous regression alarms, not production service guarantees.
