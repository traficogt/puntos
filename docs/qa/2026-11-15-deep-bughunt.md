# Broader website and server bug hunt — 2026-11-15

Baseline: `aae3dba` on main. Scope: browser application, shared server APIs, authentication, merchant operations, campaigns, rewards, inventory/POS, Wallet and database isolation. Native app sources, dependencies, versions, binaries and cloud builds are excluded.

## Reproduced product defects

| Defect | Reproduction | Correction |
| --- | --- | --- |
| Staff practice copied private business settings | A rehearsal response and its saved/replayed state included the entire `program_json`, including fixture integration credentials and owner settings. | Allow only the four earning-rule fields. Sanitize new configuration, historical session reads, start retries, event retries and legacy session advancement. New persisted states omit private settings. |
| Public business responses exposed owner-summary settings | The common client serializer retained `weekly_owner_brief`, including the verified recipient and owner identifier; both public and staff routes used that serializer. | Remove the private block from client responses. Generic program saves ignore submitted summary settings and preserve the current database value atomically. Dedicated owner-summary controls retain responsibility for consent and recipient verification. |
| Delayed ingestion distorted return measurement | A pre-redemption/pre-contact purchase uploaded later counted as a return; a real return uploaded after the observation window was missed. Future purchase timestamps could also count based on earlier receipt time. | Use purchase occurrence time, falling back to receipt time for legacy rows. Independently require receipt visibility at the report snapshot. Preserve redemption's half-open interval, recovery's existing inclusive endpoint, tenant/branch scope and audience eligibility. |
| Offline navigation failed through canonical redirects | The full HTTP app precached redirect-followed HTML for legacy paths such as `/c`; Chromium rejected replaying the redirected response while offline. The old static test server bypassed those redirects. | Reconstruct cached redirected document responses for navigation, preserving content and headers. Cache version `pf-v51`. Test actual Spanish redirect middleware and both canonical and legacy URLs, including query strings. |

These findings were reproduced with fictional data in isolated environments. A read-only production aggregate found zero saved rehearsals at audit time; this does not establish whether any configuration response had previously been accessed. Historical rehearsal event rows are not rewritten; all replay responses are sanitized.

## Preventing another coverage gap

Added `npm run test:integration:domains` and a CI job for 53 domain suites. The runner creates its own loopback PostgreSQL container, uses generated credentials and an isolated working directory/environment, applies managed migrations where required, runs suites sequentially, and removes only its own resources. Missing, skipped, cancelled and failed tests fail the gate. A suite-name filter supports targeted reproduction.

Updated stale fixture schemas, retired action names, route/element selectors and fixed-port assumptions. These were test defects, not production outages. Preserved explicit disposable database-name and loopback guards, with non-default ports. The PWA test helper now exercises the production Spanish routing layer.

The first GitHub run also exposed a PostgreSQL startup race in the new runner: its socket probe could accept the image's temporary initialization server just before shutdown. Readiness now requires TCP, which becomes available on the final server.

## Verification and limits

- 1,435 unit tests pass with no skips; full TypeScript and ESLint checks pass.
- All 53 domain suites pass: 606 PostgreSQL checks. The full run found two remaining hospitality fixture failures; loading its existing purchase-time migration resolved both, with its complete 25-test suite rerun successfully.
- 21 real HTTP/database integration checks pass, including duplicate awards, redemptions, refunds, orders and plan enforcement.
- 44 distinct Chromium browser scenarios pass across authentication/MFA, customer statements, multi-tab logout/reconnection, offline storage/awards, hospitality, service cases, smoke and PWA behavior. The three PWA scenarios additionally pass against the full application server.
- Dependency audit reports zero known vulnerabilities; repository security pattern scan and migration immutability checks pass. The merchant production bundle builds successfully.
- Independent review covered the production fixes, historical replay sanitization, concurrent owner-setting updates, disposable-runner isolation and browser-helper consumers.

Evidence is retained privately in `/var/lib/puntos/releases/deep-bughunt-20261115/`: baseline and regression failures, PostgreSQL results, browser traces, dependency/security checks and release receipts. Provider operations in tests use fakes; no real OTPs, promotional messages, financial charges or customer passes are issued.

Browser verification covers local Chromium and simulated disconnection. It does not establish physical iPhone/Android behavior, external POS hardware behavior, or Apple/Google provider acceptance. No database migration is introduced by these fixes.
