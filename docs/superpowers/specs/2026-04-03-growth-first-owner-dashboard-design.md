# Growth-First Owner Dashboard Design

## Objective

Reframe `/admin-dashboard` as a growth-first owner console instead of a configuration-first tab surface.

The first screen should answer, quickly and clearly:

- is the loyalty program growing the business?
- are more customers joining and returning?
- are rewards generating healthy repeat behavior or just cost?
- what should the owner act on next?

## Product Purpose

The dashboard's primary job is not day-to-day cashier operation. That belongs in the staff/scanner flow.

The owner dashboard exists to help a business owner understand whether PuntosFieles is working as a growth product:

- customer acquisition
- repeat behavior
- reward efficiency
- branch performance
- risks and opportunities

So the opening screen should lead with growth visibility, not setup forms or equal-weight tabs.

## Current Context

The existing dashboard already has:

- a premium shell and topbar
- grouped tabs:
  - Programa
  - Operación
  - Crecimiento
- analytics fragments and controllers that already load:
  - summary tiles
  - ROI report
  - revenue trend
  - churn risk
  - branch performance
  - branch benchmark
  - cohorts
  - alerts/anomalies
  - ledger/reconciliation signals

This redesign should build on those existing signals instead of inventing a new analytics backend first.

## Recommended Approach

Use a **growth command center** as the first screen.

This is preferable to:

- a narrative-first executive brief, which is slower to scan
- a split growth/operations home, which dilutes the product’s main purpose

The command-center approach makes the dashboard feel like:

- a decision surface for owners
- a weekly business console
- a premium product centered on outcomes, not just settings

## First-Screen Hierarchy

### 1. Growth Summary Board

The dominant area on load should be a KPI board with 4 to 6 signals.

Recommended KPI set:

- clientes activos
- clientes nuevos
- frecuencia de compra
- retención / recompra
- ingresos atribuidos or revenue trend proxy
- costo de recompensas / ROI

The exact labels can adapt to currently available summary fields, but the board should remain focused on growth and efficiency, not raw operational noise.

### 2. Narrative Executive Block

Below the KPI board, show one short executive summary.

Characteristics:

- Spanish-first
- grounded in real loaded data
- concise
- outcome-focused

Example shape:

> “La recurrencia subió esta semana, pero el costo por canje creció más rápido que el ingreso incremental.”

This block should help interpretation, not replace the KPI board.

### 3. Suggested Actions

Show 2 or 3 recommended actions only.

Action sources can come from current signals such as:

- churn risk
- alerts center
- ROI weakness
- branch underperformance
- lack of referrals or campaign activity

Actions should feel operational and specific, for example:

- revisar una sucursal con bajo retorno
- ajustar una recompensa costosa
- activar una palanca de crecimiento como referidos

This must not feel like generic AI advice.

### 4. Drill-Down Bands

Below the summary layer, the detailed dashboard areas remain available, grouped into:

- `Crecimiento`
- `Programa`
- `Operación`

These are not removed. They become secondary and subordinate to the summary layer.

## What Changes

- The first-screen composition
- The prominence of growth metrics
- The role of analytics, which becomes central instead of “just another tab”
- The tab rail, which becomes secondary
- The meaning of the dashboard, from “settings + tabs” to “growth command center”

## What Stays

- Existing backend analytics endpoints
- Existing fragments/modules
- Existing plan gating
- Existing branch filter behavior
- Existing analytics drill-down functionality

This is primarily a hierarchy and framing redesign, not a backend rewrite.

## Information Architecture

Recommended dashboard structure:

### Summary Layer

- growth KPI board
- executive narrative
- suggested actions
- high-level branch or business scope status

### Detailed Layer

- `Crecimiento`
  - analytics
  - referrals
  - achievements/challenges where relevant
- `Programa`
  - rewards
  - branding
  - tiers
  - gift cards
- `Operación`
  - branches
  - staff
  - operations safeguards and controls

The detailed layer should still use the current modular system, but the summary layer should orient the owner before they click into it.

## Data Strategy

The redesign should use existing loaded analytics signals first.

Likely existing building blocks:

- `dashboard.summary`
- ROI report
- recent activity / revenue trend
- churn risk list
- branch performance
- branch benchmark
- cohort summary
- alerts center
- anomaly and ledger signals

The summary layer should synthesize these into a cleaner owner view instead of exposing them as many equal-weight cards.

No new analytics computation is required for the first pass unless a summary gap is discovered during implementation.

## Visual Direction

The owner dashboard should feel like a premium business console:

- one dominant summary area
- fewer equal-weight cards
- stronger headline hierarchy
- quieter secondary modules
- restrained color usage
- no decorative motion

The current premium shell direction remains valid:

- dark, high-trust
- editorial but operational
- not playful
- not generic SaaS

## Testing

The redesign should include contract-level UI tests for:

- presence of a top-level growth summary layer
- growth-first KPI board markers
- narrative block presence
- suggested-action block presence
- tab rail remaining secondary, not removed
- analytics still reachable and gated correctly

If copy or DOM contracts change, update focused tests rather than relying on manual visual inspection only.

## Scope Boundaries

Included:

- growth-first owner dashboard hierarchy
- summary-layer UX and shell changes
- integration of existing analytics signals into a new first screen
- preserved drill-down access to current modules

Not included:

- new analytics backend engine
- billing or pricing UI changes
- staff flow redesign
- customer wallet redesign
- new forecasting/ML features

## Success Criteria

The redesign is successful when:

- an owner can understand business performance within seconds of landing
- the dashboard clearly communicates growth health before configuration detail
- analytics feels central to the owner experience
- existing modules remain accessible without dominating first impression
- the surface feels premium, intentional, and purpose-built for business growth
