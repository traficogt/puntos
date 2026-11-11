# PF pilot audit and hardening

User request: assess pilot readiness, hunt bugs thoroughly, and complete a broad pass rather than stopping after a small batch.

## Scope and acceptance

Assess a supervised first-business pilot covering customer registration/login, staff earning and redemption, owner configuration, tenant isolation, disconnected earning/recovery, POS import/API, and operational recovery. Odoo remains an unbuilt connector and live vendor verification requires merchant access. Do not infer readiness from unit counts alone.

Preserve fonts/design and existing work. Reproduce failures before fixes. Use disposable databases and test identities for all mutations; live checks are read-only except approved scoped deployment and backup operations. No external messages are sent during tests. Record unverified external dependencies as pilot gates.

## Workstreams

- [x] Baseline unit, lint, typecheck, browser and isolated application checks.
- [x] Customer/auth: OTP delivery ownership, issuance throttling, atomic consumption, account/cache isolation, enrollment and session recovery.
- [x] Offline client: durable writes before network requests, tenant/staff-scoped queue, small sequential batches, reconnect retries, exact acknowledgments, storage errors, explicit pending state and online-only redemption.
- [x] Offline server: bounded signed offline grants, signature-valid customer QR captured within its valid interval, late upload within 24 hours, current staff authorization, safe replay after lost responses, payload conflict detection.
- [x] Ledger/POS: transaction and retry identity, guards, refunds, race conditions, secrets and tenant scoping.
- [x] Operations: production configuration, migrations/bootstrap, backup validity and isolated restoration, delivery configuration, worker/health and dependency review.
- [x] Full verification: real API+database browser journeys, authorization negatives, injected connection loss/expired credentials/duplicate submissions, complete static checks and regression suites.
- [x] Review complete changes, package/deploy only verified scope with rollback, perform live read-only checks and report pilot gates.

## Offline authorization design

Keep short-lived customer QR validation for normal online use. Authenticated staff with award and sync permissions can obtain a purpose-specific signed grant valid for 24 hours and bound to their staff and business IDs. The client records the grant and capture timestamp with each durable queued operation. Late QR verification requires the grant, verifies QR signature and validity at capture, enforces capture inside the grant window and a bounded upload delay, and rechecks current staff authorization. Client timestamps are declarations by authorized staff, not independent proof of presence; keep a full audit trail. A QR already expired at capture is rejected. No new static customer credential or offline redemption is introduced.

Replays of an already committed matching transaction must remain acknowledgeable after QR/grant expiry. Verify signature/identity and compare immutable original purchase fields before returning an existing transaction; never allow this replay path to create a new award. Do not silently change amounts or bind a queued transaction to a different staff/business.

## Evidence location

Temporary logs and isolated-test artifacts: `/tmp/puntos-pilot`. Final readiness report will record fixed findings, verified scenarios, remaining operational dependencies, and release evidence.

Completed release: `pilot-hardening-20261109`. Findings, evidence and external pilot gates are recorded in `docs/PILOT_READINESS.md`.
