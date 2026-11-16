# Article capability audit — 16 November 2026

Scope: all six current articles in `src/content/guides/manifest.json`, their
public/scheduled renderings and five unindexed previews, plus the original
still-served review at `/revision-editorial/7fc4175cd754b74d9ebe8791/`.
Reviewed against website source at `446a876`, including browser UI, server
calculations and public help. This establishes implemented behavior, not real
merchant outcomes or installed native app behavior.

Two independent read-only audits covered three articles each. Existing original
research passages, APA references, source-access limitations, illustrations and
publication times are preserved. This is a product-capability audit, not a new
literature review. Three software-documentation references are added to support
the new product notes. No study is presented as a test of PF effectiveness.

## Editorial decision

An article may teach something beyond PF. Research and useful operating advice
must not be narrowed merely to fit a feature checklist. What must be accurate is
the distinction between a research finding, an invented example, an exercise
the reader performs separately, and a feature the software actually provides.

Use at most one optional **En PuntosFieles** note per article, only when it helps
the reader apply the topic. It appears after the prose, before methodology and
references, in ordinary text with one public help link. State relevant inputs,
plan requirements and limits. Cite PF documentation as software documentation,
separately from research. Do not put a purchase button, testimonial, comparative
claim or implied research endorsement in the note. Do not force a note into every
article. Remove the repeated sales pitch in article footers.

This pass uses three notes: staff practice, reward cost reports and customer
progress. The general overview, visit-threshold article and welcome-stamp article
remain without a feature note. Their calculator links retain a practical role.

## Article-by-article findings and disposition

### 1. ¿Funcionan los programas de fidelización?

- Self-selection, observed differences between customer groups, the original
  stamp experiment and the null/uncertain workplace-cafeteria result are research
  descriptions. Keep their settings and methods; do not relabel them as PF tests.
- Customer progress is implemented: `public/customer/render.js:51`,
  `src/app/services/customer-reward-progress.js:15–38`. It displays points, reward
  cost and conditions, not a universally exact number of remaining visits.
  Qualify the hypothetical “two visits” phrase with equal earning per visit.
- The laundry's Q160 / (Q16 − Q2), rounded to 12 additional purchases, matches
  the calculator's future-reward reserve: `public/calculator/simple-model.js`.
  Keep the distinction between a scenario and measured additional purchases.
- More first-time customers returning is a valid objective, not a claim that the
  complete weekly first-buyer report exists. See gap 1 below.
- No product note: this article's job is to explain evidence and interpretation.

### 2. Cómo diseñar un programa de fidelización

- Original bakery rule “Q25 minimum and one stamp per day” was not a configurable
  base VISIT policy. Base awards multiply recorded visits by points per visit
  (`src/app/services/transaction-rule-evidence.js:35–59`). Campaign minimums
  condition extra awards; redemption/day limits limit redemptions, not earning.
  Replace it with one point per recorded visit with purchase and a six-point
  reward, still explicitly hypothetical. Bonuses and point holds may alter the
  final journey; the example is a simple base rule, not a universal policy.
- Reward terms, expiry, branches, availability and unit costs are configurable
  through `web/merchant/src/RewardsWorkspace.jsx` and
  `src/app/services/reward-workspace-service.js`. Same-visit redemption requires
  points to be available and the reward to satisfy its conditions.
- Practice exists in `web/merchant/src/LaunchPractice.jsx`,
  `src/app/routes/service-completion-routes.js` and
  `public/staff/rehearsal-model.js`. It tests base earning, insufficient-points
  or unavailable-reward rejection, redemption and returning a fictional redeemed
  reward. It does not simulate a below-Q25 purchase rule, a paid-sale refund,
  promotions, the POS, Wallet or delivered messages. Correct the proposed cases.
- A selected week's first recorded buyers followed for 30 days is not a shipped
  owner report. Keep the valuable question, explicitly describe a separate
  per-customer dated worksheet, distinguish first recorded purchase from first
  actual visit, retain non-returners and separate incomplete follow-up windows.
- The brief PF note links `/ayuda/caja/practicar/`; it states connection and
  rule/reward prerequisites and the practice's coverage limits. No extra plan
  gate was found on the practice route; authentication remains required.

### 3. Cuánto cuesta una recompensa

- Q30 retail value, Q9 fulfillment cost and 80 outstanding notebooks remain an
  invented economic example, not PF account data. The Q840 / (Q28 − Q3) result
  of 34 additional purchases matches the calculator's assumptions. Neither is
  an accounting valuation or measured causal return.
- Cost inputs and snapshots exist in `web/merchant/src/Economics.jsx:47–67` and
  `src/app/services/reward-economics-service.js:33–80`. Known historical costs
  come from costs saved at fulfillment; recording a cost today does not backfill
  unknown historical redemptions. Zero and unknown are different values.
- Outstanding commitments exist in `web/merchant/src/IssuedCommitments.jsx`,
  `web/merchant/src/ActivationInsights.jsx` and
  `src/app/services/reward-commitment-service.js:33–58`. Protected-cycle options
  can exist before sufficient points; multiple options are alternatives, not
  separate earned prizes. Do not describe this report as the exact count of
  the example's 80 already-earned notebooks. Point scenarios remain separate.
- Reward stock is a remaining redemption limit, not a universal cap on customers
  earning progress. Courtesy grants and campaigns have their own caps. The
  article's suggested planning worksheet is not claimed to be one PF screen.
- The PF note links `/ayuda/negocio/costos/`, says a plan with analytics and
  merchant-entered costs are required, and explains missing history and mutually
  exclusive options. Feature overrides can alter a tenant's default plan access;
  avoid a hardcoded tier price or universal availability claim.

### 4. ¿Cuántas visitas pedir para una recompensa?

- Six- versus ten-purchase arithmetic remains hypothetical. State one stamp per
  haircut, no bonuses, immediate availability and reward with the final purchase.
  PF can configure points per visit and a reward's point price; it does not
  independently prove the entered visit count or always allow immediate canje.
- “Four of six haircuts” is staff's suggested explanation at the counter, not
  a quoted PF progress screen. Actual browser progress is points-based.
- The proposed starters/completers/time-to-target review needs separate tracking.
  PF's `web/merchant/src/RedemptionReturns.jsx` follows purchases for 30 days
  **after redemption**, with mature/open groups. It does not cover the example's
  entire 20–72-week earning journey or select an optimal threshold.
- Preserve conditions for customers who already started accumulating, not only
  fully earned rewards. PF protects applicable recorded cycles on rule changes:
  `src/app/services/reward-promise-service.js`,
  `src/app/migrations/2026-11-11-reward-promises-hospitality.sql`. This is not a
  guarantee of unrecorded historic promises, stock, or immediate point release.
- No product note; retain the calculator link and state the reporting limit.

### 5. La ventaja de empezar con dos sellos

- Preserve original research, including equal remaining effort across groups.
- The bicycle-workshop example is now explicitly a paper-card exercise. PF has
  no universal two-stamp welcome setting or eight-empty versus ten-with-two
  presentation experiment. Explain that limit in the practical trial section.
- Referral-at-registration awards, achievements and second-visit offers are
  real points with eligibility rules. They do not reproduce the study's display
  manipulation. Sources: `src/app/services/referral-service.js:263`,
  `src/app/services/gamification/achievements-service.js:44`,
  `src/app/services/second-visit-service.js`.
- Backend bonus provenance exists, but browser history is not a universal clear
  “gift versus purchase” labelling feature (`public/customer/render.js:133–137`,
  `src/app/services/customer-statement-service.js:7–12`). Keep distinguishing
  gifts as an operating principle; do not call it fully surfaced in PF.
- Offer/holdout experiments (`src/app/services/growth-campaign-service.js:271`)
  do not compare alternative card layouts or thresholds. The proposed trial
  uses physical cards and a separate record. No product note is warranted.

### 6. ¿Mostrar lo que llevas o lo que te falta?

- Preserve research on progress framing, its limited outcomes and the distinction
  from reward proximity and reminder timing.
- Early-earned versus late-remaining wording is a proposed counter explanation
  or editable-paper/interface experiment. PF's current headline always uses
  remaining points; the merchant cannot choose arbitrary progress wording or
  run message-variant experiments. Clarify where the reader can try the idea.
- Customer browser progress is directly relevant and implemented:
  `public/customer/render.js:51–57`,
  `src/app/services/customer-reward-progress.js:34`,
  `src/app/services/native-wallet/engagement.js`. The note links
  `/ayuda/clientes/puntos/`, identifies browser scope and pending-point exclusion,
  and explicitly says PF does not automatically switch framing or run the
  proposed comparison. No claim about installed native releases is added.

## Gaps evaluated for incorporation

| Priority | Candidate | Decision and meaningful implementation scope |
| --- | --- | --- |
| 1 | Weekly first-purchase / second-purchase report | Worth building next. Read-only API and simple owner summary, but requires a deliberate measurement definition. Identify first genuine recorded purchase across history using purchase event time with disclosed legacy fallbacks; choose cohort week in business timezone; define same-day and branch rules; show complete/open 30-day windows and keep non-returners in the denominator. Handle delayed sync, imports, reversals and tenant isolation. Existing same-period repeat rate, source-acquisition totals, 1–14-day second-visit offers and post-redemption returns are not substitutes. Not implemented by this editorial release. |
| 2 | Clear customer labels for bonus versus purchase points | Worth a focused browser improvement. Existing transaction provenance can support it, but legacy rows, referrals, achievements, corrections, refunds and statement totals need consistent labels. Do not fabricate visits to create welcome progress. Not implemented here. |
| 3 | Read-only progress framing experiment | Consider after the first-buyer report. A presentation variant can reuse available balance/reward cost, but must not treat spent balance as lifetime progress, change protected targets or hide pending conditions. Define stage changes and measurement before calling it an experiment; no revenue promise. Not implemented here. |
| Later | Universal welcome credit and equal-effort card experiment | Substantive earning/ledger work: explicit one-time eligibility, cost limits, abuse controls, reversals, clear provenance and protected terms. Equal-effort visual trials also need stable group-specific targets/display semantics. Keep the paper exercise now; do not simulate with imported balances or invented purchases. |
| Later | Minimum spend plus daily earning cap | Potentially useful across sectors, but affects every award path: online staff, offline synchronization, POS, concurrent retries, refunds and timezone boundaries. Correct the example now rather than changing the ledger to satisfy one article. |
| Later | Full earning-cycle duration/funnel | Useful once “starts,” cycle changes, gifts, multi-reward choices and completion are consistently defined. The current post-redemption follow-up remains explicitly narrower. |

The owner requested evaluation and accurate examples. This release does not
silently expand ledger behavior or present roadmap candidates as delivered.

## Historical material and verification

The original first-article review remains unindexed and is visibly marked as the
first review version, with a link to the current published article. Its old
Q160/Q16 example is corrected to include Q2 future rewards and 12 purchases.
Archived JSON and source files under `drafts/` retain provenance; their README
directs editors to the canonical manifest and this audit before reusing copy.

For prose, the designated technical and historical references were read:
https://edu.tallerlumiere.com/tecnica/exposicion-i/ and
https://edu.tallerlumiere.com/perfiles/karl-blossfeldt/ . No photography facts,
personal experiences or wording were transferred. These are style references,
not sources supporting loyalty claims.

Verification includes the existing source-passage/reference hash checks (original
research unchanged, new cited software help explicitly separated), citation
targets, schedule/privacy checks, optional-note validation/escaping, public-help
destinations, six-article browser checks, desktop/mobile screenshots and focused
lint/type checks. Release evidence lives outside the repository under
`/var/lib/puntos/releases/article-capabilities-20261116/`.
