# Article-driven reporting and customer clarity

**Goal:** Deliver the three additions requested after the article audit: weekly first-to-second purchase reporting, understandable bonus-point history, and stage-dependent reward progress wording.

**Scope:** Browser application and necessary backward-compatible API additions only. No native app edits/builds, no Wallet pass-template changes, no earning/ledger mutations, no new dependencies. Preserve owner edits in the root checkout. Existing branding and Mantine owner components remain.

## 1. First-purchase report: agreed contract

New owner/analytics-gated, private/no-store GET endpoint:
`/api/admin/analytics/first-purchase-returns?week_start=YYYY-MM-DD&branch_id=UUID`.
The week starts on Monday in the merchant timezone. Default is the previous
complete calendar week. Offer 52 weekly choices including the current week;
reject invalid dates, non-Mondays and weeks outside that range rather than
silently changing them. A year of selectable cohorts does not truncate the
historical search that establishes first purchase.

Each customer enters on their first genuine recorded purchase across the entire
business history available by the snapshot. Use `purchase_occurred_at` with
`created_at` fallback, and require server receipt before the snapshot. Exclude
bonuses, adjustments, opening imports and completely reversed purchases; pending
or expired points do not undo a genuine purchase. Include deleted customers in
aggregate history without exposing identities. Break ties deterministically.

Select the cohort week after finding that first purchase. A branch filter selects
the branch of the first purchase; a subsequent purchase at any branch of this
business counts. Return means a genuine purchase on a later local calendar date
and less than 720 hours after first purchase. Same-day split receipts do not
count as a return visit. Include every fully observed customer, including those
without return, in the percentage denominator. Show incomplete windows separately.
Late data and reversals may change results; this is recorded behavior, not causal
lift. Surface data freshness/readiness limitations without inventing completeness.

Response contract (numbers are illustrative, not fixture defaults):

```js
{
  ok: true, generated_at: '2026-11-16T12:00:00Z', timezone: 'America/Guatemala',
  scope: { branch_id: null, first_purchase_scope: 'business', return_scope: 'business' },
  available_weeks: ['2026-11-16', '2026-11-09'], // all 52, newest first
  cohort: { week_start: '2026-11-09', week_end: '2026-11-15',
    start: '2026-11-09T06:00:00Z', end: '2026-11-16T06:00:00Z',
    customers: 20, legacy_timestamp_customers: 2 },
  follow_up: { days: 30, definition: 'later_local_day_within_720_hours' },
  completed: { customers: 0, returned_customers: 0, without_return_customers: 0, return_rate_pct: null },
  ongoing: { customers: 20, returned_customers: 4 },
  data_readiness: { state: 'recorded_only', inactivity_allowed: true, summary: '...' },
  notes: ['Definition and limitations in Spanish']
}
```

Owner UI: a compact section **De la primera compra a la segunda** in Resumen,
independent cohort-week selector, first recorded buyers, complete-window return
count/percentage and ongoing count. Keep the primary view plain; put detailed
counting rules in an accessible disclosure. Show loading, empty, error, offline,
stale-data and branch semantics. No customer PII. Add a deterministic fictional
demo with week and branch responses and browser coverage including stale requests.

Backend ownership: new service/routes/tests/fixtures, analytics router registration,
isolated-domain-suite registration. Root owns owner component, demo API integration,
OpenAPI generator/docs, help/article revisions and release.

## 2. Customer point provenance

Trace customer history/statement fields through repository/API before editing.
Return additive allowlisted classification information only if needed; preserve
existing native JSON fields and aggregate meanings. Do not expose raw metadata,
staff notes, other customers or merchant costs. Unknown legacy provenance stays
unknown. Label purchases, referral/achievement/other known bonus, redemption,
expiry, corrections/reversals and imported starting balances truthfully. Where
purchase points contain a documented bonus, describe that without inventing an
unavailable base/bonus split. Status must not imply pending or reversed points
are currently available. Browser summary wording must not imply every positive
point came from a purchase. Keep displayed history readable and accessible.

Tests: known sources/types; contradictory/unknown legacy rows; pending/expired/
reversed entries; mixed purchase+bonus evidence; user-controlled text escaping;
customer and tenant scope; old JSON compatibility; cached older response fallback.

## 3. Progress wording

Browser-only, deterministic presentation of the existing selected reward:

- Zero available balance: name the target without claiming earned progress.
- Positive balance below half the reward price: **Ya tienes X de Y puntos para…**.
- At least halfway but insufficient: **Te faltan N puntos para…**.
- Enough available points: preserve **Tienes los puntos para…** and conditions.
- No eligible target, stale/offline data, negative balance or invalid values:
  preserve safe existing availability behavior; never manufacture progress.

Use available balance, not lifetime earnings. This includes legitimately awarded
bonuses; do not call them purchases. Do not alter the target or protected rules,
hide pending points, or imply reservation/guaranteed fulfillment. Keep full balance,
price and conditions visible. Halfway is a transparent presentation choice, not
a scientifically validated optimum or an A/B experiment. Browser cache version
must deliver changed modules without modifying native or Wallet releases.

Customer agent owns customer history/progress services/repository/route additions
as needed, `public/customer/*`, relevant types and customer tests. Notify root
of API additions, cache requirements and touched shared files before expanding scope.

## Verification and delivery

- [x] Backend measurement tests against disposable PostgreSQL: full-history
  first purchase, week boundaries/DST, same-day exclusion, exact 30-day bound,
  mature/open denominators, branch selection with cross-branch returns, late sync,
  refunds/point expiry/import exclusions, missing timestamps, deleted customers,
  tenant isolation, invalid parameters and read-only aggregation without row caps.
- [x] Customer tests listed above plus numeric boundary/target changes, cached
  response compatibility, expired/stale target suppression and browser rendering.
- [x] Owner demo unit and browser tests: weeks/branches, empty/loading/error/
  offline states, no stale results, desktop/mobile, light/dark and axe.
- [x] Update public help and articles to describe only delivered capabilities;
  keep research findings, APA references, artwork and scheduled publication times.
- [x] Run applicable root and merchant types/lint/unit/browser/domain suites;
  inspect rendered surfaces, obtain independent review and resolve material issues.
- [ ] Commit, merge and push; deploy website/API and compiled merchant assets with
  rollback ready. Verify public routes, health and demo; leave native builds manual.


## Review and verification evidence

Independent review found and resolved two defects before release: parent overview
loading unmounted the report and reset its week, and real POS/gamification writer
pairs were missing from history classification. Regression coverage now includes
the actual Overview parent and the recorded writer formats. A browser-only fixture
race with signed-out bootstrap was corrected without changing authentication.

Final local verification: 1,586 root unit tests, 154 merchant unit tests, 53 tests
across six isolated PostgreSQL suites, seven merchant browser gates, ten customer
checks across Chromium/Firefox, root and merchant type checks, lint, and an
81-page reproducible help build. The new report and history were inspected at
mobile/desktop sizes and both themes with accessibility checks. OpenAPI was
regenerated. Scientific passages, original references, publication dates, artwork,
and native app files remain unchanged. Release and live-check evidence is recorded
outside the repository under the dated article-features release directory.
