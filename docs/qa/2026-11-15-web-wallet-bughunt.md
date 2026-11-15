# Website and Wallet bug hunt — 2026-11-15

Scope: customer sign-in, logout/session storage, account refresh, customer requests, Apple pass registration and update delivery. Start: `9d166df` (the deployed Wallet actions implementation plus its release receipt). Native app code, dependencies, release versions and cloud builds are excluded.

## Reproduced and fixed

| Area | Reproduction and root cause | Result |
| --- | --- | --- |
| Request drafts | Focus or the 15-second wallet refresh destroyed and recreated the request form, losing text, reward selection, and uncertain-submit retry keys. | Reuse the form for the same validated customer; pause submissions during revalidation; clear it before showing another customer. Refresh history/options without replacing the draft. Preserve an uncertain request's body/key if its selected reward disappears. |
| Blocked logout | An ordinary entry page could reuse the retained server cookie after a failed logout. A statusless verification failure could also clear the local block by probing that old cookie. | All entry paths honor the block. A blocked session needs a successful verification response before continuing. |
| Restricted storage | Reads succeeded while writes threw a quota error. The old epoch stayed current, cleanup was skipped, and a late response could repopulate the account after logout. | Independent cleanup attempts and an in-memory overlay preserve the local invalidation/block. Actual changes from another tab supersede the overlay. This does not promise persistence across page reloads when all storage writes are unavailable. |
| Apple device delivery | Registration accepted odd-length hexadecimal tokens that the provider rejected forever. A failure on an early registration stopped delivery to later devices. | Share token validation, remove known invalid stored registrations, attempt remaining devices, and retain retries for genuine failures. Cleanup and retry state commit together. |
| Apple retry timing | Failure recording inside a long-running provider transaction used its start time for backoff, allowing the delay to expire before commit. | Schedule from `statement_timestamp()` when failure is recorded. |

These are locally reproduced correctness/security edge cases; the audit does not assert that they were exploited in production. Apple failure tests intercept all provider operations.

## Evidence

- 1,429 root unit tests passed; no skips or failures. Full TypeScript check and ESLint passed.
- 116 Wallet-focused unit tests passed, including malformed registrations, multi-device delivery, cleanup persistence, signed package integrity and revocation.
- 14 isolated PostgreSQL storage tests and 12 real workflow tests passed. New negative controls fail with the old retry timestamp, original fail-fast delivery, and a throw-after-delivery implementation that rolls cleanup back.
- 13 intercepted Chromium scenarios passed at 1440px and 390px: both Wallet destinations and fallbacks, verification, wrong-business entry, blocked ordinary login, quota-failed logout, polling/focus draft retention, uncertain retries, identity changes and offline/reconnection.
- Both PWA tests passed: offline caching and service-worker upgrades. Cache version is `pf-v50`.
- Impeccable detection returned no findings for the changed browser modules. Rendered desktop/mobile views were inspected.
- Independent review covered authentication, cross-tab/session isolation, request retry identity, provider fan-out and transaction boundaries.

Tests use fictional customers and a dedicated disposable PostgreSQL container on loopback; they do not send OTPs, customer messages or real provider requests. Physical iPhone/Safari and actual Apple/Google Wallet rendering remain separate device acceptance checks.

Private evidence and guarded release scripts: `/var/lib/puntos/releases/bug-hunt-20261115/`. No database migration is needed. The existing healthy API/worker image selectors are retained for rollback; deployment must compare its source hashes and check public routes after switching images.
