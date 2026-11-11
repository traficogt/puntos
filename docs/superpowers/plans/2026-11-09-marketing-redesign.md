# PuntosFieles Homepage Redesign Implementation Plan

**Goal:** Modernize the public homepage and application screens while retaining font families, product truth, and working integrations.

**Architecture:** Retain Express and static HTML. Give the homepage its own stylesheet, semantic layout, and small progressive-enhancement script. Keep authenticated routes and shared styles unchanged.

**Tech Stack:** HTML, CSS, JavaScript, Playwright, Node test runner.

- [x] Record current desktop/mobile appearance and inspect Awwwards references.
- [x] Add browser checks for the interactive loyalty demonstration and contact request outcomes; run the demonstration check before implementation to confirm it fails for the missing control.
- [x] Replace `public/index.html` with the new homepage, keeping contact field IDs and endpoint-compatible form structure.
- [x] Add `public/styles/marketing.css` and local coffee imagery. Preserve all three existing font families and use no new runtime dependencies.
- [x] Enhance `public/index.js` with a keyboard-accessible points demonstration and field-specific validation; preserve Turnstile and server integration.
- [x] Redesign customer/auth screens in their own stylesheet, preserving tenant branding and all identifiers.
- [x] Redesign staff/admin/platform screens in their own stylesheet, preserving operational controls and all identifiers.
- [x] Update offline asset caching for the new styles and verify dark/light application states at desktop and mobile widths.
- [x] Update outdated homepage smoke assertions to the current product and font requirements.
- [x] Run browser checks at desktop and mobile sizes, with JavaScript disabled and reduced motion enabled; capture and inspect full-page screenshots.
- [x] Run unit tests, typecheck, focused lint, and a final diff review. Record any unrelated baseline failures and provide a reviewable local result.

## Verification outcome

- 406 unit tests passed.
- 12 homepage browser checks passed across Chromium and Firefox, including demonstration, contact validation/payload, navigation, FAQ, no-JavaScript behavior, and 320px overflow checks.
- Customer/auth: 20 desktop/mobile/theme combinations, QR/refresh/code-entry/recovery flows and tenant-branding checks passed with browser API fixtures.
- Operations: 12 desktop/mobile/theme combinations, admin tab navigation, role restrictions, theme toggles, and both point-rule shortcuts passed with browser API fixtures.
- Changed JavaScript and tests pass ESLint; git diff has no whitespace errors.
- Typecheck reports 61 errors, identical to a clean HEAD archive; no new errors.
- Isolated full-stack visual verification was attempted, but the API cannot start because the existing migration path references missing table `ledger_balance_corrections`. Existing database-backed screenshot baselines could not be regenerated.
- Homepage and legal-page screenshots were reviewed locally. Live camera hardware, real transactions and production deployment were not exercised.

Independent final review: both discovered application regressions were fixed and rechecked. Admin point-rule shortcuts open their disclosure. Platform console fits 320px, with a full-width plan selector and visible action buttons. No outstanding review findings.

## Production deployment — 2026-11-09

- User approved deployment to the live site. Published to `https://puntosfieles.com` and `https://app.puntosfieles.com`.
- Deployed 30 reviewed frontend files as image `puntos-api:impeccable-20261109`, layered onto the previously running API image. The checkout contains unrelated backend changes, so this release preserves the running backend, dependencies, configuration, database, and worker. All modified frontend files matched the running release before the redesign diff.
- Fresh verification: 406 unit tests passed; 8 Chromium/Firefox checks passed against files extracted from the release image; live browser checks passed for the homepage at 1440px/390px and the business signup, staff login, customer wallet entry, and platform console at 390px, with no JavaScript errors or horizontal overflow.
- The origin smoke gate passed. All 30 deployed files match the release at the origin and public domains, accounting for Cloudflare's email-protection transformation on legal pages. Both domains pass health, readiness, and liveness checks; the worker remains healthy. Authenticated production transactions were not exercised.
- Release manifest, before/after snapshots, verification reports, test logs, packaged frontend sources, and rollback script are retained in `/var/lib/puntos/releases/impeccable-20261109/`. The prior API image is preserved as `puntos-api:before-impeccable-20261109`.
- To restore the previous frontend release: `bash /var/lib/puntos/releases/impeccable-20261109/rollback.sh`. A future full-source rebuild must separately validate the checkout's backend and migration changes.
