# Internal Staff Magic Links Design

Date: 2026-04-03

## Goal

Add internal-only one-time magic links for staff testing and support access.

This first pass is meant to reduce testing friction for staff and owner surfaces without turning magic links into a public product feature.

Supported targets:

- owner -> `/admin-dashboard`
- staff -> `/staff`

Supported generation entry points:

- `super` internal UI
- terminal/script

## Product Intent

This is an internal operational tool, not a customer-facing authentication system.

The link should:

- work once
- expire quickly
- bootstrap a normal staff browser session
- redirect the user to the correct destination

It should not become a parallel long-term auth model.

## Scope

### In scope

- one-time magic-link token storage
- secure token creation and consumption
- internal route for consuming staff magic links
- session bootstrap into the existing staff auth cookie
- `super` UI for generating links
- terminal script for generating links
- audit logging
- Spanish errors and operator copy

### Out of scope

- customer magic links
- public magic-link login
- email delivery
- owner-dashboard generation UI
- universal actor-type magic-link system

## Chosen Direction

This first pass is:

- internal-only in the UI
- architected cleanly enough to extend later if needed
- limited to staff actors and staff-owned surfaces

That gives immediate testing value without overcommitting the product.

## Token Model

Use a dedicated magic-link store rather than overloading sessions or verification codes.

Recommended fields:

- `id`
- `actor_type`
- `actor_id`
- `business_id`
- `target`
- `token_hash`
- `purpose`
- `created_by`
- `created_at`
- `expires_at`
- `used_at`
- `used_ip`
- `used_ua`

Values for this pass:

- `actor_type`: `staff`
- `purpose`: `internal_test_access`
- `target`: `staff` or `admin-dashboard`

Important rule:

- only the token hash is stored
- the raw token is shown once at creation time and never persisted in cleartext

## Consumption Flow

Recommended route shape:

- `/magic/staff/:token`

Flow:

1. Internal tool generates token and URL
2. User opens `/magic/staff/:token`
3. Server validates:
   - token exists
   - hash matches
   - token is unused
   - token is unexpired
   - token purpose is `internal_test_access`
   - actor and target combination is valid
4. Server creates the normal staff browser session cookie
5. Server marks the token used
6. Server redirects:
   - `staff` -> `/staff`
   - `admin-dashboard` -> `/admin-dashboard`

Important rule:

- the token is only for session bootstrap
- after consumption, the normal browser session model takes over

## Security Rules

Default safety rules:

- single-use only
- short expiry, default 10 to 15 minutes
- one token maps to one actor and one target
- invalid after consumption
- invalid after expiry
- Spanish error responses and error pages where applicable

Recommended audit events:

- magic link created
- magic link consumed
- magic link rejected (expired/used/invalid/forbidden target)

## Super UI

Expose generation as a small internal utility card inside `super`.

Inputs:

- `Negocio`
- `Usuario`
- `Destino`

Outputs:

- generated URL
- expiry timestamp
- copy action

Rules:

- list only staff actors (`OWNER`, `MANAGER`, `CASHIER`)
- `Panel` destination is only valid for `OWNER`
- non-owners should only be allowed to generate `Escáner`

Copy should stay blunt and internal:

- `Uso interno`
- `Un solo uso`
- `Expira pronto`

## Terminal Script

Add an ops script for quick generation without opening the UI.

Recommended shape:

- `node src/scripts/create-staff-magic-link.mjs --email owner@test.com --target admin-dashboard`
- `node src/scripts/create-staff-magic-link.mjs --staff-id <uuid> --target staff`

Rules:

- exactly one actor selector:
  - `--email`
  - or `--staff-id`
- target must be:
  - `staff`
  - or `admin-dashboard`
- invalid role/target combinations must fail

Output should include:

- resolved actor
- business
- destination
- expiry timestamp
- generated URL

Plain text output is enough for this pass.

## Server Behavior

The server-side creation and consume logic should live close to existing super/staff auth code, not in a generic platform abstraction yet.

Recommended boundaries:

- repository/service for magic-link persistence and validation
- super route for creating internal staff magic links
- public consume route for `/magic/staff/:token`

The consume route should reuse the existing staff auth cookie/session creation path as much as possible.

## Error Handling

All user-facing errors should be Spanish-first.

Examples:

- `Este enlace ya fue usado.`
- `Este enlace venció.`
- `Este enlace no es válido.`
- `Este usuario no puede abrir ese destino.`

The route should fail cleanly without leaking whether an internal user exists beyond what the token itself already implies.

## Testing And Verification

The implementation plan should include:

- repository/service tests for token creation, hashing, expiry, and one-time use
- route tests for successful consumption and redirect
- tests for invalid, expired, and reused tokens
- tests for invalid role/target combinations
- super UI contract coverage for the generator controls
- script verification for both `--email` and `--staff-id`

Manual verification should cover:

- owner link -> `/admin-dashboard`
- staff link -> `/staff`
- second click on same link fails
- expired link fails
- invalid target for non-owner fails

## Success Criteria

This pass is successful when:

- internal staff testing no longer depends on repeated manual login
- links are short-lived and single-use
- owner/staff destinations open correctly
- the normal staff session cookie is created on consume
- invalid or reused links fail safely in Spanish
- the feature is useful now without committing us to public magic-link auth
