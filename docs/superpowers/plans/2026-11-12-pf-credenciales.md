# PF Credenciales landing implementation plan

**Goal:** A Spanish sales-support landing for membership organizations in Guatemala, under a working name approved by the owner. Prices remain unpublished.

**Architecture:** Add an isolated static surface at `/credenciales/` with locally hosted Bootstrap CSS and existing PF fonts. Reuse `/api/public/contact` with Turnstile; prefix inquiries so sales can distinguish membership prospects. No membership, payment, or native release write paths change.

**Implementation and acceptance**

- [x] Build `public/credenciales/index.html`, `credenciales.css`, and `credenciales.js`: outcome-first hero, labeled interactive sample credential, three-step owner journey, relevant organizations, verification limitations, Guatemala support, quote-based pricing, demo form and FAQ.
- [x] Add scoped design/research notes and local Bootstrap license. Preserve PF's global design. Working-name preview uses `noindex, follow`; no fake prices, customer logos, review stars, live checkout, dashboard or membership-verification claims.
- [x] Reuse the protected contact service. Require consent, validate fields, include organization/member-count context, retain input after failure, prevent duplicate requests, and expose loading/success/error states. Never send email as a test.
- [x] Payment architecture: salesperson agrees scope and GTQ price, then shares a Stripe-hosted Payment Link. Account eligibility and prices remain owner dependencies. Do not collect card details or publish a simulated payment button.
- [x] Test at 360, 390, 768 and 1440px, keyboard operation, reduced motion, no-JS readability, simulated verification states, form validation and mocked success/failure/timeout. Check assets, metadata, overflow and JS errors. Browser evidence does not verify actual Wallet saves or membership validation.
- [x] Review rendered surface with a fresh reviewer, fix material findings, retain website-only changes on feature branch, and make the result available for review.

**Research applied:** Google Search Central SEO starter guidance; Apple Wallet HIG; Google Generic Pass overview; Bootstrap 5.3; Stripe Payment Links, currencies and global availability. Awwwards examples are inspiration only; no assets or endorsements copied.

**Open owner inputs:** final name/domain, WhatsApp number, prices and eligible Stripe account. Working name is authorized. Existing PF support email is an explicitly PF contact fallback until the new service has its own contact details.

Validation: 11 browser scenario groups passed across four widths, with zero production writes or sent test email. JavaScript syntax, scoped ESLint and diff whitespace checks passed. Independent reviewer scored all four findings resolved after contrast, focus and copy corrections. Live desktop/mobile checks pass. Evidence: `/var/lib/puntos/releases/credenciales-20261112/browser/`.

Working preview: https://puntosfieles.com/credenciales/ (noindex). Draft PR: https://github.com/traficogt/puntos/pull/2. API-only static overlay image deployed; existing worker/database containers unchanged. No native build, update or workflow started. Stripe checkout and actual membership verification remain separate launch work, not simulated production functionality.
