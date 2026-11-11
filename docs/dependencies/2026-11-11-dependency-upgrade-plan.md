# Puntos Dependency Upgrade Preparation Plan

> **For implementation after authorization:** Use `superpowers:executing-plans` to work through the phases below. This document prepares the work; it does not authorize upgrades, releases, or cloud builds.

**Goal:** Update Puntos to supported, stable dependencies in reviewable batches while preserving existing website, API, stored-data and installed-app behavior.

**Architecture:** Keep the root server, merchant browser application and Expo customer application as three independently locked projects. Ship website/server work first; schedule native dependency work only when explicitly requested. Keep database and infrastructure migrations separate from package updates.

**Tech stack:** Node/Express/PostgreSQL, React/Mantine/Vite, Expo 57/React Native, CocoaPods/Android Gradle, Odoo 18.

**Data as of:** 11 November 2026, beginning 17:11 UTC. All versions below are observed stable releases, not prerelease tags. Recheck before implementation. The companion [machine inventory](2026-11-11-dependency-inventory.json) records every direct dependency, declaration, installed/locked version, current registry target, constraints, audit findings, manifest hashes, toolchain inputs and evidence hashes.

## What was prepared

This audit changed only the new dependency documents and preparation evidence. It did not install packages, change manifests/lockfiles/source/app versions, run heavy tests, resolve pods, build apps, deploy, access production data/providers, or trigger cloud workflows. The Android baseline build running separately is outside this audit.

| Project | Direct runtime / development | Locked package entries¹ | Audit: all dependencies | Audit: production classification |
| --- | ---: | ---: | --- | --- |
| Root `package.json` | 22 / 10 | 278 | 1 high | 1 high |
| `web/merchant/package.json` | 7 / 5 | 121 | 0 | 0 |
| `apps/customer/package.json` | 28 / 5 | 892 | 11 moderate | 4 moderate |

¹ Excludes each lockfile's root entry; includes nested/optional package entries. There are 77 direct entries across the three projects and 1,291 locked entries. The customer result represents **two underlying advisories**, expanded through dependency parents, not eleven distinct vulnerabilities. All direct installed versions match their locks; static semver checks found no direct manifest/lock or Expo 57 bundled-version mismatch.

Coverage also includes `ios/Podfile`, `Podfile.lock` (185 entries including subspecs, 114 top-level pods), Android generated wrapper and RN catalog inputs, `.nvmrc`, EAS/Codemagic, Docker/Compose, all four GitHub workflow files, and both Odoo add-on manifests. No additional Python requirements, Ruby Gemfile, pnpm/yarn/bun lock, or independent dependency manifest was found outside excluded generated/vendor directories. Odoo's `requests` dependency comes from its host/image, with no project Python lock. The Android directory is generated outside the canonical checkout.

Read-only commands were `npm outdated --json --long`, `npm audit --package-lock-only --json`, and the same audit with `--omit=dev`, for each npm project. Raw results are in `/var/lib/puntos/releases/dependency-preparation-20261111/`. Nonzero audit/outdated status means findings, not a failed installation. These are npm advisory checks, not an OS, Maven, CocoaPods or deployed-binary security certification.

## Priorities and security constraints

**1. Remove Node 20 from CI and set a consistent supported server/web toolchain.** All four workflow files still select Node 20; the root engine allows it. Node 20 reached EOL on 30 April 2026. The host/native pin is 22.22.2; the Dockerfile uses floating `node:24-alpine`. Observed patched LTS releases are **22.23.5**, **24.22.3**, and **26.13.1**. Start server/web CI with Node **24.22.3**, consistent with the existing Docker major. Node 26 is a separate tested option. Exclude Node 27 alpha. Update the native 22.x pin only in the native phase. [Node release schedule](https://github.com/nodejs/Release/blob/main/schedule.json), [official release index](https://nodejs.org/dist/index.json).

**2. Plan a deliberate Zod 4 migration.** Root locks Zod **3.25.1**. [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) identifies versions **below 4.6.6** as affected; **4.6.6** is the first patched release. The registry's latest 3.x is **3.25.76**, which remains within the advisory range. No compatible 3.x security backport was found. The candidate is **4.6.7**, not an automatic `audit fix --force` change. [Zod registry](https://registry.npmjs.org/zod), [migration guide](https://zod.dev/v4/changelog).

The current source already applies a JSON byte limit and `requestComplexityLimit` before routing in `src/app/server.js`; this reduces request-validation exposure. It does not remove the vulnerable version or prove every validation entry point is covered. Preserve these controls. Concrete migration work includes `error.errors` in `src/utils/schemas.js`, shared validation/error formatting, `z.record` calls, defaults/coercion/refinements, and schema generation. Keep existing API acceptance rules and Spanish error response structure.

`zod-to-json-schema` **3.25.1** permits peer Zod `^3.25 || ^4`; **3.25.2** permits `^3.25.28 || ^4`. That peer range does **not** mean it handles Zod 4 schemas: its maintainer requires v3 schemas and has archived the project. Replace the converter in `src/scripts/generate-openapi.mjs` with Zod's supported JSON Schema conversion, carefully preserving OpenAPI targets, references, input transformations and required fields. Importing `zod/v3` merely to preserve the old converter is not an established advisory remediation. [Converter maintenance/API notice](https://github.com/StefanTerdell/zod-to-json-schema), [Zod JSON Schema](https://zod.dev/json-schema).

**3. Treat native audit fixes as an SDK compatibility task.** The affected tree contains nested `glob` **13.0.7** through `@expo/fingerprint` **0.20.15**, and `minimatch` **10.2.6** through fingerprint/glob and TypeScript ESLint tooling. First patched versions are glob **14.0.2** and minimatch **11.0.1**; current stable candidates are **14.0.4** and **11.0.8**. These cross upstream dependency ranges. [Glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).

The production-classified paths are Expo fingerprint/build tooling; their presence in `--omit=dev` does not establish that they are bundled into the installed mobile runtime. Check actual usage when implementing. npm's suggested Expo **52.0.49** and `eslint-config-expo` **6.0.0** are incompatible downgrades and must be rejected. SDK 58's fingerprint **0.21.10** still requests minimatch `^10.2.6`, so an SDK upgrade alone is not a verified fix. Prefer upstream fixes; if a scoped override is needed, prove fingerprint determinism, exports, lint and native compatibility before adopting it. Do not impose global cross-major glob/minimatch overrides across the whole tree.

## Upgrade matrix

“Same line” means a candidate expected to require less migration work, not verified compatibility or a promise that the line remains supported. Most root/web versions are exact pins, so `npm outdated` reports `wanted = current`; that does not mean there are no updates. Full per-package details are in the inventory. Version observations below come from the [official npm registry](https://registry.npmjs.org/), with exact package URLs recorded per entry.

### Server runtime dependencies

| Dependency | Locked | Same-line candidate | Separate migration / decision |
| --- | --- | --- | --- |
| argon2 | 0.44.0 | retain | 0.45.2; 0.x minor may break native-addon behavior |
| bcryptjs | 2.4.3 | retain | 3.0.3; preserve old password hash verification |
| cookie-parser | 1.4.7 | current | retain |
| cors | 2.8.5 | 2.8.6 | check credentialed browser/mobile-origin behavior |
| csv-stringify | 6.5.1 | 6.9.0 | check exported CSV content/escaping |
| dotenv | 16.4.7 | 16.6.1 | 18.0.10 later; environment precedence/startup |
| express | 4.22.1 | 4.22.3 | 5.3.0 later; route/query/error behavior |
| helmet | 7.1.0 | 7.2.0 | 8.3.0 later; CSP/headers and browser assets |
| jose | 6.1.3 | 6.2.17 | preserve tokens, claims and wallet signatures |
| luxon | 3.7.2 | current | retain |
| nanoid | 5.1.16 | current | 6.0.2 later; preserve stored identifiers |
| node-cron | 4.6.0 | current | retain |
| nodemailer | 10.4.0 | 10.5.0 | mock transport only during verification |
| passkit-generator | 3.7.0 | current | retain Joi override; offline pass tests |
| pg | 8.13.1 | 8.23.1 | pools, transactions, RLS and idempotency |
| pino / pino-http | 9.6.0 / 10.3.0 | 9.14.0 / 10.5.0 | 10.4.0 / 11.0.0 as a separate pair |
| prom-client | 15.1.3 | deprecated name | migrate to `@prometheus-io/client` 0.16.1 |
| qrcode | 1.5.4 | current | retain |
| redis client | 4.6.13 | 4.7.1 | 6.3.1 later; review intervening client majors |
| swagger-ui-express | 5.0.1 | current | retain; verify generated OpenAPI |
| zod | 3.25.1 | 3.25.76 is **still affected** | prioritize 4.6.7 with converter migration |

The Prometheus package was transferred/renamed and is deprecated under `prom-client`; the maintained successor has a different name and a 0.x version. Preserve metric names, labels, privacy and alert queries during that migration. [Prometheus client repository and upgrade notice](https://github.com/prometheus/client_js).

Preserve root overrides **`qs: 6.16.2`** and **`joi: 17.13.9`** initially. `qs` 6.17.1 is a later parsing-compatibility candidate; Express currently asks for `~6.14.0` and body-parser for `~6.16.0`. Joi 17.13.9 is already the latest 17.x, overriding passkit-generator's exact 17.13.4. Do not replace it with Joi 18.3.2 or remove either override until the resolved upstream graph is safe and relevant tests pass. Neither overridden package is flagged by the current audit.

### Development and browser dependencies

| Dependency/group | Locked | Candidate and constraint |
| --- | --- | --- |
| Root ESLint / `@eslint/js` | 9.39.2 / 9.39.2 | 10.14.0 / 10.0.1 with plugin review; 9.39.5 is only an EOL intermediate |
| `eslint-plugin-security` / globals | 3.0.1 / 17.3.0 | 4.2.1 / 17.14.0; preserve security rules |
| Root TypeScript | 5.9.3 | stage 6.0.3, then assess 7.0.2 separately |
| Root `@types/node` | 25.2.0 | align to Node 24: 24.19.2; latest 26.6.6 is not the runtime target |
| Express / core types | 5.0.6 / 5.1.1 | current types mismatch runtime 4; consider 4.17.25 / 4.19.9 with Express 4, or 5.0.6 / 5.1.3 with Express 5 |
| `zod-to-json-schema` | 3.25.1 | replace during Zod migration; 3.25.2 alone does not solve v4 schema compatibility |
| Playwright | 1.58.1 | 1.65.0 with matching browser binaries and supported Docker image |
| Merchant React / React DOM | 19.2.0 / 19.2.0 | 19.3.1 / 19.3.1 together; Mantine peers allow `^19.2.0` |
| Merchant Vite / React plugin | 8.3.7 / 6.3.0 | 8.3.8 / 6.3.0; plugin requires Vite 8; Node 24 satisfies engines |
| Mantine core, hooks, form, charts | all 9.8.0 | already latest; retain identical versions |
| Recharts | 3.10.1 | already latest |
| resvg / axe-core / jsqr | 2.6.2 / 4.14.0 / 1.4.0 | already latest |

ESLint 9 is no longer supported, including the native application's 9.39.5. A patch-only bump is not the final support outcome. Native ESLint must remain compatible with Expo's parser/plugins. [ESLint support policy](https://eslint.org/version-support/), [ESLint 10 migration](https://eslint.org/docs/latest/use/migrate-to-10.0.0). Playwright's package and image/browser versions need to match. [Playwright Docker guidance](https://playwright.dev/docs/docker).

### Native dependencies — deferred

The installed baseline remains **iOS 0.1.0 (3)** and **Android 0.1.0 (13)**. Current SDK 57 dependencies match the inspected SDK 57 bundle. Do not independently move React, React Native, Worklets, Reanimated, SVG, AsyncStorage or Expo modules to their npm `latest` versions. [Versioned SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/), [SDK upgrade workflow](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/).

The next stable SDK candidate is **Expo 58.0.24**. The table below uses its actual `bundledNativeModules.json` read from the [official package tarball](https://registry.npmjs.org/expo/-/expo-58.0.24.tgz), rather than assuming that every latest package belongs together.

| Group | Current locked | SDK 58 candidate / constraint |
| --- | --- | --- |
| Expo | 57.0.32 | 58.0.24 |
| React / React DOM | 19.2.3 | **19.3.0**, although upstream latest is 19.3.1 |
| React Native | 0.86.3 | 0.88.1 |
| Reanimated / Worklets | 4.5.1 / 0.10.1 | 4.7.1 / **0.13.0**, not latest Worklets 0.13.1 |
| Safe area / screens | 5.7.0 / 4.26.2 | ~5.11.1 / ~4.30.1 |
| SVG | 15.15.4 | **15.16.0**, not latest 15.16.1 |
| AsyncStorage / NetInfo | 2.2.0 / 12.0.1 | retain both; latest AsyncStorage 3.1.1 is outside the bundle |
| React Native Web | 0.21.4 | ~0.21.4 |
| Expo constants / crypto / dev-client / device | 57.0.23 / 57.0.4 / 57.0.21 / 57.0.2 | ~58.0.16 / ~58.0.8 / ~58.0.19 / ~58.0.5 |
| Expo font / linking / notifications / router | 57.0.4 / 57.0.13 / 57.0.25 / 57.0.30 | ~58.0.12 / ~58.0.17 / ~58.1.9 / ~58.0.31 |
| Expo secure-store / status-bar / system-ui | 57.0.4 / 57.0.1 / 57.0.4 | ~58.0.3 / ~58.0.5 / ~58.0.7 |
| Expo ESLint config / TypeScript | 57.0.2 / 6.0.3 | ~58.0.4; assess compiler and parser compatibility separately |
| Fonts, vector icons, QR package | current | already latest; retain unless the chosen SDK says otherwise |

Keep **query-string 7.1.3**, **decode-uri-component 0.5.1**, and `scripts/patch-query-string.mjs` together. Expo Router requires the query-string 7 CommonJS API; the postinstall patch adapts the decoder's ESM default export and explicitly rejects a different query-string version. Latest query-string 10.0.0 is a major API/module change. Re-evaluate the patch only after checking the chosen Router version's dependency graph; verify fresh install and repeat-patch behavior in the authorized upgrade branch.

SDK 58 adds concrete review work: React Native's stricter type API and removals, iOS scene lifecycle/native project changes, changed web safe-area handling, and release R8 defaults on Android. Expo 58 tooling supports Node 22.13+, 24.3+, or supported newer lines; the current Node 22 pin already satisfies that floor but is behind security patches. Do not enable preview SwiftPM or experimental toolchains as part of this task. [SDK 58 release notes](https://expo.dev/changelog/sdk-58). SDK 57 also needs deliberate scene support if later built with Xcode 27; do not simply bump the Xcode selector. [SDK 57 release notes](https://expo.dev/changelog/sdk-57).

### Native toolchains and infrastructure

| Area | Current observed input | Prepared decision |
| --- | --- | --- |
| Android wrapper / RN catalog | Gradle 9.3.1; AGP 8.12.0; Kotlin 2.1.20 | keep SDK-selected unit; upstream Gradle 9.9.1 is not an independent target |
| Android platform | min 24, compile/target 36, build-tools 36.0.0 | preserve until SDK/native release review |
| Native compiler tools | Java 17; NDK 27.1.12297006; CMake 3.22.1 | preserve reviewed bundle; no downloads/builds from this plan |
| Android packaging | bundletool 1.18.3 with SHA-256 | already latest stable |
| Local Android builder | digest-pinned Temurin 17; Node 22.22.2; checksum-pinned command-line tools | coordinate later security patch/hash updates with `.nvmrc` and launcher |
| iOS | Xcode 26.6; minimum iOS 16.4; Podfile.lock generated by CocoaPods 1.16.2 | upstream CocoaPods 1.17.0 is a candidate; replace floating `cocoapods: default` with a tested version during requested iOS work |
| EAS CLI | `>=16.0.0`, not exact | stable 27.7.2 observed; pin only if that release workflow is requested |
| PostgreSQL | `postgres:16-alpine`, exact running version not queried | supported 16.x candidate 16.15; 18.6 is separate major migration, not part of npm batch |
| Redis server | `redis:7-alpine` in isolated E2E | separate from npm redis client; stable server 8.10.3 observed, no server upgrade authorized |
| Odoo | connector 18.0.3.0.0; fixture 18.0.1.0.0; Odoo 18 image digest | preserve Odoo 18; inventory actual image Python/requests before change; `requests` stable 2.34.2 needs Python ≥3.10 |

The wrapper was read from the existing isolated builder, not generated by this audit. Catalog entries are source pins, not a claim about all resolved Maven artifacts. [AGP 8.12 compatibility](https://developer.android.com/build/releases/agp-8-12-0-release-notes), [Gradle stable endpoint](https://services.gradle.org/versions/current), [CocoaPods registry](https://rubygems.org/api/v1/gems/cocoapods.json). PostgreSQL 16 remains supported through November 2028; major upgrades require a database migration and data-aware rollback. [PostgreSQL version policy](https://www.postgresql.org/support/versioning/).

CI dependency candidates, verified from publisher releases, are [checkout **v4 → v7.0.1**](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node **v4 → v7.1.0**](https://github.com/actions/setup-node/releases/tag/v7.1.0), [upload-artifact **v4 → v7.0.2**](https://github.com/actions/upload-artifact/releases/tag/v7.0.2), [github-script **v7 → v9.0.0**](https://github.com/actions/github-script/releases/tag/v9.0.0), [gitleaks-action **v2 → v3.0.0**](https://github.com/gitleaks/gitleaks-action/releases/tag/v3.0.0), [mail action **v3 → v24**](https://github.com/dawidd6/action-send-mail/releases/tag/v24), and [Trivy **0.56.1 → 0.76.2**](https://github.com/aquasecurity/trivy/releases/tag/v0.76.2). These are review targets: inspect changed inputs, runner versions and permissions, then pin reviewed commit/image digests. An action's embedded Node runtime is separate from `setup-node`'s selected application runtime; changing `node-version` alone is insufficient. Gitleaks v3 specifically moves its action runtime from Node 20 to Node 24. Preserve existing triggers; do not start workflows during preparation. The legacy [Semgrep action is deprecated](https://github.com/returntocorp/semgrep-action); plan its replacement with the official CLI/container integration instead of inventing a new version of that action.

## Ordered implementation phases

These checkboxes are intentionally open. No upgrade phase was executed.

### Phase 0 — capture a releasable baseline and align Node

- [ ] Create an isolated upgrade branch from the **approved release source**, preserving current manifests, all locks, image digests and static assets. `/opt/puntos` is a large dirty working tree; a checkout-wide deployment would include unrelated work.
- [ ] Reconcile the live `wallet-server-refresh-20261111` release's **66 migrations** against the checkout's **73 SQL files**. Keep the seven unpublished migrations and unrelated order/contact routes out of dependency-only releases; do not run migration commands on production.
- [ ] Align root/server/web CI and local validation to Node **24.22.3** and an explicitly recorded npm version; update root engine/types policy and Docker image digest together. Start with the bundled npm version; npm 12.2.2 is a separate resolver/lockfile change.
- [ ] Update obsolete action runtimes required to execute CI, including the Gitleaks v2 → v3 transition; verify the chosen runner supports their Node runtime. Review setup-node authentication/cache changes and github-script's ESM changes before updating those actions. Remaining scanner/action modernization can follow in Phase 4.
- [ ] Record current baseline test counts and audit results. Root 1,259, merchant 125 and native 94 are historical counts reported by prior work, **not fresh results from this audit**. Parent launcher changes may increase the native count.

Files for review: root `package.json`, `package-lock.json`, `Dockerfile`, `.github/workflows/{ci,release-gate,nightly-e2e,design-screenshots}.yml`. Preserve native pins in this phase.

### Phase 1 — resolve the Zod security migration

- [ ] Pin Zod **4.6.7** in the isolated root project; review validation imports throughout `src/`, especially `src/utils/{schemas,validation}.js` and route/service schemas. Preserve valid old-client requests and existing error/status contracts.
- [ ] Replace `zod-to-json-schema` in `src/scripts/generate-openapi.mjs` with the supported Zod converter; compare generated `docs/openapi.json` and `docs/openapi.yaml` semantically. Check transformed inputs, defaults, references, nullable/optional fields and parameter schemas.
- [ ] Preserve request-complexity limits and use existing normal boundary tests. Validate mobile auth/session, rewards, POS and wallet contracts against disposable fixtures. Do not use production requests to assess the advisory.
- [ ] Run root lint/typecheck/unit and isolated integration gates, regenerate OpenAPI, then rerun both audits. Do not declare the advisory closed solely because a package version changed or because a v3 import hides the breaking migration.

### Phase 2 — compatible server updates

- [ ] Apply the same-line server candidates in small related batches: request middleware, data/export, authentication/wallet, logging, and database/cache clients. Keep the Zod migration separate for clear review and rollback.
- [ ] Retain the qs/Joi overrides until each upstream graph is inspected. Align Express types to the retained runtime intentionally; do not confuse the existing type major with a runtime upgrade.
- [ ] Verify existing password hashes/tokens, credentialed CORS, CSRF/error handling, wallet serialization, CSV exports, redacted logs, transaction isolation, duplicate request handling and Redis reconnect/shutdown with local fixtures.
- [ ] Run root gates and inspect resolved dependency/audit changes after each batch. Keep API and stored-data formats backward compatible with the installed iOS/Android baseline.

### Phase 3 — merchant web and browser tooling

- [ ] Update merchant React/DOM together to **19.3.1**, then Vite to **8.3.8**. Keep Mantine packages together at **9.8.0**. Review `web/merchant/package*.json` and generated `public/merchant` output.
- [ ] Run merchant tests and build; inspect third-party notices, hashed assets, route fallback and service-worker/browser caching behavior. The build's notices script is part of the release gate.
- [ ] Update Playwright to **1.65.0** in a separate change with matching browser/image versions. Run local isolated browser flows for owner, staff and customer login/session, navigation, forms, chart/QR rendering, accessibility and mobile-sized layouts. Review visual differences instead of automatically accepting snapshots.
- [ ] Package a website-only candidate that passes the root and browser gates; release remains a separate authorized action and must not require an app update.

### Phase 4 — remaining majors and infrastructure

- [ ] Migrate **Express 5.3.0** separately, reviewing routing, query/body parsing and asynchronous errors before advancing. [Express migration guide](https://expressjs.com/en/guide/migrating-5/).
- [ ] Migrate **Redis client 6.3.1**, **Pino/Pino HTTP 10.4.0/11.0.0**, **bcryptjs 3.0.3**, **argon2 0.45.2**, **dotenv 18.0.10**, **helmet 8.3.0**, and **nanoid 6.0.2** in bounded changes with the contract checks above. Read intervening major release notes; Redis client changes do not authorize a Redis server upgrade. [Redis v4-to-v5 migration](https://github.com/redis/node-redis/blob/master/docs/v4-to-v5.md).
- [ ] Replace deprecated prom-client with **`@prometheus-io/client` 0.16.1** and verify metric/alert parity. Migrate root ESLint/plugins and TypeScript in separate tooling changes; preserve coverage and security rules.
- [ ] Update reviewed GitHub action/scanner pins and replace the deprecated Semgrep wrapper. Resolve container patch versions/digests in a separate maintenance change; rehearse PostgreSQL restore and Odoo install/upgrade locally before any infrastructure release.

### Phase 5 — only after an explicit native upgrade request

- [ ] Freeze the selected app scope and platforms. Preserve version 0.1.0 and release build numbers until a release increment is explicitly part of that work. Carry no website features into the apps automatically.
- [ ] Read the matching SDK 57 and proposed SDK 58 docs. Use the project's Expo CLI install workflow to move to an exact reviewed SDK target, then `expo install --fix` and `expo install --check`; use a reviewed pinned Expo Doctor. Do not run generic package-wide `latest` or `audit fix --force`.
- [ ] Resolve the fingerprint/minimatch advisory through supported upstream packages or a narrowly reviewed compatibility change. Keep/query-test the decoder override and postinstall patch. Recheck every SDK-bundled package against the chosen SDK metadata.
- [ ] Review generated Android changes through app config/plugins and the isolated local builder. Preserve maintained iOS project changes; update pods/Xcode only in explicitly requested iOS work. Do not delete the iOS tree as an automatic prebuild step. Keep Podfile.lock and npm lock synchronized.
- [ ] Run native lint/typecheck/tests and export checks before builds. Use manual local Android builds when requested. Reserve Codemagic minutes for explicitly requested iOS verification/releases after local checks. Verify affected storage, sessions, deep links, notifications, QR/wallet and UI on actual devices; browser exports do not establish native behavior.

## Validation commands and rollback

During the later authorized implementation, from the isolated root project:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm --prefix web/merchant test
npm --prefix web/merchant run build
```

Run `npm run test:integration` only after confirming disposable database/network settings, and `npm run test:e2e` only in its isolated browser environment. `npm run openapi:generate` writes documentation and belongs in the upgrade branch. Rerun `npm audit --package-lock-only --json` and `npm audit --package-lock-only --omit=dev --json` in all changed projects. Inspect failures and resolved graphs; do not suppress advisories or weaken tests to obtain a green result.

For native work, run `npm run lint`, `npm run typecheck` and `npm test` from `apps/customer`, followed by the selected Expo checks and requested platform verification. An exported browser bundle is insufficient for CocoaPods/Gradle or device behavior.

Each batch must retain its before/after manifests, locks, source snapshot, review diff and results. Roll back application changes by reverting only the reviewed batch and restoring the previous approved image plus matching browser assets. Keep prior release images/artifacts available; do not rebuild a supposedly old release against floating dependencies. Dependency-only work should require no schema migration. A future database major needs a rehearsed data-compatible restore/migration rollback; selecting an older database image is not enough. Native rollback planning preserves existing binaries, Podfile.lock, package lock and signing identity; this preparation authorizes no OTA, store upload, or binary release.
