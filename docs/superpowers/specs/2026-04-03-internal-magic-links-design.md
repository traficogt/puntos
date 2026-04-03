# Internal Magic Links Design

Date: 2026-04-03

## Goal

Add internal-only magic links that let you jump directly into existing test actors without repeated manual login.

This first pass supports:

- owner
- staff
- customer

Generation entry points:

- `super` internal UI
- terminal/script

This is an internal testing/support tool, not a public product-facing authentication feature.

## Product Intent

Magic links should remove testing friction while preserving the app’s real session model.

They should:

- create the normal browser session for the target actor
- land the actor in the correct destination
- be auditable
- expire quickly
- avoid public exposure

They should not become:

- a public passwordless login feature
- a signup shortcut
- a second long-term auth system

## Scope

### In scope

- internal-only magic links for owner, staff, and customer
- token storage with actor-aware and usage-aware behavior
- consume routes for staff and customer links
- session bootstrap into existing auth cookies
- `super` UI generator
- terminal/script generator
- audit logging
- Spanish error handling

### Out of scope

- public self-serve magic links
- email delivery
- signup via magic link
- universal passwordless auth rollout
- super-admin magic links

## Supported Actors And Destinations

### Owner

- actor type: `staff`
- valid destination: `/admin-dashboard`
- usage mode: `single_use`

### Staff

- actor type: `staff`
- valid destination: `/staff`
- usage mode: `single_use`

### Customer

- actor type: `customer`
- valid destination: `/c`
- usage mode: `reusable_window`

Important customer constraint:

- the link is only for an existing customer in an existing business
- it is not a signup or onboarding path

## Chosen Direction

Use one unified internal magic-link system with explicit actor and usage fields.

The system should support multiple actor types without pretending all actors behave the same:

- owner/staff links are single-use and short-lived
- customer links are reusable for a short window and business-bound

This gives immediate testing value without overbuilding a public auth platform.

## Unified Token Model

Use a dedicated token store.

Recommended fields:

- `id`
- `actor_type`
  - `staff`
  - `customer`
- `actor_id`
- `business_id`
- `target`
  - `staff`
  - `admin-dashboard`
  - `customer-wallet`
- `usage_mode`
  - `single_use`
  - `reusable_window`
- `purpose`
  - `internal_test_access`
- `token_hash`
- `created_by`
- `created_at`
- `expires_at`
- `used_at`
- `used_count`
- `used_ip`
- `used_ua`

Important rules:

- only the token hash is stored
- the raw token is shown once at creation time
- raw tokens are not recoverable later from the UI

## Consumption Routes

Recommended actor-specific consume routes:

- `/magic/staff/:token`
- `/magic/customer/:token`

This keeps session bootstrap logic clear and avoids mixing actor types in one opaque route.

### Staff route behavior

`/magic/staff/:token` validates that:

- token exists
- token hash matches
- token is unexpired
- token purpose is `internal_test_access`
- actor type is `staff`
- target is valid for the resolved staff actor
- token usage mode is respected

Then it:

- creates the normal staff browser session cookie
- marks the token used
- redirects to:
  - `/staff`
  - or `/admin-dashboard`

### Customer route behavior

`/magic/customer/:token` validates that:

- token exists
- token hash matches
- token is unexpired
- token purpose is `internal_test_access`
- actor type is `customer`
- customer belongs to the stored business
- target is `customer-wallet`
- token usage mode is respected

Then it:

- creates the normal customer browser session cookie
- increments usage metadata
- redirects directly to `/c`

Important customer rule:

- customer magic links should log into the existing wallet for that business
- they should not redirect through `/ingresar/:slug`

## Usage Rules

### Owner and staff

- `single_use`
- default expiry: 10 to 15 minutes
- one successful consumption invalidates the token

### Customer

- `reusable_window`
- default expiry: 10 to 15 minutes
- token may be reused within that window
- `used_count` should increment on each valid consumption

This split is intentional:

- single-use is safer for staff/admin testing
- reusable-window is more practical for repeated customer-wallet checks

## Super UI

Expose generation as one internal utility card in `super`.

Recommended actor modes:

- `Equipo`
- `Cliente`

### If `Equipo`

Inputs:

- `Negocio`
- `Usuario`
- `Destino`
  - `Escáner`
  - `Panel`

Rules:

- list only `OWNER`, `MANAGER`, `CASHIER`
- `Panel` is only valid for `OWNER`

### If `Cliente`

Inputs:

- `Negocio`
- `Cliente`
- destination is fixed to:
  - `Cartera`

Rules:

- customer must already exist in that business
- the UI should load customer options only after business selection

Outputs for both modes:

- generated URL
- expiry timestamp
- copy action

Copy should stay blunt:

- `Uso interno`
- `Un solo uso` for staff/owner
- `Reutilizable hasta vencer` for customer
- `Expira pronto`

## Terminal Script

Add an ops script for fast generation without the UI.

Recommended examples:

- `node src/scripts/create-magic-link.mjs --actor staff --email owner@test.com --target admin-dashboard`
- `node src/scripts/create-magic-link.mjs --actor staff --staff-id <uuid> --target staff`
- `node src/scripts/create-magic-link.mjs --actor customer --customer-id <uuid> --target customer-wallet`

Rules:

- exactly one actor selector path per invocation
- actor/target combinations must be validated
- invalid role/target combinations must fail

Output should include:

- actor type
- resolved actor
- business
- destination
- usage mode
- expiry timestamp
- generated URL

Plain text output is enough for this pass.

## Session Bootstrap Rules

The magic-link system should reuse the existing auth cookie/session model:

- staff magic links bootstrap the normal staff cookie
- customer magic links bootstrap the normal customer cookie

Magic links should not become persistent auth tokens themselves.

After consumption:

- the standard session model takes over
- logout behavior remains unchanged

## Audit Logging

Use the existing super-audit pattern plus magic-link specific events.

Recommended creation audit event:

- `super.magic_link.create`

Recommended consume/reject events:

- `magic_link.consume`
- `magic_link.reject`

Creation metadata should include:

- actor type
- actor id
- business id
- target
- usage mode
- expires at
- creator identity

Consumption/reject metadata should include:

- token id
- actor type
- business id
- target
- used count
- reject reason where applicable

## Error Handling

All user-facing errors should be Spanish-first.

Examples:

- `Este enlace ya fue usado.`
- `Este enlace venció.`
- `Este enlace no es válido.`
- `Este usuario no puede abrir ese destino.`
- `Este cliente no pertenece a ese negocio.`

Errors should fail safely without exposing unnecessary account discovery information.

## Testing And Verification

The implementation plan should include:

- token repository/service tests for creation, hashing, expiry, usage mode, and one-time use
- consume route tests for staff and customer links
- tests for invalid, expired, reused, and wrong actor/target combinations
- tests for customer reusable-window behavior
- super UI contract coverage for actor-mode generation controls
- script verification for staff and customer generation paths

Manual verification should cover:

- owner link -> `/admin-dashboard`
- staff link -> `/staff`
- customer link -> `/c`
- second click on owner/staff link fails
- repeated click on customer link works until expiry
- expired link fails
- invalid non-owner `Panel` target fails

## Success Criteria

This pass is successful when:

- internal testing no longer depends on repeated manual login
- owner, staff, and customer links land in the correct destination
- staff/owner links are single-use
- customer links are reusable only within a short window
- standard session cookies are created correctly
- invalid or expired links fail safely in Spanish
- the system is useful now without forcing a public magic-link product decision
