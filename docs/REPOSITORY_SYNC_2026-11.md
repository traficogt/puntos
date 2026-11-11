# Repository synchronization — November 2026

This reconciliation preserves the 51 existing local commits after GitHub's
`main` and brings the previously local PuntosFieles source into version control.
It is a source review, not a production or native-app release.

## Included source

- The public website, Spanish routes, customer/staff browser screens and the
  merchant application, including its compiled assets.
- Loyalty operations, campaigns, cost controls, analytics, Wallet support,
  POS adapters, product/reward mapping, and the existing contact/order work.
- The maintained iOS/Android customer source, manual iOS cloud configuration,
  and local Linux Android builder. App release numbers remain unchanged.
- Reviewed dependency/toolchain updates, regression tests and public developer
  documentation. See [dependency results](dependencies/2026-11-11-upgrade-results.md).
- The credential-free Odoo 18 connector distribution used by the public API.
  CI verifies it against its source with
  `python3 integrations/odoo/build_package.py --check`.

Older hashed merchant assets are retained for compatibility with existing
browser caches. Their cleanup requires a separate cache-retention decision.

## Private material

Runtime environment files, credentials, signing material, native binaries,
private operational notes, research working files and local design-review
evidence remain outside Git. The ignore rules preserve those local files while
preventing accidental publication. Test fixtures and public download artifacts
are reviewed separately from credentials.

## Validation and release boundaries

The reconciliation checkout is checked with server unit tests, lint/typecheck,
merchant tests, migration-checksum/release checks, secret scans, and isolated
database/API integration tests. Check the pull request for the actual outcome of
each gate; a published branch does not itself establish production readiness.

The final local checks passed: 1,274 server unit tests, 125 merchant tests,
20 real database/API integration tests, two PWA tests and the Spanish
staff/customer offline browser fixture. Lint/typecheck, migration integrity,
fresh-database migration and restricted-role setup also passed. Secret scanning
covers the publication tree and preserved history; narrowly scoped allowances
recognize verified checksums, prose and synthetic test fixtures.

The fresh-checkout checks exposed an offline staff initialization failure.
The focused repair adds ten missing static dependencies, advances the web cache
to `pf-v47`, and tests transitive script coverage. API/data caching policies
remain unchanged.

GitHub push/PR workflows run Linux server, browser and container checks. Native
workflows remain manual. The publication tip and PR title use `[skip render]`
to suppress Render automatic deployments and previews during reconciliation.

Before merging or deploying, review the complete migration set and select the
intended release scope. The source includes previously unpublished contact and
order migrations; publication does not apply them to a live database. Confirm
deployment settings, backup/rollback readiness, and installed-client API
compatibility for the selected release.

The signed local Android verification used the unchanged 0.1.0 (13) baseline.
Its successful build does not certify a release using the updated JavaScript
build dependencies. A native release still requires its selected source build
and device acceptance. Expo SDK 58 remains deferred for the notification
privacy issue documented in the dependency results.
