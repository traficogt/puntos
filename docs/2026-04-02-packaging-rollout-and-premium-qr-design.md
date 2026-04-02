# Packaging Rollout And Premium QR Design

## Goal
Apply the approved plan packaging to internal product surfaces and define a safe premium QR-logo capability gated at `EMPRESA`.

## Scope
This pass covers:
- super/admin plan surfaces
- owner dashboard plan-aware gating copy
- premium QR-logo product boundary

This pass does not cover:
- public pricing page rollout
- billing or checkout flows
- custom domains
- full white-label implementation

## Rollout Model

### Super/Admin Surfaces
Show the full packaging truth in:
- plan cards
- plan summaries
- business plan selector context

These surfaces can be explicit about plan differences because they are operator-facing.

### Owner Dashboard Surfaces
Reflect the packaging more lightly:
- locked feature labels
- concise upgrade nudges
- plan-aware descriptions for gated modules

Do not turn the owner dashboard into a pricing page.
Do not add aggressive sales copy.

## Approved Packaging

### EMPRENDEDOR
Included:
- QR and customer wallet
- points, rewards, and redemptions
- basic program rules
- one location
- basic staff access
- core platform safety protections in the background

Excluded:
- analytics
- tiers
- referrals
- customer export
- multi-branch
- gift cards
- campaign rules
- webhooks
- lifecycle automation
- advanced branding controls
- advanced RBAC
- external awards
- gamification

### NEGOCIO
Everything in EMPRENDEDOR plus:
- analytics
- tiers
- referrals
- customer export
- multi-branch
- gift cards
- campaigns
- webhooks
- automations
- advanced RBAC
- premium branding for customer-facing surfaces

This should be the practical target plan for serious businesses.

### EMPRESA
Everything in NEGOCIO plus:
- gamification
- external awards / event-driven point issuance
- advanced branding
- future custom domain
- future QR logo embedding
- enterprise-heavy controls added later

## Premium QR Logo Capability

### Product Boundary
The business logo can be embedded inside the customer QR only when:
- the business is on `EMPRESA`
- the logo is present and valid
- rendering passes safe constraints

This is a premium branding feature, not a core loyalty feature.

### Branding Levels
Standard branding:
- business name
- colors
- logo on customer-facing wallet/join surfaces

Premium QR branding:
- logo embedded inside the QR
- gated at `EMPRESA`
- safe fallback to plain QR always available

## Safe Rendering Strategy

### Asset Source
Do not introduce a separate QR-logo asset yet.
Reuse the business logo URL already stored in customer branding.

### Constraints
- conservative center logo size, roughly 16% to 18% of QR width
- high QR error correction
- logo placed inside a clean badge shape
- no animation
- no low-contrast decorative treatment
- plain QR fallback on any failure

### Reliability Rule
Scan reliability wins over branding every time.
If there is no valid logo, if image loading fails, if constraints are not met, or if the feature is unavailable for the plan, render a plain QR.

## UX Behavior

### Owner Dashboard
- eligible businesses can see the premium QR branding capability described in branding controls
- non-eligible businesses can see concise upgrade messaging
- messaging should be operational, not salesy

### Customer Wallet
- if premium QR branding is enabled and safe, show the branded QR
- otherwise show the normal QR with no broken state

## Implementation Boundary
Implementation should be split into:
1. packaging rollout in super/admin and owner dashboard copy
2. QR-logo premium capability with safe plan gating and fallback

Do not add billing, checkout, or public pricing rollout in this pass.
