# Research and launch handoff — 12 November 2026

## Design references inspected

- [Society of Operations Engineer](https://www.awwwards.com/sites/society-of-operations-engineer): member acquisition and portal entry are distinct, with clear membership hierarchy. This landing sells to organizations; no fictitious member-login entry.
- [Dwell](https://www.awwwards.com/sites/dwell-a-new-way-home): editorial typography and registration-focused narrative.
- [HoneyQuote](https://www.awwwards.com/sites/honeyquote): warm ground, strong primary action and explanatory progression.

Listings and gallery images inspected. Listings show nominee/voting content; no award-winning claim or artwork reused.

## Primary implementation guidance

- [Google SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide): descriptive title/description, visible HTML, readable headings, meaningful links and crawlable assets. Preview deliberately noindex and omitted from sitemap while identity is undecided. Canonical is temporary PF URL. Final launch needs canonical/OG and search visibility changes together; meta alone cannot override PF's non-public-route X-Robots-Tag.
- [Apple Wallet HIG](https://developer.apple.com/design/human-interface-guidelines/wallet): clear pass content and platform conventions. No imitation Add buttons without real save actions.
- [Google Generic Pass](https://developers.google.com/wallet/generic): membership cards supported; sensitive use cases may require Generic Private approval. Current PF issuance is loyalty-specific. This landing does not convert it into a production membership system.
- [Bootstrap 5.3](https://getbootstrap.com/docs/5.3/getting-started/introduction/): local pinned 5.3.8 CSS supplies grid and form primitives. No framework JavaScript needed. MIT license retained; development source-map comment removed.
- [Stripe Payment Links](https://docs.stripe.com/payment-links): hosted checkout can follow a salesperson's proposal. UI frameworks do not determine provider compatibility.
- [Stripe currencies](https://docs.stripe.com/currencies): GTQ presentment supported, subject to account/payment-method restrictions. GTQ uses two minor digits; American Express excludes starred currencies.
- [Stripe global availability](https://stripe.com/global): Guatemala not listed for standard account onboarding at research time. A GTQ price does not establish merchant eligibility.

## Stripe setup when the owner is ready

1. Confirm the eligible Stripe account and verified business; do not assume Guatemala standard onboarding is available.
2. Agree setup charge, recurring price, included members, limits, taxes, cancellation and refund terms. Compare costs/margins internally in USD; present agreed GTQ prices to this audience.
3. Create matching Stripe Product/Price and Payment Link or invoice. Use test mode for initial checkout checks. Sales can send quote-specific links; a public universal payment button is unnecessary.
4. Check amount, currency, recurrence, contact details, receipt and cancellation path. Never collect card details in PF or expose secret keys in assets.
5. Until payment webhooks and provisioning are implemented, confirm payment in Stripe manually before activation. A browser success redirect is not proof of payment.

No live checkout or automatic provisioning is implemented here. Prices and account access remain owner inputs.

## Membership pilot beyond this landing

Reuse signing/provider infrastructure, but add distinct membership records with organization scope, opaque QR reference, validity dates and revocation. Implement staff-authorized online verification with minimal fields, audit history and explicit offline/unknown result. Define spreadsheet import and update ownership. Do not infer identity from a copied QR. Test save, updates, expiry and revocation on actual Apple/Google devices before offering an operational pilot.

## Remaining launch inputs

Final brand/domain, WhatsApp number, prices and final legal disclosures. Form requests no member lists and sends a labeled PF Credenciales inquiry through the existing protected PF contact endpoint. Browser tests intercept the endpoint and never send email.
