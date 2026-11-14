# Measurement release — November 14, 2026

All six approved improvements are live in the merchant website and backend. Open `/negocio/#ofertas` for merchant work or `/demostracion/#ofertas` for fictional examples.

- Receipt occurrence/provenance survives POS API, CSV, Loyverse and new Odoo queue payloads; old request contracts remain accepted. Ledger ingestion time is immutable. Imported receipts without their original date are explicitly limited.
- Fixed experimental design and sample preview use meaningful lift, baseline assumptions, separate observation/reconciliation days, and optional balanced allocation.
- Original assigned denominators, frozen preperiod snapshots, observed receipt linkage, overlap, missing dates and refund diagnostics remain visible.
- Owner-entered direct costs distinguish unknown from zero and incurred expenses from outstanding commitments. Contribution is a descriptive estimate with stated assumptions.
- Post-offer follow-up retains original groups and does not alter promised benefit validity.
- A conservative decision leads the report. Saved cuts and cost corrections append immutable revisions; current facts can be compared with earlier cuts.

See [the measurement contract](CAMPAIGN_MEASUREMENT_ES.md) for formulas, source limitations and endpoints.

## Release verification

Measurement release source: `b171569d05f89caba05fceae583b6e67f117a976` (API and worker). The API subsequently received the packaging/reference follow-up from `7dd2da964d2a52ec870a67137a6778bee4344ca9`; the worker stayed on the measurement image. That follow-up publishes Odoo connector 18.0.3.0.1 and the regenerated API reference, without another database migration. The public ZIP was downloaded and its version, integrity and SHA-256 verified against the committed package.

The 1,374 backend tests and 136 merchant tests passed. Full-schema measurement tests exercised actual PostgreSQL semantics and the generated non-owner runtime role. Campaign locking/idempotency regressions, purchase-time RLS/immutability, Odoo unit tests, typecheck, lint and migration checksum validation passed. Browser flows covered planning, draft creation, costs, immutable saved cuts, unknown dates, reconciliation, both themes and 390/1440-pixel widths; accessibility checks found no violations in the tested flows.

A verified production backup preceded the two additive migrations. API and worker became healthy; runtime permissions and the report query were verified through the non-superuser account. There were no existing production campaign reports to inspect. Live desktop/mobile demo checks passed. PF apex/www, support, owner entry, demo, guide hub, first article, sitemap and Pertenece responded as expected. The next scheduled article remained 404 and the original six-article schedule was preserved.

No real campaign was launched or customer message sent by this work. Native app source, versions and builds were unchanged. Existing installed APIs are additive and backward compatible. The optional Odoo adapter source is updated; already-installed external Odoo modules must be deliberately updated to send the new optional date, and no remote merchant deployment is claimed.

Remaining real-world measurement limits are explicit product behavior: PF cannot prove a POS sent every purchase, unidentified receipts cannot be assigned to an experimental arm, missing cost inputs remain unknown, and descriptive sales/contribution differences are not causal profit estimates. No merchant-effectiveness result is claimed by the release tests.
