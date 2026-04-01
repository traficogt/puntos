# Customer Branding Foundation Design

**Date:** 2026-04-01  
**Status:** Approved and in implementation  
**Scope:** Customer-facing branding foundation only

## Goal

Lay the foundation for tenant-aware branding in the customer-facing product without committing to full self-serve white-labeling yet.

This pass must make the product production-safe today while creating a clean path toward:

- `platform_led` customer presentation
- `endorsed_brand` customer presentation
- `white_label_ready` customer presentation

The design must avoid forking the product into multiple apps or layouts.

## Product Direction

PuntosFieles will operate as:

- `puntosfieles.com` = marketing and public landing
- `app.puntosfieles.com` = shared application shell

Customer entry should be business-specific whenever possible:

- `app.puntosfieles.com/join/:slug`
- future equivalents on subdomains or custom domains

Merchant and staff entry remain platform-controlled:

- `app.puntosfieles.com/admin`
- `app.puntosfieles.com/admin-dashboard`
- `app.puntosfieles.com/staff/login`
- `app.puntosfieles.com/staff`

This keeps the operational product centralized while allowing customer-facing branding to become tenant-aware.

## Language Rule

This is a Spanish-first product.

All public-facing and customer-facing copy introduced by this foundation must default to Spanish. English may exist internally in code, identifiers, or future localization infrastructure, but production-facing customer surfaces should treat Spanish as the canonical language.

This rule applies to:

- join pages
- customer wallet UI
- customer shell metadata where user-visible
- powered-by labels
- admin copy for branding fields that will be used to render customer-facing text

## Recommended Branding Strategy

The recommended production posture is `endorsed_brand`.

That means:

- the business brand leads in customer-facing surfaces
- PuntosFieles remains visible in a restrained way
- the platform keeps a single shared UX structure

Three branding modes should exist in the foundation:

### 1. `platform_led`

PuntosFieles leads visually. The business appears inside the program context.

Use cases:

- early default posture
- low-setup tenants
- safety fallback

### 2. `endorsed_brand`

The business leads visually. PuntosFieles appears as “Powered by PuntosFieles” or equivalent subtle endorsement.

Use cases:

- default recommended production mode
- most SMB customers

### 3. `white_label_ready`

The business leads almost completely, but the code still runs on the same shared product and routing model.

Use cases:

- premium/manual enablement
- future full white-label expansion

This mode exists in the data and rendering model now, even if it is only lightly exposed operationally at first.

## Scope Boundary For V1

Branding-aware in this pass means only:

- join page
- customer wallet / customer shell
- customer-facing browser metadata and app identity where relevant
- customer-facing business-shared links

Not in scope:

- landing page
- merchant dashboard branding
- staff UI branding
- merchant onboarding visual rebrand
- custom domains
- self-serve domain onboarding
- custom layouts
- custom fonts
- custom CSS

This is intentionally a customer program identity foundation, not full tenant-level white-labeling.

## Architectural Principle

Branding changes presentation intensity, not product structure.

The application must remain:

- one shared app shell
- one set of routes
- one permission model
- one wallet structure
- one join structure
- one QR flow

Branding must not create per-tenant layout forks or route forks.

## Tenant Branding Model

Each business should have a customer-facing branding configuration with a narrow, validated surface.

Suggested fields:

- `branding_mode`
- `customer_program_name`
- `customer_logo_url`
- `primary_color`
- `accent_color`
- `neutral_theme`
- `powered_by_visible`
- `wallet_headline`
- `join_headline`

Design constraints:

- branding values must be validated server-side
- invalid or incomplete branding must fall back to safe platform defaults
- customer rendering must never fail because tenant branding is missing or broken

## Rendering Rules

Customer-facing branding resolution should work like this:

1. Customer arrives via tenant-specific route, primarily `/join/:slug`
2. App resolves the business/tenant
3. App loads branding configuration
4. App applies branding tokens and branding mode
5. If branding is missing or invalid, app renders using PuntosFieles defaults

Branding should affect:

- business/program name prominence
- logo display
- color tokens
- whether powered-by endorsement appears
- selected customer-facing headings
- customer shell metadata/title/icon identity where supported

Branding must not affect:

- route map
- security behavior
- auth model
- wallet information architecture
- permissions
- data semantics

## Public Entry And Linking Rules

The landing page should link to the actual app, but carefully.

Recommended behavior:

- strong CTA for businesses
- secondary entry for staff
- customer helper access available, but not the primary path

Customers should primarily arrive from business-provided entry points such as:

- QR
- WhatsApp
- SMS
- direct join links

That avoids a generic “find your business” dependency in the first version.

## Admin Controls For This Foundation

The initial merchant/admin controls should stay minimal and safe.

Allowed:

- customer-facing program name
- logo upload
- primary/accent color
- branding mode
- toggle for powered-by visibility
- join headline
- wallet headline
- preview for join and wallet

Not allowed yet:

- arbitrary CSS
- font selection
- custom component layout
- custom route structure
- domain configuration

This keeps implementation small while preserving the path to future white-label controls.

## Rollout Rules

Existing and new tenants should default to `endorsed_brand`, with platform defaults available as fallback.

Operational policy:

- `endorsed_brand` = recommended default
- `platform_led` = fallback/low-customization mode
- `white_label_ready` = present in the foundation, can be enabled manually later

The system should be able to support all three without requiring later structural rework.

## Testing Requirements

This foundation is only acceptable if it is regression-safe.

Required test coverage:

- branding config validation
- branding token fallback behavior
- rendering tests for each branding mode
- customer route tests confirming tenant branding loads correctly
- tests proving invalid branding cannot break customer access
- metadata/title/icon tests where the shell supports branding-aware identity

The testing objective is to prove that branding intensity can vary while the product structure remains stable.

## Implementation Notes

The first implementation pass now covers:

- validated branding config stored per business
- admin API + dashboard editor for customer-facing branding
- public business payloads with sanitized branding
- join + customer wallet shells using shared branding helpers
- strict fallback behavior when branding is missing or invalid

Still intentionally deferred:

- custom domains
- manifest/app-name per tenant
- merchant/staff shell branding
- arbitrary theming beyond validated tokens

## Future-Ready Boundaries

This foundation should make later work easier, specifically:

- subdomain-based tenant entry
- custom domains
- manual premium white-label enablement
- deeper business-facing brand controls

But this foundation should not implement those capabilities now.

The main success criterion is:

PuntosFieles can support multiple customer-facing branding intensities without becoming multiple products.

## Recommendation Summary

Build the customer-facing branding foundation now with:

- one shared app shell
- three branding modes in the data model
- customer-facing tenant branding only
- Spanish-first public/customer text
- `endorsed_brand` as the production default

Do not build full self-serve white-labeling, custom domains, or merchant/staff rebranding in this pass.
