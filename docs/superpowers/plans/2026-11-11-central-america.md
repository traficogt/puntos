# Central America regional coverage implementation plan

**Goal:** Make all seven Central American countries available consistently in business settings and related money, enrollment, POS, demo and reporting paths, without releasing native apps.

**Design:** Extend the existing country/currency catalog with Belize (BZ/BZD, America/Belize, +501) and Nicaragua (NI/NIO, America/Managua, +505). Keep Panama's USD default and offer PAB explicitly. Centralize static region metadata in a dependency-free shared module used by server and browser/demo; keep existing APIs additive and all prior countries/currencies supported. Preserve explicit international phone input outside Guatemala, currency locks after activity, no automatic FX conversion, and CLP zero-decimal behavior.

**Validation and implementation:**
- [x] Add failing coverage for all seven countries, three new currency codes, phone preservation, POS sales/refunds, formatting, timezone windows and database guards.
- [x] Share catalog across regional services, settings UI and demo; add new currency options and a forward migration for database allowlists.
- [x] Verify focused unit/merchant tests, PostgreSQL migration and immutable currency behavior, typecheck/lint/build, desktop/mobile settings with live and demo responses.
- [x] Independent review and scoped image release with verified backup, filtered migration lock, no unpublished routes/grants, no native modifications or builds.

**Source references (checked 2026-11-11):**
- Belize currency: https://www.centralbank.org.bz/
- Nicaragua currency: https://www.bcn.gob.ni/monedas-actuales
- Panama USD/balboa: https://www.tubalboaconsentido.gob.pa/sistema-financiero/index.html
- International dialing codes: https://www.itu.int/dms_pub/itu-t/opb/sp/T-SP-OB.930-2009-OAS-PDF-E.pdf

Published local prices, taxes, payment settlement support, country-specific marketing law, and native screen localization are outside this change. Supporting an operational currency does not imply FX conversion or payment processing.
