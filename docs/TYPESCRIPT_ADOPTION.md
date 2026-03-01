# TypeScript Adoption (Phased)

This codebase is JavaScript-first, but now includes `jsconfig.json` with `checkJs: true` as a low-risk first step.

## Phase 1 (now)

- Enable editor/static checks for `.js` files via `jsconfig.json`.
- Keep runtime unchanged (no build system change).
- Focus type fixes in security-critical paths first.

## Phase 2

- Add JSDoc typedefs for:
  - request context (`req.staff`, `req.customerAuth`, `req.superAdmin`)
  - repository return shapes
  - common DTOs (reward, branch, customer, transaction)
- Add a focused CI gate for typed modules:
  - `npm run typecheck:focused` (currently `app/routes/super-routes.js`, `app/routes/customer-routes.js`, `app/routes/gift-card-routes.js`, `app/routes/tier-routes.js`, `app/routes/referral-routes.js`)
  - expand file coverage gradually as typing debt is reduced.

## Phase 3

- Convert high-value modules to `.ts` incrementally:
  1. `middleware/`
  2. `app/routes/`
  3. `app/services/`
- Keep `public/` JavaScript until backend conversion stabilizes.

## Phase 4

- Enforce CI type-check gate and stricter TS settings.
- Expand to frontend bundles when desired.
