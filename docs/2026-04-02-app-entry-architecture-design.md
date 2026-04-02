# App Entry Architecture Design

Date: 2026-04-02

## Goal

Define the canonical entry architecture for PuntosFieles so the product is cleanly split between marketing and operations, remains Spanish-first, stays PWA-first, and is ready for future `app.puntosfieles.com` deployment without creating parallel product structures.

## Product Boundary

PuntosFieles has two top-level surfaces:

- `puntosfieles.com`
  Marketing only.
- `app.puntosfieles.com`
  Product only.

The marketing domain sells the product and collects demo requests. The app domain runs customer, staff, and owner workflows.

This is a hard separation:

- marketing does not contain wallet access
- marketing does not contain staff login
- marketing does not contain dashboard access
- app does not act like a brochure site

## Domain Model

### Marketing Domain

`puntosfieles.com` contains:

- landing page
- demo request flow
- legal and supporting public pages

`puntosfieles.com` does not contain:

- public business signup
- customer wallet entry
- staff login
- owner dashboard entry

### App Domain

`app.puntosfieles.com` contains:

- customer join and wallet
- staff login and scanner
- owner dashboard
- internal operator provisioning

The root of the app domain is operational by default:

- `app.puntosfieles.com/` redirects to `/staff/login`

This keeps the app root aligned with the operational use case while customers continue to enter through business-specific links.

## Canonical Routes

### Marketing

- `/`
  Marketing landing only.

### Customer

- `/registro/:slug`
  Customer entry for a specific business. This is the primary customer acquisition path.

- `/c`
  Customer wallet for the active customer session on the current device/browser.

### Team

- `/staff/login`
  Shared operational login for staff and owners.

- `/staff`
  Scanner / POS workflow for staff.

### Owner

- `/admin-dashboard`
  Owner dashboard after login.

### Internal

- `/admin`
  Internal-only provisioning surface for manual business setup by the operator.

## Customer Entry Model

The business is responsible for distributing the customer registration link.

Primary customer journey:

1. Business shares `app.puntosfieles.com/registro/:slug`
2. Customer verifies phone and activates their card
3. Customer is taken directly to `/c`
4. `/c` becomes the return surface for that active business context on that device/browser

### V1 Wallet Scope

For v1, `/c` represents one active business context at a time.

This means:

- `/c` is not a program switcher
- `/c` is not a marketplace or directory
- the user should not be asked to “find their business” from a generic customer hub

If a customer later joins another business from a different `registro/:slug` link, that new program may replace the active customer context on the current device/browser. Multi-program switching can be designed later as a deliberate product feature if it becomes necessary.

This keeps v1 simple and aligned with the current data and session model.

### Spanish-First Route Naming

Customer-facing route names should be Spanish-first.

This means:

- use `/registro/:slug` instead of `/join/:slug`
- prefer Spanish public/customer URLs where practical

Slug values themselves should remain ASCII-safe for URL reliability, QR compatibility, and lower support friction.

Examples:

- `cafe-bourbon`
- `ninos-felices`
- `panaderia-central`

This preserves Spanish naming without introducing accented URL edge cases.

## Staff And Owner Entry Model

There is one operational login surface:

- `/staff/login`

Post-login routing is role-based:

- staff role -> `/staff`
- owner/admin role -> `/admin-dashboard`

This avoids fragmenting the team entry story while preserving clear post-login jobs.

### Staff Surface

`/staff` is optimized for one job:

- validate customers
- process purchases
- apply rewards
- scan and confirm quickly

It should stay focused and avoid dashboard-style clutter.

### Owner Surface

`/admin-dashboard` is the control center for:

- branding
- rewards
- staff
- branches
- analytics
- operations

## Internal Provisioning Model

Business onboarding is manual for now.

`/admin` is not a public self-serve signup surface. It is an internal operator workflow used to:

- create the business
- assign slug
- configure initial branding
- create owner access

After provisioning, the operator hands over:

- customer join link
- team login instructions
- owner dashboard access

## UX Rules

### Rule 1: Marketing Sells, App Operates

No operational entry points should be promoted on the marketing domain.

### Rule 2: Customers Enter With Business Context

Customers should arrive from a business-specific link, not from a generic “find your business” hub.

### Rule 3: Team Entry Is Unified

There is one login surface for staff and owners. Roles determine the destination after login.

### Rule 4: `/c` Means “My Active Card”

For v1, the wallet represents the currently active business context, not a portfolio of programs.

### Rule 5: Spanish-First Public And Customer Surfaces

Public copy and customer-facing entry flows are Spanish-first by default. English or alternative language support can come later, but Spanish should drive naming, hierarchy, and UX writing.

## PWA And Native-Ready Constraints

The architecture remains PWA-first:

- customer join and wallet are web-first
- team login and scanner are web-first
- routing and runtime config remain compatible with a future native wrapper

The design avoids browser-only assumptions that would block a future native shell. The app domain should remain a self-contained web product that can later be wrapped for Android/iOS if desired.

## Out Of Scope

This design does not include:

- custom domains per business
- self-serve white-label onboarding
- multi-program customer switching
- final visual redesign of each route
- final hero or product marketing motion

Those can build on top of this route and entry architecture later.

## Decision Summary

- `puntosfieles.com` is marketing only
- `app.puntosfieles.com` is product only
- `app.puntosfieles.com/` redirects to `/staff/login`
- customers enter through `/registro/:slug`
- customers return through `/c`
- staff and owners share `/staff/login`
- role decides whether they land on `/staff` or `/admin-dashboard`
- `/admin` is internal-only provisioning
