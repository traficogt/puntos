# Full website and server bug hunt — 2026-11-16

Baseline: `cf82d27` on main. Branch: `fix/full-bughunt-20261116`. Scope: authentication and tenancy, the points ledger, tiers, gamification and referrals, POS and payment integrations, outbound webhooks, analytics and reporting, owner/staff/admin screens, the customer website, the help center and test infrastructure. Native app sources, dependencies, versions, binaries and cloud builds are excluded.

Findings were reproduced with fictional data in scratch scripts, disposable PostgreSQL databases or isolated browsers, or confirmed by tracing code against row-level security (RLS) policies and grants. This report does not assert that any defect was exploited in production.

## Reproduced and fixed defects

### Authentication and tenancy

| Defect | Reproduction | Correction |
| --- | --- | --- |
| Staff password reset and email change always failed | Under the production `NOBYPASSRLS` role the public confirm routes read `staff_users` without a tenant: reset returned 404 "Staff not found" and email-change tokens were burned. | Look up and update the staff row in the token's tenant context inside one transaction; lock the row, consume the token once and abort if it was already used. |
| One shared 5-per-15-minute bucket for all sensitive endpoints | Five customer join-code requests from one shop network made staff and super-admin login return 429 for 900 seconds. | Separate limits per endpoint family; logins are keyed by account plus IP and count failures only. `strictRateLimit` is no longer used. |
| Impersonation and magic-link sessions counted as re-authenticated | These sessions passed `requireRecentReauth()` for 10 minutes on accounts without MFA, enough to create a manager or bind MFA to another authenticator. | Only sessions that verified the actor's own credentials are re-authenticated; impersonated sessions get 403 `IMPERSONATION_FORBIDDEN` on `/staff/security/*` and every recent-reauth route. |
| `PATCH /admin/staff` skipped re-authentication | GET and POST required it, but PATCH could set another member's password, role or active state with an owner cookie alone. | Add `requireRecentReauth()` to PATCH. |
| Security events silently dropped | `super_login_failed`, `staff_login_failed` (unknown or inactive account) and `csrf_denied` were plain inserts that RLS rejected; `qr_replay_blocked` was rolled back with the rejected award. | Record them through the privileged security-event path; log the QR replay after the award transaction rolls back. |
| `PUT /admin/branding` lacked CSRF protection | The only cookie-authenticated mutation without `csrfProtect`; SameSite and CORS limited it to same-site or allowed origins. | Add `csrfProtect`; the admin client already sends the header. |
| TOTP codes could be replayed | No accepted time step was stored, so a captured code worked again for about 60–90 seconds at login or re-authentication. | Store the last accepted step per account and accept only a later one, recorded atomically at login, re-authentication and enrollment. |
| Redis rate-limit keys could lose their expiry | `INCR` and `PEXPIRE` were separate calls; a failure between them blocked an IP or phone permanently. | One Lua script increments and guarantees an expiry, repairing keys without one; releases never recreate an expired key. Both scripts are registered on the client and run by SHA (EVALSHA). |
| Secrets compared in non-constant time | The signup CAPTCHA secret and `REGISTRATION_API_KEY` were compared with `!==`. | Use `timingSafeEqualString`. |
| Reset and email-change links outlived account changes | Completing a reset or email change, or an owner changing a member's password or deactivating them, left other links valid; super-admin reset did not check the token's email. | Invalidate the actor's other tokens in the same transaction and require the token email to match the current account email. |

### Points ledger, expiry and tiers

| Defect | Reproduction | Correction |
| --- | --- | --- |
| Reconciliation counted refunds and expiries twice | Running the real functions, a refunded 100-point award produced a "fix" of −100 and an expired award −100 points and lifetime; automatic repair would apply it nightly. | One expectation formula (`ledgerExpectationSql`) for reconciliation, corrections and the customer 360 view, counting reversed and expired originals once. |
| Settled pending points never reached lifetime points | With `pending_points_hold_days=3`, a settled 40-point award left lifetime points at 0. | Settlement adds the settled amount to `lifetime_points`. |
| Expiry took points already spent | Earn 100, redeem 100, earn 100 again: when the first award passed the window, expiry deducted the fresh 100. | FIFO expiry deducts at most the balance minus points earned after the cutoff; refund rows no longer expire on their own. |
| Staff refund of an expired award deducted again | `/staff/refund` accepted EXPIRED originals and removed the same points twice; POS refunds and order returns already refused. | Return 409 "Los puntos de esta transacción ya vencieron; no se pueden revertir." |
| Held awards skipped every post-award hook | With a pending hold, tier, achievement, challenge and referral hooks returned early and settlement never ran them. | New `afterCommit()` runs the staff-award hooks once per settled row after settlement commits. |
| Tier upgrades used the spendable balance | A customer earning 1,200 while redeeming every 300 never reached a 500-point tier; the `check_tier_progression` trigger had the same flaw. | Tiers use `lifetime_points` or the rolling earned sum; a migration fixes the trigger for lifetime mode. |
| Negative "points to next tier" and false top tier | Points arriving without a staff award left stale tiers: the wallet showed "-300 puntos más" or "Nivel máximo alcanzado"; default tiers were in English. | Reading a tier evaluates it first, the remainder is never negative, new businesses get Bronce, Plata and Oro, and responses add `available_points` and `tier_points_mode`. |
| Tier multipliers promised but never applied | Default perks offered "25% bonus points" and "50% bonus points" and screens showed "Nx", but awards never apply `points_multiplier`. | Remove the multiplier perks from defaults; the customer badge, admin tier screen and merchant preview say the multiplier is not applied. A migration gives businesses whose tiers are still the untouched English defaults the Spanish names and perks. |
| Daily redemption limit could be exceeded | Without the reward-promise lock, two concurrent redemptions under a 1-per-day limit both succeeded or deadlocked. | Lock the customer's balance before counting, in business, reward, balance, customer order. |
| Gift-card retry ignored the payload | A reused `requestId` with another card, type or amount returned the earlier result as success while nothing was deducted. | Return 409 when the operation type, amount or card differ. |
| Gift-card ledger check read only 100 rows | Cards with more than 100 transactions lost their ISSUE row and reported `mismatch: true`. | Sum the card's whole history in SQL (`GiftCardRepo.sumTxByCard`). |
| Order webhook ignored currency and decimals | A GTQ business accepted `{amount_q:100, currency:"USD"}` as Q100, and 10.005 earned points on an amount stored as 10.01. | Validate `amount_q`, `subtotal_q`, `discount_q` and `tax_q` like external awards; a missing currency means the business's currency. |
| Gamification revocations reported as ledger drift | After merging, revocations lowered `lifetime_points` but the formula assumed they did not (expected 700, stored 600). | New revocations record `meta.lifetime_reversed`, which the formula counts; older ones still match. |

### Referrals and gamification

| Defect | Reproduction | Correction |
| --- | --- | --- |
| Recurring challenge progress carried over | Two visits in week 1 and one in week 3 completed a weekly three-visit challenge and paid it. | Reset progress whenever its window has passed, completed or not. |
| Challenge windows rolled over at 18:00 in Guatemala | Windows used UTC, so a daily challenge completed at 17:00 could pay again at 19:00 the same local day. | One shared `recurrence-window.js` in the business time zone (default America/Guatemala), weeks starting Monday. |
| Unrelated refunds revoked points and streak achievements | A customer who reached 1,000 points and redeemed 900 lost Points Collector and its 100 points when an unrelated Q10 purchase was refunded. | Measure "points" against lifetime points and "streak" against the longest streak; types the code cannot measure are not revoked. |
| One-time challenge reconciliation used lifetime totals | Refunding the qualifying purchase kept the reward when older spending covered the target, or marked a challenge complete without paying. | Recompute only from settled purchases inside the challenge dates; progress only falls and `times_completed` is never raised. |
| Concurrent awards double-paid achievements and challenges | Points were credited before the `ON CONFLICT DO NOTHING` insert and progress was written unlocked; the old code paid six times in the integration test. | Lock the customer's balance row after the source transaction and credit an achievement only when its insert returned a row. |
| Referral rewards paid after the program was switched off | Applying a code and paying the reward never checked the owner's switch or the plan's `referrals` feature. | Check both when applying a code and inside the reward transaction; pending referrals stay pending. |
| Refunded and pending purchases met the referral minimum | With a Q200 minimum, buying Q150, refunding it and buying Q60 counted Q210 and paid both sides; rewards were never reversed. | Count settled, unrefunded purchases; refunding the qualifying purchase reverses both rewards once and returns the referral to pending. |
| Referral reversal with one side expired paid that side twice | Only the unexpired side was reversed and the referral reopened, so a later purchase paid the expired side again. | Keep the referral and both rewards when either side has expired. |
| Expired milestone rewards deducted twice | Revoking an achievement or challenge whose reward had expired deducted the points again, or failed with "Refund policy forbids negative balances". | Revoke the completion without deducting expired points, as staff refunds do. |
| Referral withdrawal kept the referrer's achievements | Only the refunded customer was re-measured, so the referrer kept "Social Butterfly". | Re-measure the referrer's achievements once when a referral returns to pending. |
| "Social Butterfly" could never be earned | Referrals were counted with `status='completed'`, but rewarding moves them to `rewarded` in the same transaction. | Count `completed` and `rewarded`. |
| Item milestones counted non-sale rows | `total_items` used its own filter, unlike spend, visits and streaks. | Use `reportingPurchase("t")` for items too. |
| February 29 birthdays never matched in non-leap years | The exact month-day comparison skipped them three years out of four. | Celebrate them on February 28 in non-leap years, once. |
| Paid-plan wallets stuck on "Actualización incompleta" | With the plan feature on and the owner switch off, `/customer/referral-code` returned 403 and the section counted as failed. | `/customer/me` adds `business.referrals_enabled`; the wallet loads referrals only when true, and older clients still get the existing 403. |
| Web sign-up never sent a referral code | The server accepted `referralCode`, but the web form had no field and read no URL parameter. | Optional validated field prefilled from `?ref=` or `?codigo=`; "Copiar" copies an invitation link to `/registro/<slug>?ref=CODE`. |

### POS, payment webhooks and outbound webhooks

| Defect | Reproduction | Correction |
| --- | --- | --- |
| Webhook SSRF through IPv6 forms of internal addresses | The validator accepted `[::ffff:127.0.0.1]`, `[::ffff:169.254.169.254]`, `[64:ff9b::7f00:1]`, `224.0.0.1` and a DNS answer of `::ffff:10.1.2.3`. | Allow only public unicast addresses (`net.BlockList`), judge mapped, NAT64 and 6to4 addresses by their IPv4, and require every DNS answer to pass. |
| Webhooks to hostnames failed on Node 24 | The pinned lookup returned one address where Node requested a list (`ERR_INVALID_IP_ADDRESS`); the timeout only covered idle connections. | Answer both lookup forms and add hard DNS and request deadlines. |
| Loyverse sync froze permanently | Walk-in sales and other unresolvable receipts queued without limit; past 500, every sync returned `RETRY_QUEUE_FULL` with the same window. | Walk-in and ignorable receipts are not retried, receipt-data problems go to a review list, and others back off (5 minutes to 12 hours) for 20 attempts or 7 days; the queue never blocks the forward scan. |
| Payment amount silently became 0 | `"Q48.50"`, `"1,250.00"` or a missing amount normalized to 0, the event was APPLIED with no points, and a corrected redelivery was dropped as a duplicate. | Accept a non-negative number or decimal string with at most two decimals; otherwise mark FAILED `invalid_amount`, answer 400, and apply a corrected redelivery. |
| Payment event IDs unique across all businesses | A second business sending an existing event ID got a permanent 400, and an unmapped row could be taken over by another business. | Unique key `(provider, business_id, business_slug, provider_event_id)` with `NULLS NOT DISTINCT`; a trigger keeps rows in their business outside platform-admin sessions. |
| Outbound deliveries stuck in SENDING | A restart or a failed `recordFailure` left claimed rows in SENDING forever. | Claims are leases (`claimed_at`, `claim_token`): expired claims are reclaimed as an attempt, and only the token holder can mark sent or failed. |
| Manual resolve credited non-completed payments | A manager could resolve an IGNORED refund or pending-payment event and credit points. | Only `payment.approved` events in PENDING_MAPPING, or FAILED `invalid_amount` with a corrected `amountQ`, can be resolved; others get 409. |
| Webhook signature failures were never recorded | `webhook_auth_failed` was a plain insert that RLS rejected before a tenant was known. | Record it through the privileged security-event path. |

### Analytics, reporting and schema

| Defect | Reproduction | Correction |
| --- | --- | --- |
| Ledger reconciliation endpoint failed and would leak | The findings query selected `delta_*` columns that do not exist (500 once a run completed); runs included `business_id IS NULL` and findings were filtered by run only. | Compute deltas from stored and expected columns, read only the tenant's business-scope runs and findings, and restrict the endpoint to owners. |
| Reconciliation tables had no RLS | Runs, findings and `ledger_balance_corrections` were not tenant-isolated. | Enable and force RLS with the `security_events` policy; rows without a business are platform-admin only. |
| Nightly reconciliation and certification were platform-wide | One global run shared one customer limit; under the least-privilege role certification files read "Unknown business" with zero totals, and tenants saw platform mismatch counts. | Run both per business under its tenant context; anomalies and certification read the business's own latest run. |
| Operator metrics read zero under RLS | Ledger, customer, points, webhook, payment backlog, job, billing and churn-message gauges queried RLS tables without context, so their alerts could never fire. | Query them through the explicit platform-admin context. |
| Correction requests accepted other businesses' sources | `sourceRunId` and `sourceFindingId` from another business were accepted. | Require the cited finding or run to belong to the caller's business and customer; otherwise 400. |
| Customer value, churn and RFM counted non-purchases | Expiries, bonuses and redemptions matched `type='PURCHASE'`, so a winback bonus reset `last_purchase_at` and removed the customer from churn risk. | The LTV trigger, derived state, platform health, RFM and visit streaks use the `reportingPurchase()` definition. |
| Cohort retention inflated | Any transaction counted as activity, deleted customers could give 200%, unfinished months showed 0%, and the dashboard read fields the API never returns. | Rebuild cohorts in one transaction from recorded purchases of live customers, return null for unfinished months ("en curso"), and grant the privileges recalculation needs. |
| Money sums overflowed `numeric(10,2)` | Totals above 99,999,999.99 (reachable in COP) made the analytics dashboard and ROI return 500, and the LTV trigger failed later purchases. | Sum as unbounded numeric with `ROUND(..., 2)` and widen `customer_ltv` money columns; a unit test rejects the cast in `src`. |
| IVA report and ROI counted non-sales | Refunded purchases kept their amount, and redemption, expiry and migration rows counted as transactions. | Both use `reportingPurchase("t")`. |
| IVA and certification dates were malformed | The IVA CSV printed JavaScript date strings grouped by the database server's day; certification daily rows read "Mon Nov 16" with no year. | Group IVA rows by the business's local day and print `YYYY-MM-DD` in both. |
| Customer averages stored with 16 decimals | Two merged migrations combined to store values such as `60.0000000000000000`. | `ROUND` in the replacement LTV trigger. |

### Owner, staff and admin screens

| Defect | Reproduction | Correction |
| --- | --- | --- |
| "Guardar regla" wiped program settings | The save replaced `program_json`, deleting campaign rules, second-visit, operating mode, data health and currency settings; no role could save tier policy. | Merge only submitted keys, strip keys owned by other services, and give owners the advanced program permission. |
| Rejected awards replayed from the offline queue | A rejected award stayed queued and was resent every 30 seconds, so re-entering it could credit twice; a 409 could not be discarded. | Retry only network failures and ambiguous responses; 4xx rejections stop, and a 401 is held for Reintentar or Descartar. |
| New idempotency key on every redemption click | A lost response followed by a second click deducted points or charged a gift card twice. | Reuse the `requestId` while customer, reward or card, and amount are unchanged. |
| Sensitive owner and platform actions not audited | Staff, program, reward, branch and customer changes, the customer CSV export, platform staff creation, plan features and secret rotation wrote nothing. | Audit each without secrets; owner changes and their audit rows commit in one transaction, and `audit_logs` accepts platform-wide super-admin rows. |
| Branch filter mixed two branches | Switching quickly rendered the previous branch's slower responses under the new label. | A load sequence and current-branch guard drop stale responses and error toasts. |
| A global branch code blocked signup | A branch coded `panaderia-lupita-main` made every later "Panadería Lupita" signup fail. | Codes are unique per business; signup retries with a random suffix and branch creation returns 409 `BRANCH_CODE_IN_USE`. |
| "Ritmo del negocio" set a capacity nobody chose | The screen defaulted capacity to 10 on every save, and an empty field became 0 and blocked every quiet offer. | Empty means "Sin límite", capacity is sent only when changed, and the server accepts `null`. |
| Data-health settings could not be saved | Heartbeats changed the version hash, so saves returned 409 forever, shown as a connection problem. | Hash only owner-editable fields; on conflict show the server message and refresh only the version, keeping edits. |
| Supplier payment date checked in UTC | Between 18:00 and midnight in Guatemala, tomorrow's date was accepted. | Compare with today in the business time zone on client and server. |
| "Recomendaciones" contradicted the server | It said shared codes keep working while referrals are off and described the minimum as the "acumulado registrado". | Text now matches enforcement: codes are unusable while off and the minimum counts confirmed, unrefunded purchases. |
| Staff screen moved controls during use | Sections loading after the screen opened grew by about 1,860 px above account security, so a press and release could land on different elements and the click was lost. | `keepInteractionInPlace` keeps the last pressed or focused control at the same screen position; new browser test `staff-layout-stability.spec.js`. |

### Customer website

| Defect | Reproduction | Correction |
| --- | --- | --- |
| Wallet blanked every 15 seconds | Each refresh emptied history, rewards and referrals before about seven sequential requests; returning to the tab queued two full reloads. | Keep the card on screen until each section's replacement arrives, clear only for another customer, session or cleared view, and run one refresh for focus, visibility and the timer. |
| Tier progress copy was wrong | Any non-zero remainder read as progress, so negative values showed, and 0 or null claimed the top tier. | "Nivel máximo alcanzado" only without a next tier; otherwise "Ya tienes los puntos para …" or "Siguiente nivel: …". |
| Theme toggle broke after an OS theme change | The change handler bound a second click listener, so each click flipped the theme twice. | The handler only re-applies the theme and updates the label. |
| Numbers used the wrong locale | Reward costs used `'es'` ("12.345", "0,1") beside es-GT statement figures; card and history points were ungrouped. | Region-aware helpers (es-GT default) across the wallet and the server's Wallet pass engagement text. |
| Spanish plural errors | "2 opciónes" and "Te faltan 1 puntos" appeared beside corrected copy. | One pluralization helper for badges, labels, progress, costs, offers and the statement. |
| Raw JSON in QR and contact errors | An expired session showed `{"error":"No autenticado",...}` on "Mostrar QR"; every contact failure showed one generic message. | QR errors use the session-expired flow or Spanish messages; the contact form checks length and explains rate limits and failed verification (additive `code` on 400s). |
| Customer page over-promised tiers and referrals | The static markup showed a "1.0x" multiplier and "ambos ganan puntos". | A "Por puntos ganados" badge and referral text conditioned on the business's rules. |

### Help center, documentation and test infrastructure

| Defect | Reproduction | Correction |
| --- | --- | --- |
| Help guides described old behavior | Guides covered the "Fallidos" queue, capacity, referral switching, expiry, tiers and POS review as they worked before. | 38 guides reviewed against the changed code, 12 corrected; sidebar label updated, reviewed-source baseline recorded and `public/ayuda` rebuilt. |
| Policy and integration docs were inaccurate | `docs/LOYALTY_POLICY.md` predated these rules; `docs/POS_INTEGRATION_GUIDE.md` said Loyverse refunds are never reversed automatically. | Policy updated; the POS guide describes automatic reversal of verified full refunds; payment webhook docs and OpenAPI updated (`amountQ`, owner-only ledger endpoint). |
| Single-label hosts redirected to invented origins | Requests to a container name such as `api` or an IP address were redirected to `app.<host>`, which cannot resolve. | Infer sibling origins only for dotted DNS names. |
| Isolated browser runner failed most shared-stack specs, even on main | Browsers targeted `http://api:3001` (redirect above, links built for localhost:3101, no service-worker secure context), and the API could restart after its first health check because API and worker raced to apply migrations. | Playwright shares the API's network namespace at `localhost:3001`, origins match, and `npm run test:e2e` waits for a stable API. |
| Timing-dependent release-readiness tests | A fixed 150 ms delay lost the race with the child's signal handler under CPU load (3 of 3 failures). | Cancel only after the child process writes a ready file. |

## Behavior changes owners, staff or customers will notice

- Impersonated (platform support) sessions cannot pass re-authentication: they cannot change MFA, email or lockdown, or list, create or edit staff. They receive 403 `IMPERSONATION_FORBIDDEN` with a Spanish message, which the staff screen and owner workspace show instead of offering re-authentication. Magic-link sessions no longer count as re-authenticated.
- TOTP codes are single-use; re-authenticating right after login needs the next 30-second code.
- Rate limits are per endpoint family, per 15 minutes: staff login 5 per account and IP and 30 per IP, super-admin login 5 and 10 (failures only); signup, reset requests and the contact form 5 per IP; token confirmations 10 per IP (failures only); customer code requests 20 per IP (previously 5, shared) plus the existing per-phone limit.
- The referral switch and plan feature are enforced: while off, codes entered at sign-up are not applied (the sign-up still succeeds) and pending referrals pay nothing. Refunding the qualifying purchase can reverse both rewards and reopen the referral.
- Points expire oldest-first (FIFO), so only unspent old points expire. Expired awards cannot be refunded (409).
- Tiers follow earned points (lifetime or rolling window) and are re-evaluated at settlement and when read. Owners, not managers, can save tier policy. New businesses get Spanish default tiers (Bronce, Plata, Oro).
- Businesses whose tiers are still exactly the original English defaults now show Bronce, Plata and Oro with the Spanish perks, which no longer promise "25% bonus points" or "50% bonus points". Thresholds, colors and customer tier assignments do not change. Tiers an owner changed in any way keep their own text.
- Tier multipliers are not applied to awards and are no longer advertised by defaults, the customer page or the admin tier screens.
- Ledger reconciliation runs nightly per business, and the reconciliation endpoint is owner-only (managers and cashiers get 403).
- Loyverse walk-in sales are not retried and appear in the owner panel as one summary line, not as errors. Receipts with permanent problems move to "Recibos para revisar", and the last-sync line shows retry and review counts.
- Payment events with an invalid amount are recorded as failed (400 to the provider) and can be assigned from "Pagos con monto inválido" with a corrected amount.
- The staff offline queue no longer resends sales the server rejected; expired-session sales offer Reintentar or Descartar.
- Recurring challenges reset per local day, week (from Monday) or month, and wallet numbers follow the business region's format.

## Deployment notes

- Ten new migrations: `2026-11-17-admin-branch-codes.sql`, `2026-11-17-admin-money-aggregates.sql`, `2026-11-17-admin-platform-audit.sql`, `2026-11-17-analytics-ledger-rls.sql`, `2026-11-17-analytics-purchase-stats.sql`, `2026-11-17-auth-totp-replay.sql`, `2026-11-17-integrations-payment-event-scope.sql`, `2026-11-17-integrations-webhook-delivery-lease.sql`, `2026-11-17-ledger-default-tier-text.sql` and `2026-11-17-ledger-tier-earned-points.sql`. They are idempotent and additive or online-safe: nullable columns, new indexes, RLS on three tables, replaced trigger functions, wider `customer_ltv` precision, a `NOT VALID` check on `audit_logs`, and a text-only update of the names and perks of untouched English default tiers (matched on every owner-editable field, with tier ids kept). The payment-event key uses `NULLS NOT DISTINCT` (PostgreSQL 15 or later; the Compose files pin 16.15).
- Migrations are an explicit operator step (`npm run ops:migrate`). Switch the API and worker images promptly afterwards. Once the payment-event constraint is swapped, old API instances cannot record payment webhook events, because their `ON CONFLICT (provider, provider_event_id)` no longer matches a unique constraint; this lasts until they are replaced, and providers retry failed deliveries. Outbound deliveries still in flight start their lease when a new worker first sees them, so they are not sent twice.
- After deploying, run `npm run ops:analytics:recompute-purchase-stats`. It works per business in short batches, can be repeated, and never modifies transactions, balances or visit streaks. Cohorts are rebuilt the next time analytics are recalculated.
- Until the first nightly per-business reconciliation, owners see "Aún no hay conciliaciones completadas" and the ledger gauges read zero. Earlier platform-wide runs remain visible to platform administrators only.
- The service-worker cache is bumped to `pf-v57`. The merchant bundle (`public/merchant/recursos`) and the help site (`public/ayuda`) are rebuilt.
- Native apps are unaffected. Mobile routes keep their response shapes; only the looser customer code-request limit and the number formatting in Wallet pass text change. The referral switch also applies to codes entered in the app.

## Verification

- 1,848 unit tests pass with no skips. ESLint and TypeScript pass.
- The merchant typecheck passes from a clean lockfile install, and 161 merchant tests pass.
- All 65 PostgreSQL domain suites pass (723 checks) under the restricted runtime role. The tier text migration is tested by re-running it on fixture businesses: untouched English defaults are rewritten with their ids kept, and any edited set is left byte for byte; the test fails without the migration. Six new suites cover this work: `admin-integrity`, `analytics-ledger-integrity`, `auth-runtime-role`, `engagement-rewards`, `integration-webhooks` and `ledger-balances`.
- The full Playwright suite ran in Chromium and Firefox through the repository runner (`npm run test:e2e`) on an isolated stack: 156 passed, none flaky, and 5 were skipped (the visual snapshots, which run on Chromium only). Five failures also fail identically on main under the same conditions. Four are visual snapshots, because the isolated network cannot load Google Fonts. The fifth is the Firefox offline legacy-alias test, where `/c` opens the card at its canonical `/mi-tarjeta/` URL.
- The staff layout browser test passes 20 of 20 runs. The MFA browser test, updated for single-use TOTP codes, passes 12 of 12.
- The help build check passes (81 pages, reproducible).
- Each corrected defect has a regression test that failed on the previous code, where the fix teams state so.

Tests use fictional data and disposable databases. Browser results do not establish native device behavior, physical POS hardware behavior or Apple/Google Wallet provider acceptance.

## Open decisions and follow-ups

- **Tier multipliers:** they stay off for now. `points_multiplier` is still stored but never applied, and the untouched default tiers keep their stored 1.25 and 1.50. If multipliers are ever implemented, make them an explicit per-tier opt-in rather than activating these stored values. Tiers an owner edited were not rewritten, so some may still promise extra points; the points-rule guide tells owners how to correct the perks.
- **Walk-in counting:** the owner panel subtracts walk-in sales from errors, but the server still counts them in `errors`. If the server changes, change both together.
- **Firefox offline legacy URL:** decide whether `/c` should stay on its alias offline or the test should accept the canonical `/mi-tarjeta/` URL.
- **Visual snapshots:** regenerate them with fonts available, using the design-screenshots workflow.
- **Referral reversal policy:** if the referrer's balance cannot cover a reversal and the business does not allow negative balances on refunds, both referral rewards are kept with a logged warning. The referrer's achievements are kept in the same way. This is a policy choice.
- **Existing lifetime totals:** customers whose pending points settled before this fix have understated `lifetime_points`, which can hold them in a lower tier. Reconciliation flags them, and the correction workflow can repair them.
- **Recovery audiences:** customer recovery still excludes purchases whose status is EXPIRED. This was deliberate and is locked by tests, but the owner may want to revisit it.
- **Unmapped payment events:** a corrected redelivery now creates a new row for the right business. The old unmapped row stays PENDING_MAPPING for platform review.
- **Super-admin audits:** these entries remain best effort, because `logSuperAudit` ignores write failures.
- **Tables without RLS:** `auth_sessions`, `auth_action_tokens`, `internal_magic_links`, `staff_login_index`, `business_public` and `super_admin_auth_settings` still have no RLS. They are authentication tables or lookups used before a tenant is known, and were left unchanged.

## Scope

Website, browser screens and server only. Native apps under `apps/customer`, their dependencies, versions and cloud builds are unchanged, following the website-first release cadence in `AGENTS.md`.
