# Self-serve 14-day trial, published prices and subscription billing (design of record)

Owner decisions of 25 November 2026, turned into a design buildable in waves on the website-first
cadence (`AGENTS.md`): website, browser owner app and server only; no native release, and every
API change is additive so installed apps keep working. Every "current state" claim was verified
against the code on 2026-11-25 with file paths for re-verification; vendor facts carry the URL
they were read from, and anything not read from a primary source is marked "not verified".

## 1. Decisions

| Topic | Decision (owner, 2026-11-25) | Design consequence |
| --- | --- | --- |
| Prices | USD 39 / 79 / 129 per branch per month for Conecta / Impulsa / Expande (`EMPRENDEDOR` / `NEGOCIO` / `EMPRESA` in code) | `/precios` publishes real prices; the "en revisión" copy and the quotation-only catalog go away |
| Local currency on `/precios` | GTQ shown as a converted reference only if the product already has a regional currency mechanism | The product has **no FX mechanism** (`public/regional-catalog.js` header: "Operational currencies; no FX conversion"; `assertRegionAmount` rejects any other currency). GTQ reference is therefore off by default; see §6 for the platform-set dated reference rate option |
| Trial | 14 days, no card, Conecta features, open to anyone passing Turnstile + phone OTP | New public signup flow; trial state on `businesses` |
| End of trial | Soft lock at day 14: owner app read-only with an upgrade call to action; customers' cards keep working read-only | New entitlement middleware for owner/staff mutations; customer and public endpoints untouched |
| Retention | Data kept 30 days after the lock, then the existing deletion/retention rules | There is no existing business-deletion rule (§3.6); a purge job must be built and is gated behind a dry run |
| Billing | Adapter interface; Recurrente first (GTQ cards, recurring), Stripe later for USD customers; nothing wired today | `src/app/services/billing/` with a provider contract; Recurrente mapping verified against its docs; Stripe sketched |

Decisions added on 2026-11-26 (owner):

| Topic | Decision (owner, 2026-11-26) | Design consequence |
| --- | --- | --- |
| GTQ list prices | Conecta **Q300**, Impulsa **Q630**, Expande **Q1,030** per branch per month (USD × 8 rounded to a round number; USD stays 39 / 79 / 129) | `PLAN_PRICING_GTQ` in `src/utils/plan.js` is the code default of `billing_catalog.gtq`; the super console may still override it; `PROVISIONAL_PRICING_GTQ` (149 / 399 / 999) is retired and `pricing_gtq` comes from the catalog |
| Currency per customer | Guatemalan businesses pay GTQ through Recurrente; businesses outside Guatemala pay USD (Recurrente today, Stripe later) | `businessPaysInGtq` / `defaultCurrency` in `subscription-service.js` (§6); `GET /api/admin/billing` `catalog.currency` follows the rule; the catalog sync creates six products |
| IVA | The published amounts, USD and GTQ, include IVA (12%) | `iva_included: true` on the catalog and the public payload (`tax`); every "sin impuestos / se confirman por escrito" copy is replaced by "Precios con IVA incluido. El comprobante fiscal (FEL) lo emite Recurrente por cada cobro." |
| `/precios` presentation | Lead with the quetzal price for the Guatemalan audience and keep USD alongside ("Q300 al mes por sucursal", "USD 39 fuera de Guatemala") | `pricing.monthly` stays USD for compatibility, `pricing.gtq_monthly` is added; the dated FX reference is no longer rendered (a fixed list price needs no conversion) |

Still open (see §12): Recurrente account/KYC status, refund policy, Stripe availability for a
Guatemalan entity, how USD charges to non-GT customers are documented for SAT.

## 2. Current state (verified)

### 2.1 Onboarding

- `public/admin.html` + `public/admin.js` are served at `/crear-negocio/`
  (`src/middleware/spanish-web.js`, `documents` map). The page is labelled "Uso interno" / "Alta
  interna de negocio" and asks for business name, owner email, optional phone, password,
  category and a points rule, then `POST /api/admin/signup`.
- `src/app/routes/admin/signup.js`: `strictRateLimit` (5 requests / 15 min per IP,
  `src/middleware/rate-limit.js:249`) and `rateLimitByPhone(3, 10 min)`; an optional shared
  secret `SIGNUP_CAPTCHA_SECRET` compared against header `x-signup-captcha` (this is **not**
  Turnstile); then `createBusinessWithOwner(...)` and an owner staff cookie (`signStaffToken`,
  role `OWNER`). The route carries no `csrfProtect`.
- `src/app/services/business-service.js` `createBusinessWithOwner`: plan defaults to
  `config.DEFAULT_PLAN ?? "EMPRENDEDOR"`; inside one transaction it pre-sets the tenant GUC (RLS
  on `businesses` only allows `INSERT` without context), creates the business, a `Principal`
  branch (`${slug}-main`), the OWNER staff user and up to `planLimits(plan).rewards` seeded
  rewards by category; then tiers, achievements, RFM segments and referral defaults run as
  best-effort hooks. No program rule is defaulted: the owner picks a model later ("Elige",
  `PROGRAM_NOT_CONFIGURED` guard in `src/app/services/transaction-rule-evidence.js:187`).
- Two other creation paths exist: `POST /api/public/business/register` (`handleBusinessRegister`
  in `src/app/routes/public-routes.js`, optional `REGISTRATION_API_KEY`,
  `businessRegisterSchema` in `src/utils/schemas.js`) and the super console `POST
  /api/super/businesses` (`createSuperBusiness` in `src/app/routes/super-support.js`, accepts
  `plan`).

### 2.2 Plans, caps and gating

- `src/utils/plan.js`: `PLAN_ORDER = ["EMPRENDEDOR","NEGOCIO","EMPRESA"]`; `PLAN_LIMITS` active
  customers 300 / 2000 / 999999 (soft), branches 1 / 3 / 9999, rewards 5 / 9999 / 9999;
  `DEFAULT_PLAN_FEATURES`; `PLAN_PRICING_GTQ` 149 / 399 / 999 monthly (provisional, consumed
  only by `public/super/plans.js` and pinned as withheld by `tests/unit/public-plans.test.js`;
  since 2026-11-26 the same constant holds the decided list prices 300 / 630 / 1,030 and the
  provisional figures are gone, see §1); `PLAN_MESSAGING_GTQ`.
- Display names Conecta / Impulsa / Expande live in `src/app/services/public-plan-service.js`
  (`PLAN_DISPLAY_NAMES`); the owner app footer still prints the raw code (`Plan
  ${plan.data.plan}`, `web/merchant/src/main.jsx:359-361`).
- Overrides: `platform_settings.plan_features` read by `PlatformSettingsRepo.getPlanFeatures()`
  in its own platform-admin transaction and merged by `mergePlanFeatures`; edited through `PUT
  /api/super/plans/:plan/features`.
- Enforcement: `requirePlanFeature(feature)` (`src/middleware/plan-feature.js`) answers `403
  PLAN_FEATURE_LOCKED` with `suggested_plan`. The branch cap is hard
  (`src/app/routes/admin/branches.js:60-61`, "Plan limit: branches"); the active-customer cap is
  soft and only surfaced as headroom (`GET /api/admin/plan` returns `usage.active_customers`;
  `OwnerReports.planUsage` renders it with a "Ver planes" link to `/precios`).
  `isActiveCustomer` = visit or signup within 90 days.
- Plan changes: `PUT /api/super/businesses/:businessId/plan` → `BusinessRepo.updatePlan`
  (`UPDATE businesses SET plan=$2`) with `logSuperAudit("super.plan.update")`; the super console
  card (`public/super/business-card.js`) has the plan select.

### 2.3 Billing today

- `billing_events` (`src/app/migrations/2026-02-27-tenant-billing.sql`) is a **usage** ledger
  (`event_type`, `amount`, `unit`, `metadata`) written by `emitBillingEvent` from
  `webhook-service.js` and `messaging-service.js` and read by `GET /api/admin/billing/events`.
  It is not a subscription table; the new tables use other names to avoid colliding with it.
- `GET /api/admin/billing/iva.csv` (`src/app/routes/admin/billing.js`) aggregates the merchant's
  own `transactions` per day and splits the IVA-inclusive gross with `money.js` (`base = bruto /
  1.12`). It concerns the merchant's sales, not PF's subscription; `docs/FACTURACION_GT.md`
  leaves official invoicing to the merchant's accountant.
- Pricing docs: `docs/PRICING_ES.md` (USD 39/79/129 per branch, 10-15% annual discount idea),
  `docs/PRICING_GUATEMALA.md` (GTQ 149/399/999 "sin IVA"), `docs/product/pricing-usd-planning.md`
  (publish intentional local prices; never derive them from spot FX; date any FX input).
- `/precios`: `src/middleware/public-plans.js` reads `public/precios.html` and replaces
  `<!--PLAN_COMPARISON-->` with `renderPlanComparison(publicPlanCatalog(listPlans()))`. The
  catalog reports `pricing_status: "quotation"`, the table ends with "Según cotización" and
  "Solicitar cotización" → `/#contacto`, and the page says "Los precios están en revisión…".
  `tests/unit/public-plans.test.js` pins `quotation`, `Solicitar cotización` and the absence of
  `Q149|Q399|Q999|gratis|ilimitad`.

### 2.4 Turnstile and contact

- `verifyTurnstile(token, remoteip)` in `src/app/services/contact-service.js` posts to
  `https://challenges.cloudflare.com/turnstile/v0/siteverify`; it returns `true` when
  `CONTACT_TURNSTILE_SECRET` is empty (dev). Production start requires
  `CONTACT_TURNSTILE_SITE_KEY` when the secret is set (`src/config/index.js:456`).
- Used by `POST /api/public/contact` (`ContactSchema.turnstileToken`, `strictRateLimit`) and
  support cases (`src/app/routes/support-case-routes.js`, which also exposes the site key at
  `GET /api/public/support/config`). The landing page embeds the widget (`public/index.html`,
  `.cf-turnstile`, `public/index.js` `ensureTurnstileScript()`), and the CSP already allows
  `https://challenges.cloudflare.com` (`src/app/server.js:98-112`).
- `sendContactEmail` uses a dedicated relay (`CONTACT_SMTP_HOST`, port 26, opportunistic
  STARTTLS) to `CONTACT_TO`.

### 2.5 Phone OTP (two implementations)

- Tenant-scoped: `verify_codes` (`business_id NOT NULL`, `code_hash`, `failed_attempts`,
  `blocked_until`) driven by `customer-service.js` (`requestJoinCodeWithDeps`,
  `verifyJoinCodeWithDeps`): `random6()`, bcrypt, 10-minute expiry, 1 request / 60 s and 5 /
  hour per business+phone, advisory lock, delivery through `sendMessage({ channel: "verify" })`.
- Platform-wide, phone only: `mobile_access_codes` + `mobile_access_grants`
  (`src/app/migrations/2026-11-10-mobile-access.sql`; RLS `platform_auth_only`, phone `CHECK
  (phone ~ '^[0-9]{8,15}$')`, `attempts BETWEEN 0 AND 5`, one active code per phone) driven by
  `createMobileAccessService` (`src/app/services/mobile-access-service.js`): `requestCode` (1 /
  min, 5 / hour per phone, fixed SMS body enforced by `app.security_message_log_create`) and
  `verify` (5-minute grant token). Having no tenant, this is the piece to reuse for **owner**
  phone verification.
- Browser module `public/customer-auth-entry.js` already implements request-code → verify with a
  resend cooldown, wired to the customer join/login endpoints.

### 2.6 Email and scheduler

- Transactional email: `createSmtpProvider`
  (`src/app/services/messaging/providers/smtp-provider.js`, `SMTP_HOST`/`SMTP_FROM`,
  `strictAcceptance`), used directly by `owner-brief-email-service.js`. Templates:
  `renderBaseEmailTemplate`, `renderVerifyEmail`, `renderLifecycleEmail`, `renderSecurityEmail`,
  `renderChurnEmail` under `src/app/services/messaging/email-templates/` with PF branding from
  `email-branding.js`.
- `src/app/scheduler.js`: a single registry (`periodicJobs`, `dailySteps`, `startupTasks`) with
  roles `api`/`worker`; the daily cron is `0 ${CHURN_SEND_HOUR_LOCAL} * * *` in `CRON_TZ`
  (America/Guatemala). Names are pinned by `tests/unit/scheduler-registry.test.js`.
  `runLifecycleOnce` shows the per-business iteration idiom (platform context to list ids, then
  a tenant context per business). `weekly_owner_briefs` (`UNIQUE(business_id, period_start)`,
  status, attempts, lease) is the idempotent-send pattern to copy for trial emails.

### 2.7 Owner app, super console, deletion

- Mantine owner app (`web/merchant/src/main.jsx`) loads `useResource("/api/admin/plan")` once
  and passes `features`, `limits`, `plan`, `usage` to every page (`OwnerPageProps`,
  `web/merchant/src/owner-workspace.tsx`). `OwnerRestricted` is the plan-locked placeholder.
  `web/merchant/src/api.js` redirects to login on 401. `AdminPlanResponse` is typed in
  `src/types/http-dto.ts`.
- Super console: `public/super/businesses.js` lists `GET /api/super/businesses?limit=200`;
  `business-card.js` changes plan and impersonates.
- Deletion: customers can self-delete (`DELETE /api/customer/me` → `CustomerRepo.softDelete`,
  `customers.deleted_at`). There is **no** business deletion, archive or purge path anywhere in
  `src/` (grep for `DELETE FROM businesses`, `deleteBusiness`, `archiveBusiness` returns
  nothing). `businesses` has no `deleted_at`.
- Native app: `apps/customer/src` never reads `plan`; customer/mobile routes use
  `requirePlanFeature` in three places in `customer-routes.js` only.

## 3. Data model

All changes are additive, applied as managed migrations under `src/app/migrations/` (dated
filename, never edited after apply, pinned with `npm run ops:migrate:lock`; production applies
them explicitly with `ops:migrate`). RLS follows the `2026-11-23-owner-progress.sql` pattern for
tenant tables and the `2026-11-10-mobile-access.sql` pattern (`platform_auth_only`) for
platform-only tables.

### 3.1 `businesses` (migration `2026-11-26-a-trial-state.sql`)

```sql
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS signup_source TEXT NOT NULL DEFAULT 'internal'
    CHECK (signup_source IN ('internal','self_serve','super','api')),
  ADD COLUMN IF NOT EXISTS trial_status TEXT NOT NULL DEFAULT 'none'
    CHECK (trial_status IN ('none','active','expired','converted')),
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_phone TEXT CHECK (trial_phone IS NULL OR trial_phone ~ '^[0-9]{8,15}$'),
  ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'none'
    CHECK (billing_status IN ('none','trialing','active','past_due','canceled','locked')),
  ADD COLUMN IF NOT EXISTS billing_currency TEXT CHECK (billing_currency IN ('GTQ','USD')),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ,
  ADD CONSTRAINT businesses_trial_dates CHECK ((trial_status = 'none') = (trial_started_at IS NULL)
    AND (trial_started_at IS NULL) = (trial_ends_at IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS businesses_trial_phone_unique
  ON businesses(trial_phone) WHERE trial_phone IS NOT NULL;                 -- one trial per phone
CREATE INDEX IF NOT EXISTS businesses_trial_due ON businesses(trial_ends_at) WHERE trial_status = 'active';
```

Semantics: `plan` stays the entitlement (`EMPRENDEDOR` during the trial, so every existing
`requirePlanFeature` / `planLimits` check keeps working unchanged). `billing_status` is the
access state: `none` (legacy businesses created before this change, never restricted),
`trialing`, `locked` (soft lock), `active`, `past_due`, `canceled`. `trial_status` records
history for measurement. `purge_after = trial_ends_at + 30 days` is set when the lock happens
and cleared on conversion. `BusinessRepo.getById` selects `*`, so the new columns flow into
`business` rows; the `business_public` view used by `getPublicBySlug` must **not** be extended,
so nothing about billing leaks to customers.

### 3.2 Phone proof for signup (`2026-11-26-b-trial-phone-grants.sql`)

Reuse `mobile_access_codes` for the code itself (same table, same service) and add a sibling
grant table so a customer-card grant can never be replayed as a signup grant:

```sql
CREATE TABLE IF NOT EXISTS trial_phone_grants (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  phone TEXT NOT NULL CHECK (phone ~ '^[0-9]{8,15}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
-- RLS: platform_auth_only, REVOKE ALL FROM PUBLIC, GRANT to loyalty/puntos_app/loyalty_app
```

### 3.3 Provider-agnostic billing (`2026-11-26-c-billing-subscriptions.sql`)

```sql
CREATE TABLE IF NOT EXISTS billing_customers (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('recurrente','stripe','manual')),
  provider_customer_id TEXT NOT NULL, email TEXT NOT NULL, tax_id TEXT, tax_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, provider), UNIQUE (provider, provider_customer_id));
CREATE TABLE IF NOT EXISTS billing_checkouts (
  id UUID PRIMARY KEY, business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, provider_checkout_id TEXT NOT NULL, plan TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 9),
  currency TEXT NOT NULL CHECK (currency IN ('GTQ','USD')),
  unit_amount_minor INTEGER NOT NULL CHECK (unit_amount_minor > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','expired','abandoned')),
  checkout_url TEXT NOT NULL, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_checkout_id));
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id UUID PRIMARY KEY, business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, provider_subscription_id TEXT NOT NULL,
  checkout_id UUID REFERENCES billing_checkouts(id) ON DELETE SET NULL,
  plan TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity >= 1),
  currency TEXT NOT NULL CHECK (currency IN ('GTQ','USD')), unit_amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','past_due','paused','canceled')),
  current_period_start TIMESTAMPTZ, current_period_end TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ, canceled_at TIMESTAMPTZ, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subscription_id));
CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_one_active
  ON billing_subscriptions(business_id) WHERE status IN ('active','past_due','paused');
-- Tenant RLS on the three tables above: USING (app.is_platform_admin() OR business_id = app.current_tenant())
-- WITH CHECK (app.is_platform_admin()); the owner reads its rows, only platform code writes.
CREATE TABLE IF NOT EXISTS billing_provider_events (
  id UUID PRIMARY KEY, provider TEXT NOT NULL, provider_event_id TEXT NOT NULL, -- svix-id / Stripe evt_
  event_type TEXT NOT NULL, business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  subscription_id UUID REFERENCES billing_subscriptions(id) ON DELETE SET NULL,
  live_mode BOOLEAN NOT NULL, payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(), processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','ignored','failed')),
  error TEXT, UNIQUE (provider, provider_event_id));          -- idempotent ingestion; RLS platform_auth_only
CREATE TABLE IF NOT EXISTS trial_notifications (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('welcome','day10','day13','locked','purge7','purged')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(), destination TEXT NOT NULL, provider_id TEXT,
  PRIMARY KEY (business_id, kind));                            -- each reminder once
```

Why `billing_provider_events` and not `billing_events`: the existing table is a per-tenant usage
ledger with a different shape and RLS; webhook events arrive before a tenant is known and must
be deduplicated by provider id.

### 3.4 Platform settings

One jsonb document `platform_settings.billing_catalog`, edited from the super console:
`{ "published_at", "usd": { "EMPRENDEDOR": 39, "NEGOCIO": 79, "EMPRESA": 129 }, "gtq": { … | null },
"gtq_reference": { "rate", "as_of" } | null, "providers": { "recurrente": { "price_ids": { "GTQ": {},
"USD": {} } }, "stripe": { "price_ids": { "USD": {} } } } }`. `src/utils/plan.js` gains
`PLAN_PRICING_USD` (39/79/129, `per: "branch_month"`) as the code default; `PLAN_PRICING_GTQ` is
renamed `PROVISIONAL_PRICING_GTQ` and kept only for the super console until the GTQ amounts are
decided (§12). **2026-11-26:** the amounts are decided; `PLAN_PRICING_GTQ` (300 / 630 / 1,030)
is the code default of `gtq`, the normalizer falls back to it (never null) and the document
carries `iva_included: true`; `PROVISIONAL_PRICING_GTQ` is deleted.

### 3.5 Config keys (`src/config/index.js`)

`TRIAL_DAYS` (14), `TRIAL_RETENTION_DAYS` (30), `TRIAL_OTP_DAILY_CAP` (platform circuit breaker,
e.g. 200), `TRIAL_ALLOWED_DIAL_CODES` (default `502`), `BILLING_PROVIDER_DEFAULT` (`recurrente`),
`RECURRENTE_SECRET_KEY`, `RECURRENTE_WEBHOOK_SECRET`, `RECURRENTE_LIVE`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`; all read through `envValue` so `_FILE` secrets work.

### 3.6 Retention and deletion

The owner's "existing deletion/retention rules" do not exist for businesses (§2.7). Child tables
created since February reference `businesses(id) ON DELETE CASCADE` (verified for `branches`,
`staff_users`, `verify_codes`, `billing_events`, `owner_progress_*`, `weekly_owner_briefs`), but
`message_logs.business_id` is nullable and older tables must be audited before any `DELETE FROM
businesses`. The purge therefore ships as: (1) `purge_after` and a super-console list in wave 1;
(2) a `trial.purge` daily step in **dry-run** mode (lists what it would delete, counts rows per
child table) for at least a week; (3) hard delete in a platform-context transaction only after
the owner reviews the dry run and the cascade audit (wave 1b), with wallet passes voided through
the `native-wallet` runtime first.

## 4. Flows

### 4.1 Self-serve signup (wave 1)

New page `public/prueba.html` + `public/prueba.js`, served at `/prueba/` through the
`spanish-web.js` documents map (`/crear-negocio/` stays the internal page). Steps:

1. **Datos**: nombre del negocio, correo, contraseña (`isStrongPassword` /
   `passwordRequirementsText` from `public/lib.js`), categoría. No points rule here; the owner
   chooses it in the app ("Elige").
2. **Teléfono**: `POST /api/public/trial/request-code` `{ phone, turnstileToken }` →
   `verifyTurnstile` (fail closed in production), `strictRateLimit` per IP, `rateLimitByPhone(3,
   10 min)`, dial-code allowlist, the shared phone-proof service (§2.5) and the platform daily
   cap. `POST /api/public/trial/verify` `{ phone, code }` → `trial_phone_grants` token (5
   minutes, single use). The UI reuses the request/verify/resend-cooldown logic of
   `public/customer-auth-entry.js` (extract the countdown helper rather than copy it).
3. **Crear**: `POST /api/public/trial/signup` `{ grant, businessName, email, password, category,
   turnstileToken }` → consume the grant, check `businesses_trial_phone_unique` and
   `businesses.email UNIQUE` (409 with the Spanish copy `createBusinessWithOwner` already uses),
   then `createBusinessWithOwner({ plan: "EMPRENDEDOR", signup: { source: "self_serve",
   trial_phone, trial_days: 14 } })`, which sets `trial_status='active'`,
   `billing_status='trialing'`, `trial_started_at=now()`, `trial_ends_at=now()+14d` and
   `phone=trial_phone`. Auto-login cookie as in `/api/admin/signup`; redirect to `/negocio/`,
   where the existing launch path ("Tu progreso": rules → card → practice → team → live) takes
   over.
4. `trial_notifications.welcome` email (§7.5) with the join link and the trial end date.

`/api/admin/signup` keeps working for the owner's own use and records
`signup_source='internal'`, `trial_status='none'` (never locked).

### 4.2 Trial lifecycle (daily step `trial.daily`, worker + api like `lifecycle.daily`)

Registered in `dailySteps` after `lifecycle.daily`; `tests/unit/scheduler-registry.test.js` is
updated. Each run, in a platform context, selects due businesses and then works per tenant
(`withDbClientContext({ tenantId })`) like `runLifecycleOnce`:

| Day (local, `CRON_TZ`) | Condition | Action | Idempotency |
| --- | --- | --- | --- |
| 10 | `trial_status='active' AND trial_ends_at - now() <= 4 days` | email `day10` | `trial_notifications(business_id,'day10')` |
| 13 | `trial_ends_at - now() <= 1 day` | email `day13` | same, `day13` |
| 14 | `now() >= trial_ends_at` | `billing_status='locked'`, `trial_status='expired'`, `locked_at=now()`, `purge_after=now()+30d`; email `locked` | state transition is a `WHERE billing_status='trialing'` update |
| 37 | `purge_after - now() <= 7 days` | email `purge7` | `purge7` |
| 44 | `now() >= purge_after AND billing_status='locked'` | `trial.purge` (dry run until enabled, §3.6) | row deleted |

Emails go through `createSmtpProvider` with PF branding (`email-branding.js` defaults),
`strictAcceptance: true`; a failed send is retried the next day because the notification row is
only written on acceptance. The owner-brief weekly email already uses this provider, so delivery
configuration is shared.

### 4.3 Soft lock (day 14)

Entitlement middleware `requireActiveBilling` (`src/middleware/billing-status.js`), mounted on
**mutating** owner and staff routes (POST/PUT/PATCH/DELETE under `/api/admin/*`, `/api/staff/*`,
POS award and redemption endpoints) after `requireStaff`. It reads the business once
(`req._resolvedBusiness`, the same cache `requirePlanFeature` uses) and answers `402` with `{
code: "TRIAL_EXPIRED", trial_ends_at, purge_after, upgrade_url: "/negocio/#plan" }` when
`billing_status IN ('locked')`. Reads keep working, so the owner can see reports, customers and
export data. Explicit exceptions that stay writable while locked: `/api/admin/billing/checkout`
(upgrade), `/api/admin/customers/export`, session/logout/MFA routes, support cases.

Customer-facing behaviour ("cards keep working read-only"): `/api/public/*`, `/api/customer/*`,
`/api/mobile/*` and wallet pass rendering are **not** gated; balances, history and passes remain
visible. Awarding points and redeeming rewards are staff mutations and are blocked by the
middleware above, so no new points are earned during the lock. Lifecycle automations and
campaigns skip locked businesses (`runLifecycleOnce` and `marketing.tick` check
`billing_status`), so no messages are sent on behalf of a locked trial.

### 4.4 Upgrade (wave 2)

1. Owner opens "Plan y facturación" (`OwnerPlan`), picks Conecta/Impulsa/Expande; the page shows
   `quantity = countBranches(business)` (min 1) and the monthly total.
2. `POST /api/admin/billing/checkout` `{ plan, currency }` (owner only, `csrfProtect`,
   idempotent per `(business_id, plan, quantity, currency)` while an `open` checkout exists).
   The service resolves the provider (`GTQ → recurrente`; `USD → stripe` when available, else
   `recurrente`), calls `createCustomer` if no `billing_customers` row exists, then
   `createCheckout`, stores `billing_checkouts` and returns `checkout_url`.
3. Owner pays on the hosted page. `success_url` returns to `/negocio/#plan?checkout=<id>`, which
   polls `GET /api/admin/billing/subscription` ("Confirmando pago…") until the webhook lands. The
   redirect itself never activates anything.
4. Webhook `POST /api/public/billing/webhooks/:provider` (no `csrfProtect`; raw body from
   `req.rawBody`, which `express.json` already keeps): `verifyWebhook` → insert
   `billing_provider_events` (duplicate `provider_event_id` → 200 and stop) → `parseEvent` →
   match `metadata.business_id`/`checkout_id` to `billing_checkouts` and compare `currency`,
   `quantity`, `unit_amount_minor`, `live_mode` → on `subscription_created`/`payment_succeeded`:
   upsert `billing_subscriptions`, `UPDATE businesses SET plan=$plan, billing_status='active',
   trial_status='converted', billing_currency=$cur, locked_at=NULL, purge_after=NULL`,
   `emitBillingEvent("subscription.activated")`, email `activada`. All inside `withTransaction`
   under a platform context; the handler answers 2xx quickly and emails go to `background_jobs`.
5. Renewals: `payment_succeeded` updates `current_period_*`; `payment_failed` /
   `subscription_past_due` set `billing_status='past_due'` (§4.6); `subscription_canceled` sets
   `billing_status='canceled'` and schedules the lock at `current_period_end` (paid access
   continues until then).

### 4.5 Cancel and downgrade

- Cancel: `POST /api/admin/billing/cancel` → `cancelAtPeriodEnd(subscription)`; access continues
  until `current_period_end`, then the daily step locks the business like an expired trial (same
  read-only screen, `purge_after = period_end + 30 days`). Immediate cancel is a super-console
  action only.
- Downgrade (Expande → Impulsa, or fewer branches): applied at the next cycle
  (`changeQuantity`/`changePlan` with `mode: "next_cycle"`); the owner must first bring branches
  and features under the target plan's limits (existing `planLimits`), the UI explains what will
  be disabled.
- Upgrade or added branch: applied now with proration (`mode: "now_and_charge"`). Adding a
  branch in `POST /api/admin/branches` on a paid plan triggers `changeQuantity(+1)`; if the
  provider call fails the branch is not created.

### 4.6 Grace

`past_due` keeps full access for 7 days from the first failed charge while the provider retries
(Recurrente: up to 15 attempts, §5.2). On day 7 the business is locked (`billing_status='locked'`,
`trial_status` unchanged) with a `pago_pendiente` email; a later `payment_succeeded` unlocks it.
After the provider's final cancellation (`subscription_canceled`, `reason: payment_failed`) the
retention clock starts.

## 5. Billing adapter

### 5.1 Interface (`src/app/services/billing/provider.js`)

```js
/** @typedef {"recurrente"|"stripe"|"manual"} ProviderName */
/** @typedef {{ provider: ProviderName, providerCustomerId: string }} BillingCustomerRef */
/** @typedef {{ providerSubscriptionId: string, status: "active"|"past_due"|"paused"|"canceled", plan: string,
 *   quantity: number, currency: "GTQ"|"USD", unitAmountMinor: number, currentPeriodStart: string|null,
 *   currentPeriodEnd: string|null, cancelAt: string|null, metadata: Record<string,string> }} SubscriptionSnapshot */
/** @typedef {{ id: string, liveMode: boolean, occurredAt: string, metadata: Record<string,string>, raw: unknown,
 *   type: "checkout_completed"|"subscription_created"|"payment_succeeded"|"payment_failed"|"subscription_past_due"
 *       |"subscription_updated"|"subscription_canceled"|"refund_created"|"dispute_opened"|"ignored",
 *   providerSubscriptionId?: string, providerCheckoutId?: string, providerCustomerId?: string,
 *   amountMinor?: number, currency?: "GTQ"|"USD", feeMinor?: number, taxInvoiceUrl?: string|null }} BillingEvent */
/**
 * @typedef {object} BillingProvider
 * @property {ProviderName} name
 * @property {(input: { businessId: string, email: string, name: string, phone?: string|null, taxId?: string|null }) => Promise<BillingCustomerRef>} createCustomer
 * @property {(input: { customer: BillingCustomerRef, plan: string, quantity: number, currency: "GTQ"|"USD", successUrl: string,
 *   cancelUrl: string, metadata: Record<string,string>, idempotencyKey: string })
 *   => Promise<{ providerCheckoutId: string, url: string, expiresAt: string|null, unitAmountMinor: number }>} createCheckout
 * @property {(input: { rawBody: string, headers: Record<string,string|undefined> }) => Promise<boolean>} verifyWebhook
 * @property {(rawBody: string) => BillingEvent} parseEvent
 * @property {(providerSubscriptionId: string) => Promise<SubscriptionSnapshot>} fetchSubscription
 * @property {(providerSubscriptionId: string, input: { quantity?: number, plan?: string, mode: "now_and_charge"|"next_cycle" }) => Promise<SubscriptionSnapshot>} changeSubscription
 * @property {(providerSubscriptionId: string, input: { atPeriodEnd: boolean, reason?: string }) => Promise<SubscriptionSnapshot>} cancel
 */
```

`subscription-service.js` owns the orchestration (§4.4) and is provider-agnostic; providers are
pure HTTP mappers with injected `fetch` and `config`, unit-tested with recorded payloads
(`tests/fixtures/billing/*.json`).

### 5.2 Recurrente mapping (verified against docs.recurrente.com on 2026-11-25)

| Concern | Recurrente fact | Source |
| --- | --- | --- |
| Base URL and auth | `https://app.recurrente.com/api`; header `X-SECRET-KEY`; `sk_live_*` on the live account, `sk_test_*` only inside a Sandbox; same base URL for both; `GET /api/test` returns `environment` and `sandbox_id` | https://docs.recurrente.com/guides-english/getting-started/authentication |
| Catalog | `POST /api/products` with `product.prices_attributes[]` (max **one** price per product): `amount_in_cents`, `currency` `GTQ`\|`USD`, `charge_type: "recurring"`, `billing_interval: "month"`, `tax_category` `good`\|`service` (FEL). "Changing the price of an active subscription is not possible via API" | https://docs.recurrente.com/referencia-api/api-reference/products/create-product ; https://docs.recurrente.com/guides-english/guides/subscription-billing-options |
| `createCustomer` | `POST /api/customers` `{ email (required), full_name, phone, nit, metadata }` → `cus_…` | https://docs.recurrente.com/referencia-api/api-reference/customers/create-customer |
| `createCheckout` | `POST /api/checkouts` `{ items: [{ price_id, quantity }], customer_id, success_url, cancel_url, metadata, expires_at }`, header `Idempotency-Key` (24 h replay); `quantity` 1–9 on a recurring line = units of **one** subscription ("unit amount is multiplied by the quantity"); two recurring lines in one checkout are not supported; response has `id`, `status` (`unpaid`\|`paid`\|`payment_in_progress`\|`expired`), `checkout_url`, `currency`, `live_mode` | https://docs.recurrente.com/referencia-api/api-reference/checkouts/create-checkout ; subscription-billing-options (Multiple units) |
| Minimums | Checkout total ≥ 500 cents GTQ (Q5) or 100 cents USD | checkouts reference; introduction |
| `fetchSubscription` | `GET /api/subscriptions/{id}`: `status` `active`\|`paused`\|`past_due`\|`cancelled`, `current_period_start/end`, `next_payment_attempt_at`, `payment_retries`, `items[].quantity`, `metadata` | https://docs.recurrente.com/referencia-api/api-reference/subscriptions/cancel-subscription (response schema) |
| `changeSubscription` | `PUT /api/subscriptions/{id}`: change payment method, pause/unpause, `cancel_at_period_end`, `cancel_at`, or modify `items` with `mode: "next_cycle"` (adds the proration to the next charge) or `"now_and_charge"` (charges the proration immediately); `POST /subscriptions/{id}/proration_preview` previews | https://docs.recurrente.com/referencia-api/api-reference/subscriptions/update-subscription |
| `cancel` | `DELETE /api/subscriptions/{id}` cancels now (`prorate: true` is rejected with 422; nothing already paid is refunded; use `POST /refunds`); `PUT … { cancel_at_period_end: true }` ends at `current_period_end` | cancel-subscription; subscription-billing-options (Ending a subscription) |
| Retries | Daily retries, **15 attempts per period** (initial + 14), then automatic cancellation; read `next_payment_attempt_at` | https://docs.recurrente.com/guides-english/getting-started/webhooks |
| Webhooks: registration | Dashboard (Settings → Developers and API → Webhooks) or `POST /api/webhook_endpoints` → `signingSecret` (`whsec_…`), also `GET /api/webhook_endpoints/{id}` | webhooks guide |
| Webhooks: signature | Svix: headers `svix-id`, `svix-timestamp`, `svix-signature` (`v1,` + base64); HMAC-SHA256 over `"${svix-id}.${svix-timestamp}.${rawBody}"` with the base64-decoded part after `whsec_`; constant-time compare; check timestamp freshness; raw body required | webhooks guide |
| Webhooks: retries | Immediately, 1 min, 5 min, 30 min, 2 h, 6 h after non-2xx; may deliver more than once, dedupe by id | webhooks guide |
| Events to map | `intent.succeeded` → `payment_succeeded`; `intent.failed` → `payment_failed`; `subscription.create` → `subscription_created` (emitted together with `intent.succeeded` for recurring products); `subscription.past_due`; `subscription.update`, `subscription.item_added/item_removed` → `subscription_updated`; `subscription.cancel` → `subscription_canceled`; `refund.create` → `refund_created`; `dispute.create/update` → `dispute_opened`; new accounts receive unified `intent.*` only (legacy `payment_intent.*` kept for older accounts) | webhooks guide |
| Payload | Envelope `type`, `event_type`, `status`, `id` (`in_…`), `amount_in_cents`, `currency`, `customer{ id,email,nit,phone }`, `product{ id }`, `checkout{ id,status }`, `tax_invoice_url`, `details.fee`; subscription events carry the checkout `metadata` ("Checkout metadata survives renewals, retries, and cancellation") | webhooks guide; sandboxes guide §4 |
| Sandbox | Isolated tenant with its own TEST key and endpoints; card `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` declines; Test Clocks (`POST /test_clocks`, `…/advance`) simulate renewals, declines and recovery; `POST /test_helpers/webhook_events` emits fixtures | https://docs.recurrente.com/guides-english/guides/sandboxes-and-test-clocks |
| FEL | Automatic invoicing issues a DTE per successful payment at **Q0.25** each after activation with RTU + Agencia Virtual SAT password (or manual `.pfx`); `tax_category` per product; `tax_invoice_url` on the intent; `PUT /api/intents/{id}/tax_invoice` corrects NIT/name and re-issues | https://ayuda.recurrente.com/es/p/como-activar-la-facturacion-automatica-en-recurrente ; https://docs.recurrente.com/referencia-api/api-reference/intents/update-intent-tax-invoice |
| Fees | Online card: **4.5% + Q2** per successful transaction (business account), 5.25% + Q2 personal; bank transfer free; payout in 24 h | https://www.recurrente.com/precios |

Mapping decisions: six Recurrente products (3 plans × GTQ/USD) created once per environment and
stored as `price_ids` in `billing_catalog`; `metadata = { business_id, checkout_id, plan,
quantity, currency }` on every checkout; `billing_info_requirement: "optional"` on every
product (owner decision 2026-11-26: PF does not issue FEL invoices, so no NIT is collected); `success_url`/`cancel_url` point at the owner app.
**To verify in the Sandbox before wave 2 ships**: that a plan change can be done as `items`
remove + add with `now_and_charge` (the docs describe item changes, not a price swap on the same
product); fallback is `cancel_at_period_end` on the old subscription plus a new checkout that
starts at the period end.

### 5.3 Stripe sketch (for USD customers, wave 3)

Verified: `POST /v1/checkout/sessions` with `mode=subscription`, `line_items[0][price]`,
`line_items[0][quantity]`, `customer` or `customer_email`, `success_url`, `cancel_url`,
`client_reference_id`, `metadata`, `subscription_data`, `locale` (`es-419` listed), `expires_at`
30 min–24 h; the response has `url` (https://docs.stripe.com/api/checkout/sessions/create).
Webhooks: `Stripe-Signature` header with a `whsec_` secret over the raw body, 5-minute default
tolerance, exponential-backoff retries for up to three days in live mode, no ordering guarantee,
dedupe by event id; a subscription creation emits `customer.subscription.created`,
`invoice.created`, `invoice.paid`, `charge.created` (https://docs.stripe.com/webhooks). Mapping:
`checkout.session.completed` → `checkout_completed`, `invoice.paid` → `payment_succeeded`,
`invoice.payment_failed` → `payment_failed`, `customer.subscription.updated/deleted` →
`subscription_updated/canceled`; quantity changes via the Subscriptions API with
`proration_behavior`. **Not verified**: whether a Guatemalan entity can open a Stripe account
(https://stripe.com/global refused automated fetches; the owner must check) and the customer
portal. Until then USD customers can be charged through Recurrente, which supports USD prices
and international cards.

## 6. Plan math

- Unit: one **branch** per month. `quantity = BusinessRepo.countBranches(businessId)`, minimum
  1, maximum 9 at checkout (Recurrente's initial-quantity limit; a tenth branch goes through
  `changeSubscription`, to be verified in the Sandbox). The count is taken when the checkout is
  created and re-taken on every branch create/delete.
- Monthly totals: Guatemala (GTQ) Conecta 300 × n, Impulsa 630 × n, Expande 1,030 × n; outside
  Guatemala (USD) Conecta 39 × n, Impulsa 79 × n, Expande 129 × n (owner decision 2026-11-26:
  the quetzal amounts are USD × 8 rounded to a round number, fixed, never converted at charge
  time). Conecta's branch limit is 1 (`PLAN_LIMITS`), so it is always quantity 1 unless the
  limit changes. Annual plans are not offered in v1 (the docs' 10–15% discount idea is deferred).
- Proration: upgrades and added branches charge the prorated remainder now (`now_and_charge`);
  downgrades and removed branches apply next cycle. Neither provider refunds unused time by
  default and Recurrente rejects `prorate: true`.
- Currency and processor (owner decision 2026-11-26): GT customers pay **GTQ through Recurrente**
  at the fixed list amounts stored in `billing_catalog.gtq` (code default `PLAN_PRICING_GTQ`, not
  spot FX, per `docs/product/pricing-usd-planning.md`); customers outside GT pay USD through
  Recurrente today and Stripe when available. The rule lives in `subscription-service.js`
  (`businessPaysInGtq`, `defaultCurrency`): a business is Guatemalan when it already pays in GTQ
  (`billing_currency`), when its regional settings resolve to `America/Guatemala` (the default
  region when none is set), or when its verified trial phone starts with the 502 dial code. Such
  a business checks out in GTQ by default when GTQ is ready (amounts plus Recurrente GTQ price
  ids for every plan); otherwise, and for every other business, USD. The owner can still choose
  the currency explicitly; an explicit GTQ request while GTQ is not ready answers 400
  `BILLING_CURRENCY_UNAVAILABLE`. `GET /api/admin/billing` `catalog.currency` follows the same
  rule (an active subscription keeps its own currency); the super manual activation defaults the
  same way; the catalog sync always creates six Recurrente products (three USD, three GTQ).
  `/precios` leads with the quetzal price and keeps USD alongside; the dated
  `billing_catalog.gtq_reference` stays in the public payload for compatibility but is no
  longer rendered.
- IVA 12% (owner decision 2026-11-26): option (a). The published amounts, USD and GTQ, are
  IVA-inclusive ("Precios con IVA incluido"); the Recurrente DTE is the invoice and breaks out
  `base = total / 1.12` exactly as `src/app/routes/admin/billing.js` does for merchant sales. The
  catalog carries `iva_included: true` (`DEFAULT_BILLING_CATALOG`, the normalizer, the public
  payload as `tax: { iva_included: true, rate: 0.12 }`) so every surface reads one statement.
  USD charges to non-GT customers are an export of services; how they are documented for SAT
  stays with the accountant (§12).
- Processor cost per Recurrente card charge: 4.5% + Q2 (Q15.50 on Q300, 5.2%; no FEL cost because PF does not issue FEL).
  Record the webhook's `details.fee` in `billing_subscriptions.metadata` for margin reporting.

## 7. Surfaces

### 7.1 `/precios` (marketing origin)

- `publicPlanCatalog` returns `pricing_status: "published"`, `pricing: { currency: "USD", per:
  "branch_month", monthly: 39|79|129 }` and optional `reference_gtq`. `renderPlanComparison`
  replaces the "Según cotización" row with "USD 39 por sucursal al mes" etc., adds a "Prueba 14
  días gratis" link to `/prueba/` on the Conecta column (and "Empezar con Impulsa/Expande" links
  that start the same trial and remember the intended plan in `?plan=`), keeps "Hablar con
  nosotros".
- **2026-11-26:** the payload adds `local_currency: "GTQ"`, `tax: { iva_included: true, rate:
  0.12 }` and `pricing.gtq_monthly: 300|630|1030` (`pricing.monthly` stays USD for
  compatibility). The cards and the comparison lead with the quetzal price ("Q300 al mes por
  sucursal") and keep USD alongside ("USD 39 fuera de Guatemala", row "Fuera de Guatemala"); a
  row "Impuestos" says "IVA (12 %) incluido". The dated FX reference is no longer rendered.
- `public/precios.html`: replace the "en revisión" paragraph with the pricing basis ("Precio por
  sucursal, al mes, en dólares. Sin tarjeta para empezar; 14 días de prueba con Conecta. El
  cobro en quetzales se confirma al elegir plan.") and keep the demo section. Update
  `tests/unit/public-plans.test.js` (the three assertions that pin `quotation`, `Solicitar
  cotización` and the GTQ regex) and `docs/openapi`. **2026-11-26:** the basis reads "Precio al
  mes por sucursal: en quetzales para negocios en Guatemala y en dólares (USD) fuera de
  Guatemala, con IVA incluido" and the tax note is "Precios con IVA (12 %) incluido. El
  comprobante fiscal (FEL) lo emite Recurrente por cada cobro."; the landing FAQ, `/prueba/`,
  the trial emails and the owner upgrade form quote "desde Q300 al mes por sucursal con IVA
  incluido (USD 39 fuera de Guatemala)".
- Umami events: `trial_start_click` (location), existing `plan_quote` stays for the contact
  link.

### 7.2 `/prueba/` signup page

Three-step card in the existing marketing/customer-modern style (`public/styles/customer-modern.css`);
the Turnstile widget takes its site key from a new `GET /api/public/trial/config` (same shape as
`/api/public/support/config`). Copy: "Crea tu programa en 2 minutos. Sin tarjeta. 14 días con
todas las funciones de Conecta." Error copy reuses the `createBusinessWithOwner` messages.

### 7.3 Owner app (Mantine)

- `GET /api/admin/plan` adds `plan_name`, `trial: { status, started_at, ends_at, days_left }` and
  `billing: { status, currency, provider, subscription: { plan, quantity, current_period_end,
  cancel_at } | null, purge_after }`; additive to `AdminPlanResponse` (`src/types/http-dto.ts`),
  so the installed PWA keeps working and `tests/unit/admin-plan-contract.test.js` gains cases.
- `main.jsx`: the footer shows `plan_name` instead of the raw code; a `TrialBanner` (Mantine
  `Alert`, the demo alert's slot) reads "Prueba gratis · te quedan N días · Elegir plan" while
  `billing.status === 'trialing'` and turns yellow from day 11. When `billing.status ===
  'locked'` the content area renders `OwnerTrialLocked`: what happened, what still works (ver
  clientes, reportes, exportar), the deletion date and the "Elegir plan" button; reads keep
  working, so navigation stays visible.
- New `OwnerPlan.tsx` ("Plan y facturación", under Configuración in `OwnerSettings.tsx`): plan
  and display name, branches counted, monthly total, trial/subscription state, "Elegir plan" →
  checkout, "Cancelar al final del período", subscription polling after the provider redirect.
  Register the lazy module in the `sw.js` precache (`npm run sw:build`). `errorMessage` in
  `owner-workspace.tsx` maps `402 TRIAL_EXPIRED` to "Tu prueba terminó. Elige un plan para
  seguir operando."

### 7.4 Super console (`/plataforma/`)

- `GET /api/super/businesses` returns the new columns; `public/super/businesses.js` gains filter
  chips (En prueba, Vencen en 3 días, Bloqueados, Convertidos, Por eliminar) and
  `business-card.js` shows trial dates and billing status.
- Actions (`csrfProtect` + `requireSuperAdmin` + `logSuperAudit`): `POST
  /api/super/businesses/:id/trial/extend { days }`, `…/trial/lock`, `…/billing/manual-activate
  { plan, note }` (bank-transfer or invoiced customers: `billing_status='active'`,
  `billing_subscriptions.provider='manual'`), `…/purge { confirm_slug }` (wave 1b), `GET
  /api/super/billing/events?status=failed`, and `GET/PUT /api/super/billing/catalog` for
  `billing_catalog` (prices, GTQ reference, provider price ids).

### 7.5 Emails (Spanish, PF branding, `renderBaseEmailTemplate`)

| Kind | Subject | Body outline |
| --- | --- | --- |
| `welcome` | "Tu prueba de PuntosFieles empezó" | Qué hacer hoy (elige regla, imprime QR, invita al equipo), enlace al panel y al registro de clientes, fecha de fin |
| `day10` | "Te quedan 4 días de prueba" | Progreso real del negocio (clientes registrados, puntos, canjes desde "Tu progreso"), precio del plan, botón "Elegir plan" |
| `day13` | "Mañana termina tu prueba" | Qué pasa al bloquearse (lectura, tarjetas visibles, sin nuevos puntos), botón |
| `locked` | "Tu prueba terminó" | Datos conservados hasta `purge_after`, cómo reactivar, exportar clientes |
| `purge7` | "Tus datos se eliminarán el {fecha}" | Última llamada, exportación |
| `activada` | "Tu plan {nombre} está activo" | Resumen, próximo cobro, enlace a la factura (`tax_invoice_url`) |
| `pago_pendiente` | "No pudimos cobrar tu plan" | Reintentos, actualizar tarjeta, fecha de bloqueo |

Owner progress data in `day10` comes from `owner-progress-service.js` facts (`active_customers`,
milestones), the same numbers the weekly brief uses.

## 8. Security and abuse

- Turnstile on both `request-code` and `signup`; `verifyTurnstile` fails closed when the secret
  is configured (keep the dev bypass), and the trial routes refuse to start in production
  without `CONTACT_TURNSTILE_SECRET`.
- OTP: the platform phone-proof limits (1 / min, 5 / hour per phone, `attempts ≤ 5`, 10-minute
  expiry, bcrypt hash, one active code per phone) plus `strictRateLimit` per IP on
  `request-code` and `TRIAL_OTP_DAILY_CAP`, a platform circuit breaker that answers 503 and
  alerts: SMS cost is the attack surface when there is no card.
- One trial per phone (`businesses_trial_phone_unique`) and per email (`businesses.email
  UNIQUE`); phones are normalised to digits with the dial code and restricted to
  `TRIAL_ALLOWED_DIAL_CODES` (502 by default). Disposable or VoIP numbers cannot be detected
  without a lookup provider; mitigations are the allowlist, the daily cap, a super-console
  blocklist (`platform_settings.trial_blocklist`) and a honeypot `website` field as in
  `support-case-service.js`.
- Grants: `trial_phone_grants` are hashed (`hashSessionToken`), 5 minutes, single use, separate
  from `mobile_access_grants` so a customer-card grant cannot open a signup. The signup body
  uses `passwordSchema` and `assertPasswordAllowed`; CSRF does not apply before a session
  exists, matching `/api/admin/signup`.
- Webhooks: signature over the raw body, 5-minute timestamp tolerance, `live_mode` must equal
  `RECURRENTE_LIVE`, dedupe on `provider_event_id`, and the event must match a stored
  `billing_checkouts` row (currency, quantity, amount) before any entitlement changes. The route
  has no `csrfProtect`, is mounted next to `paymentWebhookRoutes` in `src/app/routes/index.js`
  and is rate-limited leniently; secrets come from `envValue` `_FILE` mounts.
- Entitlement: `requireActiveBilling` runs after `requireStaff` (tenant RLS already set) and
  only narrows writes; legacy businesses (`billing_status='none'`) are never locked, so the
  deployment cannot cut off an existing customer. Purge: dry run first, then a platform
  transaction with a per-business advisory lock and wallet passes voided beforehand (§3.6).

## 9. Measurement

- Prometheus (`src/middleware/metrics.js` registry): `puntos_trial_signups_total{step}`
  (`code_requested`, `code_verified`, `created`), `puntos_trial_transitions_total{to}`
  (`locked`, `converted`, `purged`, `extended`), `puntos_billing_webhooks_total{provider,type,outcome}`,
  `puntos_billing_checkouts_total{provider,plan,currency,outcome}`.
- Per-business audit through the existing `emitBillingEvent` (`billing_events`): `trial.started`,
  `trial.reminder_sent` (metadata `kind`), `trial.locked`, `subscription.checkout_created`,
  `subscription.activated`, `subscription.past_due`, `subscription.canceled`; visible to the
  owner at `GET /api/admin/billing/events`.
- Funnel definitions: trial start = `trial_status <> 'none'`; activation = owner-progress
  milestones `programa_en_marcha` and `primer_cliente` reached before `trial_ends_at`
  (`owner_progress_milestones`); conversion = `trial_status='converted'` within 30 days of
  `trial_started_at`; churn = `billing_status='canceled'` within the first three paid periods.
  A read-only `GET /api/super/trials/summary` returns weekly cohorts (starts, activated,
  converted, locked, purged) and median days to `primer_cliente`. As in
  `docs/product/2026-11-23-owner-progress.md`, nothing here claims causation; the cohort table
  is the test.
- Website: Umami events on `/precios` and the `/prueba/` steps, with `location`.

## 10. Rollout plan

**Wave 1 — prices, signup, trial without payment.** Owner-visible: real prices on `/precios`; a
stranger creates a trial from the website; trials lock on day 14.

1. Migrations A (`businesses` trial columns) and B (`trial_phone_grants`); `TRIAL_*` config.
2. `PLAN_PRICING_USD` in `src/utils/plan.js`; published `publicPlanCatalog`; `/precios` copy and
   CTA; `tests/unit/public-plans.test.js` updated.
3. Phone-proof extraction from `mobile-access-service.js` (card lookup stays there);
   `/api/public/trial/*`; `public/prueba.html|js`; `createBusinessWithOwner` `signup` option.
4. `requireActiveBilling`; `GET /api/admin/plan` extensions; Mantine banner, lock screen and
   `OwnerPlan` (checkout button reads "Pronto" until wave 2); `sw.js` precache.
5. `trial.daily` (reminders, lock, purge dry run), the Spanish emails, super-console filters and
   actions (extend, lock, manual activate).
6. Local checks: `npm run lint`, `npm run typecheck`, `npm test`, merchant `typecheck`, `npm run
   openapi:generate`, `npm run sw:check`, a Playwright spec for `/prueba/` next to
   `tests/e2e/flows.spec.js`, and a browser smoke of the lock screen on a business whose
   `trial_ends_at` was set in the past by SQL. **Wave 1b:** cascade audit, then purge enabled
   after one week of dry-run logs.

**Wave 2 — Recurrente.** Owner-visible: a trial pays with a GTQ card and becomes Impulsa; the
payment list appears in the app.

1. Owner tasks first: Recurrente business account verified, Sandbox created, TEST
   key and signing secret stored as `_FILE` secrets, GTQ amounts decided (§12).
2. `src/app/services/billing/` (`provider.js`, `recurrente-provider.js`,
   `subscription-service.js`), migration C, `billing_catalog`, products created in the Sandbox
   and then live by `src/scripts/billing-catalog.mjs`.
3. `/api/admin/billing/*`, `/api/public/billing/webhooks/recurrente`, `OwnerPlan` checkout with
   status polling, branch-count quantity hooks.
4. Full Sandbox lifecycle with Test Clocks (payment, renewal, decline, recovery, cancel) recorded
   as unit-test fixtures; a `docs/INCIDENT_RUNBOOK.md` section for webhook failures and manual
   activation.

**Wave 3 — Stripe for USD customers.** Owner-visible: a non-GT business pays in USD.
`stripe-provider.js`, `/api/public/billing/webhooks/stripe`, Stripe prices, Stripe CLI fixtures;
gated on the availability check in §12.

Each wave is a website/server deployment; none touches `apps/customer` or the data the native
apps read (`business_public` and `/api/public/business/:slug` are unchanged).

## 11. Riskiest assumptions

1. **Recurrente can swap a plan on a live subscription.** The docs describe item add/remove with
   `now_and_charge`/`next_cycle` and say a product's price cannot be edited while subscriptions
   are active; "remove price A, add price B" is plausible but unverified. Fallback: cancel at
   period end plus a new checkout.
2. **Soft-lock scope for customers.** "Cards keep working read-only" is implemented as no new
   points or redemptions during the lock; if cashiers may keep awarding, `requireActiveBilling`
   must skip the award endpoints.
3. **Purging businesses is safe.** No deletion path exists today and cascades were only
   spot-checked; the dry run and cascade audit are mandatory before wave 1b.

## 12. Open questions for the owner

- ~~GTQ list amounts for the three plans (fixed numbers, not FX) and whether `/precios` shows a
  dated GTQ reference at all; IVA presentation (inclusive or "+ IVA", §6)~~ **Decided
  2026-11-26** (§1, §6): Q300 / Q630 / Q1,030 per branch per month, IVA included in every
  published amount (USD too); `/precios` leads with the quetzal price and keeps USD alongside,
  without an FX reference; Guatemalan businesses pay GTQ, the rest USD. Still open: how USD
  charges to non-GT customers are documented for SAT.
- Recurrente account status: business account verified, who handles `soporte@` escalations.
  **Decided 2026-11-26:** PF cannot issue or work with FEL; no FEL automatic invoicing, no NIT
  collection, and every surface says "por ahora no se emite factura electrónica (FEL)".
- Refund policy (Recurrente refunds via `POST /refunds` are manual; no proration refunds) and
  dispute text for `/terminos`; terms and privacy updates for "sin tarjeta" and the 30-day
  retention.
- Stripe availability for a Guatemalan entity (not verified) or whether a US entity would hold
  the Stripe account.
- Trial scope confirmation: Conecta features and 1 branch (current `PLAN_LIMITS`); whether
  pilots ("Piloto" feature) are exempt from locks; whether cashier awards continue during the
  soft lock (§11.2).
- Terms and privacy text (2026-11-26): a draft now exists in `public/terminos.html` ("Para
  negocios afiliados", "Prueba gratis", "Planes, precios y facturación", "Cambios de plan y
  cancelación", "Reembolsos", "Suspensión por falta de pago"; "Vigente desde el 26 de noviembre
  de 2026") and `public/privacidad.html` ("Facturación y prueba gratis del negocio"), pinned by
  `tests/unit/customer-legal-contract.test.js`. It states IVA-inclusive published prices, GTQ
  for businesses in Guatemala and USD elsewhere, Recurrente's FEL per charge, no card numbers
  stored, prorated upgrades / next-cycle downgrades, cancellation at period end, no refunds for
  partial periods (duplicate or erroneous charges refunded once verified), a 7-day grace period
  and the 30-day retention. It is a product draft, not legal advice: it names no legal entity,
  jurisdiction or statute and needs legal review (consumer-protection and tax wording, refund
  policy, the IVA presentation that `/precios` still shows as "sin impuestos") before it is
  treated as final.
