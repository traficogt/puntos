# PuntosFieles

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

PuntosFieles is a self-hosted loyalty platform for Guatemala. Customers use digital cards and QR codes to earn points and redeem rewards. The public homepage invites business owners to request a demonstration.

## Users

Repository-derived context: business owners manage programs, rewards, staff, branches, and analytics; staff operate the checkout flow; customers access their loyalty card from a browser. The existing homepage addresses cafés, restaurants, and other businesses.

## Capabilities and Constraints

- Express, PostgreSQL, and vanilla HTML/CSS/JavaScript; preserve the existing architecture.
- Existing capabilities include rotating QR codes, rewards, tiers, referrals, challenges, analytics, and offline-capable web clients.
- Demo requests use `/api/public/contact` and Cloudflare Turnstile. Preserve this integration.
- The user confirmed that the redesign includes both the public homepage and application screens: customer wallet and access, staff operations, administration, and platform management. Preserve existing workflows and tenant branding.

## Brand Commitments

- The user explicitly requires keeping the existing fonts: Bricolage Grotesque, Fraunces, and Inter.
- Keep the PuntosFieles name, existing logo, Spanish language, and Viasolvia credit.
- The user requests a more modern design informed by Impeccable, current web design practices, and Awwwards examples.

## Evidence on Hand

`README.md`, `public/index.html`, `public/index.js`, and the application routes describe current functionality. Café Bourbon and its points balance are illustrative product-preview content, not customer evidence. No testimonials, customer counts, performance benchmarks, or pricing have been supplied.

## Open Decisions

No new business claims, pricing, customer endorsements, or changes to authentication and transaction behavior have been requested.
