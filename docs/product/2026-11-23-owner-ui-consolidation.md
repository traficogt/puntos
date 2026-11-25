# Owner UI consolidation: vanilla dashboard vs. merchant app (2026-11-23)

The owner wants the owner-facing UI to converge on the React 19 + Mantine merchant app
(`web/merchant`, served at `/negocio/`, `/merchant/` and the password-free preview `/demostracion/`).
The older vanilla-JS dashboard lives in `public/admin-dashboard/` (served at `/administracion/`).
This document lists every capability of each vanilla module with the API it calls, names the
merchant equivalent where one already existed, and records what this wave ported. Nothing on the
vanilla side was removed or redirected; that remains a separate owner decision.

Plan gating is unchanged: every endpoint keeps its `requirePlanFeature` guard (403
`PLAN_FEATURE_LOCKED`), the merchant navigation hides pages whose `pageFeatures` flags are off,
and each new view renders `OwnerRestricted` when its flag is missing, so no locked request is sent.

## Gap table

Legend: **existing** = an equivalent merchant view already covered it; **ported** = added in this
wave; **vanilla only** = still only in `/administracion/`.

| Vanilla module (tab) | Capability | Endpoint(s) | Merchant status |
| --- | --- | --- | --- |
| branding (Marca) | Enrollment link + QR (copy, download SVG) | `GET /api/admin/customer-enrollment`, `GET …/qr.svg` | existing: `LaunchEnrollment` (Preparar mi programa), `BrandedQr` |
| branding | Customer branding form: mode, program name, logo URL, QR logo (Empresa), primary/accent colors, neutral theme, powered-by, wallet/join headlines; summary | `GET/PUT /api/admin/branding` | **ported** in `OwnerBranding.tsx` (page `branding`, `#identidad`) |
| rewards (Recompensas) | Create reward (name, description, cost, stock, valid_until, branch scope) | `POST /api/admin/rewards` | existing: `RewardsWorkspace` (`/api/admin/reward-workspace`, richer: POS mapping, unit cost, availability) |
| rewards | Toggle active, change cost | `PATCH /api/admin/rewards/:id` | existing: `RewardsWorkspace` editor |
| rewards | Plan reward limit text | `GET /api/admin/plan` limits.rewards | existing: workspace shows catalogue; soft caps live in Reportes |
| rewards | Inspect latest redemption ledger of a reward | `GET /api/admin/analytics/rewards/:id/redemptions`, `GET /api/admin/analytics/redemptions/:id` | vanilla only (analytics-gated audit detail; partial equivalents: `Fulfillment` redemption evidence, `DataHealth`) |
| tiers (Niveles) | List tiers with customer counts; create; edit; delete (blocked with customers) | `GET/POST /api/admin/tiers`, `PUT/DELETE /api/admin/tiers/:id` | **ported** in `OwnerTiers.tsx` (page `tiers`, `#niveles`, feature `tiers`) |
| program (Regla de puntos) | Program type + rate/rounding | `GET/POST /api/admin/program` | existing: `LaunchProgramEditor` via `/api/admin/launch/program` (versioned, all 7 program types) |
| program | Award guard (max amount/points/visits/items), suspicious thresholds | `POST /api/admin/program` (program_json.award_guard) | **ported** in `OwnerProgramLimits.tsx` (page `limits`, `#limites`, feature `program_rules`) |
| program | Pending hold days, points expiration | `POST /api/admin/program` | **ported** in `OwnerProgramLimits.tsx` |
| program | Redemption guard (per day, per reward, cooldown) | `POST /api/admin/program` (redemption_guard) | **ported** in `OwnerProgramLimits.tsx` |
| program | Balance policy (negative balance on refund) | `POST /api/admin/program` (balance_policy) | **ported** in `OwnerProgramLimits.tsx` |
| program | Tier policy (lifetime / rolling window, grace days) | `POST /api/admin/program` (tier_policy) | **ported** in `OwnerProgramLimits.tsx` (shown when `tiers` is on) |
| program | Lifecycle: birthday / win-back points, scheduler hour & timezone | `POST /api/admin/program` (lifecycle) | existing: `Automations` via `GET/PUT /api/admin/automations` (adds monthly budgets, contact spacing, history) |
| program | Automation templates (cafetería básico, reactivación fuerte, solo alertas) | `PUT /api/admin/automations/template` | vanilla only (deliberate: templates overwrite lifecycle settings, including digest keys, outside the Automations editor's validation) |
| program | Campaign rules JSON | `GET/PUT /api/admin/campaign-rules` | existing: `Campaigns` (structured editor) |
| program | Suspicious awards list (branch filter) | `GET /api/admin/awards/suspicious` | **ported** in `OwnerProgramLimits.tsx` (feature `fraud_monitoring`) |
| program | Branch filter for dashboard | `GET /api/admin/branches` | existing: `Overview` and `OwnerReports` filters |
| program → pos-integration | POS connection (Loyverse / CSV / API), save, generate key, CSV preview/import, Loyverse preview/sync | `GET/PUT /api/admin/pos`, `/api/admin/pos/*` | existing: `PosConnect`, `PosInstallation`, `PosRefunds` |
| program → external awards | External awards toggle + API key | `GET/PUT /api/admin/external-awards` | existing: `PosConnect` (API mode) |
| gamification (Logros) | List achievements; create; toggle active; delete | `GET/POST /api/admin/achievements`, `PUT/DELETE …/:id` | **ported** in `OwnerGamification.tsx` (page `gamification`, `#logros-y-retos`, feature `gamification`) |
| gamification (Retos) | List running challenges; create (type, requirement, reward, dates, recurrence); delete | `GET/POST /api/admin/challenges`, `DELETE …/:id` | **ported** in `OwnerGamification.tsx` (also exposes `max_completions`) |
| giftcards (Gift Cards) | Issue card (amount, recipient, idempotent requestId); list; ledger (stored vs expected, last movements) | `GET/POST /api/admin/gift-cards`, `GET /api/admin/gift-cards/:code/ledger` | **ported** in `OwnerGiftCards.tsx` (page `giftcards`, `#tarjetas-de-regalo`, feature `gift_cards`) |
| referrals (Referidos) | Settings (enabled, referrer/referred points, min purchase, reward on signup) | `GET/PUT /api/admin/referral-settings` | existing: `Referrals` |
| referrals | Leaderboard / referrer count | `GET /api/admin/referral-leaderboard` | existing: `Referrals` uses `GET /api/admin/referral-growth` (phases, pagination) |
| branches (Sucursales) | List; create (name, address, code) | `GET/POST /api/admin/branches` | existing: `OwnerBranches`; wallet locations in `RegionSettings` |
| staff (Personal) | List; create; toggle active; reset password; gift-card permission | `GET/POST /api/admin/staff`, `PATCH …/:id` | existing: `OwnerTeam` (adds role, branch, re-auth) |
| ops (Operación) | Activation checklist (rule, rewards, staff, branches, analytics) | `GET /api/admin/program`, `/rewards`, `/staff`, `/branches` (+ `/analytics/dashboard` for a presence check) | **ported** in `OwnerOnboarding.tsx` (page `onboarding`, `#puesta-en-marcha`); the analytics presence probe was replaced by a link, as it only tested that the dashboard responded |
| ops | Printable SOPs (apertura, cierre, entrenamiento) | none (client-side print) | **ported** in `OwnerOnboarding.tsx` |
| reports (Reportes) | Basic participation KPIs with period (7/30/90) and branch filter; top rewards | `GET /api/admin/analytics/overview` | **ported** in `OwnerReports.tsx` (page `reports`, `#reportes`, feature `basic_reporting`). `Overview` already used the same endpoint but only for plans with `analytics`. |
| reports | Plan capacity (active customers vs soft cap, upgrade hint) | `GET /api/admin/plan` usage/limits | **ported** in `OwnerReports.tsx` |
| analytics (Analítica) | Executive summary, growth radar, smart alerts, RFM, ROI, 30-day trend, branch comparison, cohorts, churn list, operations summary | `GET /api/admin/analytics/dashboard`, `/api/admin/roi`, `/api/admin/alerts`, `/api/admin/analytics/churn-risk`, `/api/admin/analytics/cohorts`, `/api/admin/ops/summary` | partial existing: `Overview` (trend, KPIs), `Recovery` (inactive customers), `Economics`; the rest is vanilla only (sidebar link "Informes detallados") |
| analytics | IVA CSV export | `GET /api/admin/billing/iva.csv` | vanilla only |
| analytics | Recalculate metrics + job polling, jobs status | `POST /api/admin/analytics/calculate`, `GET /api/admin/jobs*` | vanilla only |
| analytics | Pending payment webhooks (assign by phone), alerts center | `GET /api/admin/payment-webhooks`, `POST /api/admin/payment-webhooks/:id/*`, `GET /api/admin/alerts` | vanilla only (partial: `Operations` operations-health) |
| analytics | Value anomalies, ledger reconciliation, certification (+CSV, archive), manual corrections (two-owner flow) | `GET /api/admin/analytics/anomalies`, `/analytics/ledger-reconciliation`, `/analytics/ledger-certification`, `/analytics/ledger-certification.csv`, `/analytics/ledger-certification/archive`, `/analytics/ledger-corrections` (+ `/:id` approve/reject) | partial existing: `DataHealth` (`/api/admin/data-health`, `/analytics/ledger-corrections`); the rest vanilla only |
| analytics | Audit timeline (filters, impersonation flag, detail, CSV) | `GET /api/admin/audit`, `/audit/:id`, `/audit.csv` | vanilla only |

### Capabilities that remain vanilla only after this wave

1. Deep analytics suite (dashboard narrative, RFM, ROI, cohorts, IVA CSV, recalculation, jobs,
   payment mapping, alerts, anomalies, reconciliation, certification, audit). Each is a large
   analytics-gated surface; porting it is a separate design decision, not a form port.
2. Reward redemption ledger inspection from the rewards tab (`/api/admin/analytics/redemptions/:id`).
3. Automation templates (`PUT /api/admin/automations/template`), left out on purpose (see table).

## What was added to the merchant app

| View | Route | Endpoints | Gate |
| --- | --- | --- | --- |
| `OwnerBranding.tsx` | `#identidad` (Caja, equipo y ajustes) | `GET/PUT /api/admin/branding` | owner; QR logo only when plan is EMPRESA (server enforces 403) |
| `OwnerTiers.tsx` | `#niveles` (Mi programa) | `GET/POST /api/admin/tiers`, `PUT/DELETE /api/admin/tiers/:id` | `tiers` |
| `OwnerGamification.tsx` | `#logros-y-retos` (Mi programa) | `GET/POST /api/admin/achievements`, `PUT/DELETE …/:id`, `GET/POST /api/admin/challenges`, `DELETE …/:id` | `gamification` |
| `OwnerGiftCards.tsx` | `#tarjetas-de-regalo` (Mi programa) | `GET/POST /api/admin/gift-cards`, `GET /api/admin/gift-cards/:code/ledger` | `gift_cards` |
| `OwnerProgramLimits.tsx` | `#limites` (Mi programa) | `GET/POST /api/admin/program`, `GET /api/admin/awards/suspicious` | `program_rules` (+ `fraud_monitoring` for the list, `tiers` for tier policy) |
| `OwnerReports.tsx` | `#reportes` (Día a día) | `GET /api/admin/analytics/overview`, `GET /api/admin/branches`, plan usage from `/api/admin/plan` | `basic_reporting` |
| `OwnerOnboarding.tsx` | `#puesta-en-marcha` (Avanzado) | `GET /api/admin/program`, `/rewards`, `/staff`, `/branches` (reads only) | owner |

All views follow the `owner-workspace.tsx` pattern (`useOwnerResource`, `useOwnerMutation`,
`useOwnerDirty`, `OwnerError`, `OwnerRestricted`), are strict-TypeScript, and are reachable from
`merchant-navigation.js` and the Configuración index. `OwnerPageProps` gained optional `plan`,
`usage` and wider `limits` so Reportes and Identidad can read plan data already fetched by the shell.
Demo fixtures live in `demo-owner-program.ts`; the demo plan now also advertises
`basic_reporting`, `tiers`, `gamification`, `fraud_monitoring`, `rewards`, soft-cap `usage` and
`limits.activeCustomers`, so `/demostracion/#niveles` etc. work without a backend.

## Observations for the owner

- `GET /api/admin/tiers` returns per-tier statistics only (id, name, tier_level, customer_count,
  avg_points, total_points). `min_points`, `points_multiplier`, `perks`, `color` and `icon_url`
  are not in that response, so neither the vanilla tab nor the new view can show or prefill them
  from the list (the vanilla tab rendered `undefined`). The new editor sends only changed fields
  on edit so unseen values are preserved. A read-only list including the full row would fix this
  on the server side; no server change was made in this wave.
- `POST /api/admin/program` replaces `program_json` (preserving POS/external/briefing keys
  server-side). The limits view spreads the stored configuration before applying its fields so the
  earning rule, lifecycle and campaign rules survive. There is no concurrency version on this
  endpoint; the vanilla tab had the same limitation.
- `GET /api/admin/challenges` lists only challenges that are active and currently running; a
  challenge created with a future start appears once it starts. The view says so.
- `web/merchant/tests/navigation-browser.spec.mjs` (one of the `merchant-browser-gate` runners) was
  already failing at the baseline commit: it looks for the former demo welcome button
  ("Explorar todas las funciones") and former group labels. The unit test
  `merchant-navigation.test.js` was also stale (expected five daily items and four groups) and was
  updated to the current navigation plus the new pages.

## Wave 15a (2026-11-25): analytics suite ported to the merchant app

Owner decision: retire the vanilla dashboard and converge on the merchant app. This wave ports the
analytics half of the remaining vanilla-only capabilities (the operations/ledger/audit half is a
separate wave). No server change; every view keeps the `analytics` plan gate the vanilla tab used
(`pageFeatures` hides the menu entries, `OwnerRestricted` renders without sending a request).

| View | Route | Vanilla capability | Endpoints |
| --- | --- | --- | --- |
| `OwnerAnalytics.tsx` | `#analitica` (Avanzado; also "Informes detallados" in the sidebar and the demo menu) | Executive summary (`renderExecutiveSummary`: narrative, KPI tiles, suggested actions), summary tiles, growth radar and smart alert (folded into the narrative and suggestions), RFM distribution, 30-day revenue trend, branch performance + branch comparison table (one table, "Filtrar" drill-down), branch-vs-global benchmark, cohort retention, churn list, "Reporte ROI" (shown as a factual 30/60/90-day comparison, no ROI claim), IVA CSV export | `GET /api/admin/analytics/dashboard[?branch_id]` (twice when a branch is filtered, for the benchmark), `GET /api/admin/analytics/churn-risk?limit=10[&branch_id]`, `GET /api/admin/analytics/cohorts?months=12`, `GET /api/admin/roi?days=30\|60\|90`, `GET /api/admin/branches`, `GET /api/admin/billing/iva.csv?from&to` |
| `OwnerRewardRedemptions.tsx` | `#canjes-por-recompensa` (Avanzado) | Rewards tab "Ver canje" + "Ledger de canjes" (now every one of the latest 20 redemptions, with the server's consistency flag, and the detail of any of them) | `GET /api/admin/rewards`, `GET /api/admin/analytics/rewards/:id/redemptions`, `GET /api/admin/analytics/redemptions/:id` |

Shared derivation code lives in `owner-analytics-model.ts` (executive metrics, narrative,
suggestions, RFM order, trend/benchmark rows, cohort pivot, redemption consistency, IVA CSV split
and download-name parsing); demo fixtures in `demo-owner-analytics.ts` reuse the Overview preview's
daily series so both screens agree. The CSV download fetches with the session cookie and honours
the server's `Content-Disposition` name; the preview generates the same file locally.

Observations for the owner (no server change made):

- The vanilla cohort card read `cohort_month`/`m1`/`m2`/`m3`, fields the cohorts endpoint never
  returns (it returns one row per cohort and month offset: `cohort_name`, `cohort_size`,
  `month_number`, `retention_rate`). The new matrix reads the real shape. The endpoint also reports
  0 % for months that have not started yet; the view shows those as pending.
- `/api/admin/roi` never returns `roi_ratio`; the vanilla "ROI" tile therefore always fell back to
  the redemption rate. The new view labels that figure as what it is (canjes por cada 100 compras)
  and the definitions say rentabilidad and retorno are not calculated. Its "Tasa repetición" is
  active customers over the base, now labelled so.
- `/api/admin/roi` and `/api/admin/billing/iva.csv` are owner-only on the server but not behind the
  `analytics` plan feature; the merchant app keeps them inside the analytics page, as the vanilla tab
  did. Moving the IVA export to Reportes (every plan) would be a one-line UI change.
- The real IVA CSV's `fecha` column is the DATE serialised as an ISO timestamp
  (`2026-11-10T06:00:00.000Z`); a `to_char(..., 'YYYY-MM-DD')` on the server would make it a plain date.
- The vanilla narrative also counted open operational alerts (`/api/admin/alerts`); that reading
  belongs to the operations wave and is not repeated here.
