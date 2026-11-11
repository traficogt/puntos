# Merchant website implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for implementation and sequential spec/quality reviews.

**Goal:** Give PF owners a clear, trustworthy overview and easier program launch and campaign tools, informed by research across ten loyalty vendors and fifteen framework options.

**Architecture:** An isolated React/Mantine website at `/merchant/` is built locally into `public/merchant`. Existing Express/PostgreSQL, same-origin staff authentication, tenant permissions and legacy administration remain in place. Add a read-only analytics API; no native application changes, commercial entitlement changes, outbound campaigns or cloud builds.

**Tech stack:** Mantine core/form/charts, React, Recharts, Vite; existing Express/PostgreSQL. Preserve Bricolage Grotesque, Fraunces and Inter, warm paper/terracotta palette, dark mode and mobile usability. Ordinary tables suffice; no speculative BI service or grid.

## Research decisions

Mantine fits guided forms, owner navigation and accessible charts. Ant Design is the strongest dense-table alternative. Frappe UI works with Express but introduces Vue; adopting full Frappe is unnecessary. Tabler is incremental but leaves more state wiring. Superset/Metabase/Insights are future advanced BI options requiring explicit tenant integration. Research evidence is in `/var/lib/puntos/releases/merchant-web-20261110/research-{retail,growth,frameworks}.json`.

Recurring practices from Loopy, Devotio, Loyverse, Square, Toast, Smile, LoyaltyLion, Yotpo, SumUp Connect and TapMango: clear earning rules, attainable rewards, guided launch, checkout enrollment, visible campaign controls and understandable performance. Vendor case studies are not causal evidence or PF forecasts.

## Task 1: Accurate overview API

Files: create `src/app/services/merchant-overview-service.js`, `src/app/routes/analytics/overview.js`; register in `src/app/routes/analytics-routes.js`; add targeted unit/integration tests.

- [x] Define and test qualifying purchase semantics from existing transaction writers: posted/pending purchases with actual purchase activity, excluding reversed, voided, bonuses, redemptions, corrections. Use explicit business/branch boundaries, customer deletion policy and validated periods.
- [x] Add owner-only, existing analytics-plan-gated `GET /api/admin/analytics/overview?days=7|30|90&branch_id=<uuid>`.
- [x] Return `{ok, generated_at, timezone, currency:'GTQ', period:{days,start,end,previous_start,previous_end}, scope:{branch_id}, current, previous, daily, rewards, notes}`. Metrics: `recorded_sales_q`, `purchases`, `active_customers`, `repeat_customers`, `repeat_rate_pct`, `average_ticket_q`, `redemptions`. Repeat means >=2 qualifying purchases during that window; rate is repeat/active. Undefined rates/averages are null, zero counts are zero.
- [x] Use equal calendar windows in configured business timezone, through current timestamp today; document partial day. Daily rows `{date, recorded_sales_q, purchases}` with zero-filled dates, rewards `{name, redemptions, points_redeemed}`. Redemptions must be actual completed redemptions, not requests/cancellations.
- [x] Validate with disposable PostgreSQL fixtures including boundaries, reversals, bonuses, deleted customers, multiple tenants/branches and zero activity. Do not query private production data for tests. Preserve old APIs.

## Task 2: Maintained merchant frontend

Files: `web/merchant/{package.json,package-lock.json,vite.config.js,index.html,src/*}`, generated `public/merchant/*`; links in `public/staff-login.js`, `public/admin-dashboard.html`; host routing allowlist if required.

- [x] Pin verified compatible React/Mantine/Recharts/Vite versions; isolate native graph. Build into public/merchant, no remote runtime dependency/CDN. Keep notices.
- [x] Add same-origin API client using existing `/lib.js` CSRF behavior, session epoch/logout protection; no PII persistence or API caching. Block old responses after logout/account change; latest period/branch response wins.
- [x] Use Mantine shell, accessible controls and keyboard charts. Summary metric labels say recorded sales and repeat purchases, never incremental revenue or ROI. Display previous-window comparison, date/timezone/freshness/coverage, accessible daily-data table and most redeemed rewards.
- [x] Provide error retry, loading, empty and plan-locked states. No placeholder data in live UI. Owner landing links to overview; managers retain existing access. Preserve legacy administration links and deep links.
- [x] Add guided launch page linking business branding, earning rule, rewards, enrollment QR/materials, staff test and POS setup. Completion is derived only where real data supports it; avoid claiming a pilot test occurred.

## Task 3: Guided campaign editing

Files: `web/merchant/src/Campaigns.jsx`, `campaign-model.js` and tests.

- [x] Read/save existing `/api/admin/campaign-rules` with plan gating and CSRF. Use Mantine form inputs, active switch, amount/visit/item minimum, weekdays, start/end hours, multiplier/bonus and cap. Explain configured timezone and sequential stacking.
- [x] Templates create local drafts only. Explicit save applies rules; never sends a message. Show unsaved state and prevent accidental navigation while dirty.
- [x] Preserve all existing supported fields, identity/order and disabled rules. Detect unknown fields/types and require legacy editing rather than silently dropping them. Validate finite positive rewards, nonnegative minimums, hour bounds and no overnight interval; end hour is inclusive through xx:59. Empty weekdays means every day.
- [x] Test loading, editing, template draft, save/error, field preservation and API validation.

## Task 4: Verification and release

- [x] Baseline 17 point/program tests already passed; capture file backups before edits. Review exact scoped differences, not historical worktree dirt.
- [x] Run unit/route and disposable PG checks; frontend build; root lint/type checks as applicable. Browser tests at desktop and 390px, light/dark, keyboard, delayed requests, logout, plan gates, form errors and chart table equivalence. Capture screenshots for visual review.
- [x] Independent spec review then quality review; resolve material findings before release.
- [x] Mirror only task files after baseline hash checks. Build scoped Docker overlay from current live API image; retain worker/native images and dependency graphs. Deploy, check health/static routes/API authorization and rollback availability. No migration expected.
- [x] Report shipped behavior, framework rationale, actual validation and remaining external pilot requirements honestly.
