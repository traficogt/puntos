# "Tu progreso": owner-facing progress design (v2, decision of record)

Owner decision on 23 November 2026, after reviewing three external
proposals: build a small, private, business-level progress experience for
owners, test it with the pilot cafés, and claim nothing about retention
until measured. This v2 replaces the morning draft. Implementation:
`owner-progress-service.js`, `/api/admin/owner-progress*`, Mantine
`OwnerProgress` view and Overview card.

## Decisions

| Question | Decision for v1 | Revisit |
| --- | --- | --- |
| Name in the product | "Tu progreso" (never "gamificación") | — |
| Scope of achievements | Business level only | Staff leaderboard after pilots, with a quality rule |
| Comparison basis | The business's own history | Peer benchmarks when a segment has ≥10 businesses |
| Cadence | Weekly; no daily mechanics | — |
| Streak | Weekly "momentum" counter, secondary, with one freeze per 8 weeks; a week with nothing to do counts | — |
| Tiers / unlocks | None. Plan tiers already gate features; recognition and content only | — |
| Owner rewards | Recognition only (milestone history, "Comercio pionero" for pilots, printable/downloadable milestone card later) | Financial perks never during pilots |
| Score | Setup completion as a fraction of steps; no composite "health" score | — |
| Prompts | Monday owner brief only (existing). No Friday nudge in v1 | — |
| Availability | Every plan | — |
| Control | Owner can change or dismiss the suggested goal and hide the whole card; hidden state persists | — |

## Evidence and limits

Precedents: Shopify Milestones (milestones.shopify.com), DoorDash "Road to
Most Loved" (merchants.doordash.com/en-us/learning-center/road-to-most-loved),
Google Business Profile strength (support.google.com/business/answer/15691556),
Salesforce Trailhead. Research: Sailer et al. (2017, Computers in Human
Behavior, https://doi.org/10.1016/j.chb.2016.12.033) found effects depend on
which elements are used; Mekler et al. (2017, Computers in Human Behavior,
https://doi.org/10.1016/j.chb.2015.08.048) found points/levels/leaderboards
raised output without raising intrinsic motivation; Nunes & Drèze (2006,
Journal of Consumer Research, https://doi.org/10.1086/500480) measured endowed
progress on consumers, not business users. None of this shows an effect on
merchant profit or PF retention; the pilots are the test.

## Counting rules (strict; these decide trust)

- Genuine activity: award transactions that are not reversed, not from a
  practice/rehearsal session, not from a test or pilot-seed account, and not
  imported history (migration source). Redemptions likewise.
- Returning customer: a distinct customer with a genuine award on a later
  calendar day (business timezone) than their first genuine award. Two
  entries from one purchase never count as a return.
- Program review: an explicit owner action in the UI ("Mantener" or
  "Ajustar"), recorded with a timestamp; viewing a report does not count.

## The launch path ("Programa en marcha")

| key | label | satisfied when |
| --- | --- | --- |
| rules | Reglas y recompensa listas | program configured (same predicate as PROGRAM_NOT_CONFIGURED) and ≥1 active reward |
| card | Tarjeta e inscripción listas | branded QR generated or enrollment link issued |
| practice | Práctica de acumular y canjear | a practice earn-and-redeem session completed (merchant launch / rehearsal records) |
| team | Equipo preparado | ≥1 staff user besides the owner has completed a practice or a genuine award |
| live | Participación real iniciada | first genuine award |

Completing all five grants the milestone `programa_en_marcha`. Branding is a
suggested goal, not a blocking step.

## Milestones (v1 set, modest numbers)

| key | label | satisfied when |
| --- | --- | --- |
| programa_en_marcha | Programa en marcha | launch path complete |
| primer_cliente | Primer cliente participando | first genuine award |
| ya_estan_volviendo | Ya están volviendo | 5 distinct returning customers |
| primera_recompensa | Primera recompensa entregada | first genuine redemption |
| primera_revision | Primera revisión del programa | first recorded review action |
| clientes_50 / 100 / 300 | 50 / 100 / 300 clientes | active customers ≥ N |
| primera_automatizacion | Primera automatización activa | birthday or winback enabled |
| primera_campana_medida | Primera campaña medida | a campaign with holdout measurement complete |
| primer_pase_wallet | Primer pase en Wallet | native wallet passes ≥ 1 |
| pos_conectado | Punto de venta conectado | POS integration enabled |
| momentum_4 | Cuatro semanas de impulso | momentum ≥ 4 |
| pionero | Comercio pionero | business is a pilot (granted, not earned) |

## Suggested goal (one at a time)

Derived from state, in priority order; the owner can switch or dismiss:
finish the launch path → first genuine customer → team comfortable with
redemption (no redemptions yet while customers exist) → first five
returning customers → review whether the first reward takes too long (no
redemption 30 days after first award) → review a month of results.
Dismissed goals are not re-suggested for 30 days.

## Modes and measurement

`owner_progress_mode`: `off` | `checklist` | `full` (default `full`).
`owner_progress_holdout_pct` (default 0): deterministic variant per business
(`treatment` | `holdout`); holdout sees the launch path only. Variant is
exported with activation insights.

Assignment rule (2026-11-24, `ensureVariant` in
`src/app/services/owner-progress-service.js`):

1. A variant stored in `businesses.owner_progress_variant` is final; it is never
   reassigned, whatever the share becomes later.
2. While the share is 0 nothing is stored and every business is implicitly
   `treatment`. (Storing `treatment` at 0% would make a share set later apply
   only to businesses never read before, defeating the comparison.)
3. When the share is above 0, a business without a stored variant is assigned
   on its next read. A business already exposed to the full experience (an
   acknowledged milestone, a chosen or dismissed goal, a review, or a
   visibility change) is stored as `treatment`: it has already seen it. A
   business never exposed receives the deterministic hash
   (`sha256(business_id) mod 100 < share`) against the current share.

Consequence for the plan: the holdout can only contain businesses that had not
used the full experience when the share was set, so set the share before the
cohort you intend to measure is onboarded, and compare only businesses created
after that date. Setting the share back to 0 stops new assignments but does not
move stored holdouts back. Pilot evaluation questions: time to a
working program and first genuine participation; real activity across
successive weeks and successful redemptions; whether owners can explain
what happened and choose a sensible next action; burden signals (hides,
dismissals, support requests). Free pilots cannot establish paid retention.

## API

- `GET /api/admin/owner-progress` → `{ mode, variant, hidden, launch:{steps:[{key,label,done,done_at?,href}], done_count, total, complete}, goal:{key,label,progress?,href}|null, milestones:[{key,label,reached_at?,acknowledged_at?}], momentum:{weeks,current_week_active,freezes_available}, new_milestones:[key] }`
- `POST /api/admin/owner-progress/acknowledge` `{ keys }`
- `POST /api/admin/owner-progress/goal` `{ key }` or `{ dismiss: key }`
- `POST /api/admin/owner-progress/review` `{ decision: "keep" | "adjust", note? }`
- `POST /api/admin/owner-progress/visibility` `{ hidden: boolean }`
Owner role only, every plan; mode `off` → 404.

## Storage

`owner_progress_milestones (business_id, key, reached_at, acknowledged_at)`
with tenant RLS; `owner_progress_state (business_id pk, hidden, current_goal,
dismissed_goals jsonb, last_review_at, last_review_decision, freezes_used,
updated_at)` with tenant RLS; `businesses.owner_progress_variant`.

## Surfaces

Mantine Overview card "Tu progreso" (launch progress or current goal, most
recent achievement, suggested next step, options Ver avance · Cambiar meta ·
Ocultar); Mantine `OwnerProgress` view (full path, milestone history with
dates, momentum, review action); Monday owner brief line; demo fixtures.
Nothing in the vanilla dashboard, nothing in the native app.

## Out of scope for v1

Staff rankings, peer benchmarks, tiers, financial perks, Friday nudges,
push notifications, AI-generated suggestions.
