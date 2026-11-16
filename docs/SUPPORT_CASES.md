# Support case operation

The website support form at `/soporte` saves cases in PostgreSQL. A successful
receipt means the transaction committed. The current workflow does not send
confirmation or response email: the page says this explicitly. The fallback
contact is `soporte@puntosfieles.com`. No response-time commitment is displayed.

## Integration

- Add `supportCaseRoutes` from `src/app/routes/support-case-routes.js` through
  `mountApiRoute(basePath, supportCaseRoutes)` in the existing API mount loop.
  Both `/api` and `/api/v1` remain available.
- Serve `public/super-support.html` at `/super/soporte` and link it from `/super`.
  The static shell contains no case data; every management API route requires
  the existing active super-admin session, and mutations require CSRF.
- Apply `2026-11-16-support-cases.sql`; update the managed migration lock.
- Pin the maintained `sharp` image decoder in runtime dependencies (implemented
  and validated with version 0.35.5). No native application change is needed.
- Import `purgeExpiredSupportAttachments` from
  `src/app/services/support-case-maintenance.js` in the worker. Call it after
  database initialization and in daily maintenance, catching and reporting
  failures with a count-only operational log. Each run physically deletes up to
  500 expired images. If a backlog develops, run it again until `deleted` is zero.
- Preserve `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on support
  API responses. Do not include these paths or attachments in a service-worker
  cache, response capture, or analytics recording.

## Handling a case

Sign in at `/super`, open **Casos de soporte**, and filter by state or search
reference, contact email, or the reported business name. Select the case, review
its description and screenshot, and optionally assign a responsible email. The
assignment is an operational record; it grants no access and sends no email.
Only platform administrators can handle cases.

The message type defaults to **Nota interna**. Select **Respuesta pública** to
publish a message in the customer's private tracking page. Every update records
the administrator email, previous and resulting state/assignment, timestamp and
version atomically with the change. A stale edit receives 409 and must be reviewed
again; retries with the same request ID are idempotent. History is append-only
for the runtime role.

States are `new`, `open`, `waiting`, `resolved`, and `closed`. A customer reply
reopens a waiting or resolved case. Closed cases reject new customer replies;
an administrator can explicitly reopen them. Closing directly is allowed for
spam or duplicate reports without inventing a resolution. No email-delivery
state is conflated with case status.

## Customer access and privacy

The browser generates a 256-bit random tracking capability with Web Crypto.
Only its SHA-256 hash is stored. The display reference is not an access credential.
The private link puts the capability in a fragment; JavaScript removes the
fragment from browser history on opening, and sends credentials in POST bodies.
A person possessing the link can read and reply to that case. Users are told to
save it privately. No case list can be obtained by providing a contact email,
business ID or reference. There is no automated lost-link recovery; contact
support for a manually verified request.

The business-name field is unverified descriptive text. Optional account linking
uses only an active browser session and a live matching staff/customer database
record. The form cannot supply trusted tenant membership. Tenant membership
alone grants no case access. Staff records must remain active; customer records
must not be deleted. Reports remain usable without a session.

Diagnostics are opt-in, previewed, and limited to the constant support-screen
name, online boolean, coarse browser family/device class, language, and viewport.
URLs, query strings, referrers, tokens, storage, cache contents and other screens
are excluded. The UI warns against sending passwords, codes, full QR images and
payment-card data; people must remove sensitive contents from screenshots.

One screenshot may be uploaded with the initial report: PNG/JPEG/WebP, at most
600 KiB, 4096 pixels per side and 12 megapixels. Sharp fully decodes and re-encodes
it as a metadata-free WebP; animated and malformed images are rejected. Private
PostgreSQL bytes have no static/public URL. Public retrieval uses a POST
capability; queue text search also uses a POST body to keep contact data out of URLs; administrator retrieval requires the platform session. Expired
images immediately become unreadable, then worker maintenance physically deletes
them. Normal database backup retention still applies to historical backup copies.

The migration enables and forces RLS on all three support tables. Public access
uses a transaction-local capability hash. Internal events require platform-admin
scope. Attachments can only be read with a visible parent case, and DELETE is
restricted to expired images in platform-admin scope. No case/event DELETE or
event UPDATE is granted to the runtime role. Legacy broad table ACLs are revoked.

Creation has a dedicated 8 attempts/hour/IP rate limit, Turnstile when configured,
a honeypot, strict bounded Zod schemas, the existing 1 MiB JSON limit and CSRF.
Tracking is limited to 60 requests/minute/IP; replies to 20/hour/IP and 20 per
case/day. A lost creation response retains the same capability and request ID in
page memory; retry recovers the committed case without consuming Turnstile again.
Fields are protected during an uncertain retry. A definitive validation failure
keeps them editable. No draft or secret is persisted to browser storage.

## API

| Method | Route after `/api` | Purpose |
| --- | --- | --- |
| GET | `/public/support/config` | Challenge configuration and attachment cap; no DB-readiness claim |
| POST | `/public/support/cases` | Create a case or recover an identical request |
| POST | `/public/support/track` | Read the case and public events using the capability |
| POST | `/public/support/reply` | Idempotent customer follow-up |
| POST | `/public/support/attachment` | Private screenshot bytes |
| GET | `/super/support/cases` | Queue by state/offset, 50 records/page |
| POST | `/super/support/search` | Private text search/filter in the request body |
| GET/PATCH | `/super/support/cases/:id` | Admin detail and audited update |
| GET | `/super/support/cases/:id/attachment` | Admin-only screenshot bytes |

`GET /public/support/config` returns `challengeRequired`, `siteKey`, and
`attachmentMaxBytes: 614400`. `CONTACT_TURNSTILE_SITE_KEY` may override the same
public site key already used by the website contact form. Verification uses
`CONTACT_TURNSTILE_SECRET`. Existing `/ready` covers database availability.

## Verification

The integration suite uses a disposable PostgreSQL database named exactly
`support_cases_test`, a loopback address, and an explicit non-default port. It
refuses the production database address. It recreates only its isolated fixture
tables, creates a NOLOGIN/NOSUPERUSER/NOBYPASSRLS runtime role, applies the migration
twice, and exercises real SQL, Express authentication/CSRF and Playwright. Email
and external challenge providers are not invoked.

```sh
NODE_ENV=test node --test tests/unit/support-cases.test.js
PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright NODE_ENV=test \
SUPPORT_CASES_TEST_DB_URL=postgres://postgres:support_test@127.0.0.1:55463/support_cases_test \
node --test tests/integration/support-cases.test.js
```

Browser screenshots are written to `/tmp/pf-support-screenshots/`. The browser
check covers a response lost after commit, identical retry, screenshot viewing,
customer follow-up, staff internal/public messages, fragment navigation, responsive
widths and absence of customer-visible internal notes. Database checks cover
concurrency, mismatched idempotency keys, cross-case isolation, stale versions,
audit rollback, closed-case transitions, decoder validation/metadata stripping,
physical purge, session validity, abuse limits, authentication and CSRF.
