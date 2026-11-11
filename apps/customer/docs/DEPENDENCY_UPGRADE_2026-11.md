# Native dependency maintenance — November 2026

The integrated candidate retains **Expo 57.0.32**, the latest stable SDK 57
patch observed on 11 November 2026. All direct native runtime versions, app
source, platform configuration, release numbers, and `ios/Podfile.lock` retain
their baseline values. Installed binaries remain iOS **0.1.0 (3)** and Android
**0.1.0 (13)**; no binary or OTA update was published.

## Included changes

- Native Node moves from 22.22.2 to **22.23.5**, using bundled npm **10.9.9**.
  Both maintained Xcode bootstrap script copies use the matching official Darwin
  archive checksums. Node types move from 26.6.6 to **22.20.5** to match the runtime.
- `@expo/fingerprint@0.20.15` receives scoped overrides for **glob 14.0.4** and
  **minimatch 11.0.8**. `@typescript-eslint/typescript-estree@8.72.2` receives a
  scoped minimatch 11.0.8 override. Other consumers are not globally overridden.
- The npm lock was regenerated because npm 10 retained an invalid nested glob
  13.0.7 entry even after applying the override and running `npm update glob`.
  The accepted graph resolves glob 14.0.4 through fingerprint's own require
  context, contains no glob 13, and passes `npm ls --all`. The lock also refreshes
  compatible transitive tooling, including Expo environment helpers, Metro,
  parser helpers, brace expansion and browser compatibility metadata. Native
  package version sets remain unchanged; much of the lock diff is hoisting.
- Four regression fixtures cover fingerprint ignore/negation matching, its actual
  nested `.gitignore`/native-workflow consumer of glob, TypeScript project globs,
  and deterministic fingerprints that ignore generated files but detect native
  source changes.

The existing **query-string 7.1.3** and **decode-uri-component 0.5.1** overrides,
postinstall patch, and Router round-trip regression remain together. Fresh
installation and repeating the patch both pass.

## Verification

The final SDK 57 graph passed these local checks on Node 22.23.5:

- Fresh `npm ci --include=dev --no-audit --no-fund`, with lifecycle scripts enabled.
- Lint with zero warnings, strict typecheck, and **81/81** serial tests: the
  existing 77 plus four dependency compatibility fixtures. This count precedes
  integration of the separate local Android builder changes.
- `expo install --check`, `npm run check:xcode-cloud`, and pinned
  `expo-doctor@1.21.8` (**20/20** checks). The pre-existing app-config-sync Doctor
  check stays disabled for the manually maintained iOS project.
- Both full and production-classified package-lock audits report **zero** findings.
- The actual resolved dependency tree passes `npm ls --all`.
- Sequential Android and iOS Metro/Hermes exports passed using one worker, a
  768 MiB Node heap, and private output directories. No platform build ran.

Fingerprint parity against the original and updated app trees is recorded in
`sdk57-fingerprint-parity.json` in the evidence directory. The comparison runs
SDK 57 fingerprint twice per tree, using its original glob/minimatch exports
and then the patched exports; ordinary fixture behavior is also tested under
both dependency sets. Export commands and results are recorded in
`sdk57-exports.json`. Neither JS export nor these checks prove native device
behavior.

## Why SDK 58 was deferred

An isolated Expo **58.0.24** / React Native **0.88.1** candidate was implemented
and reviewed against Expo's [release notes](https://expo.dev/changelog/sdk-58),
[SDK upgrade workflow](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/),
and [iOS scene migration](https://expo.fyi/ios-scene-lifecycle). Source-level
checks and a scratch prebuild passed, but review found a behavior blocker:

**SDK 58 shows foreground notifications when a JavaScript handler exceeds its
three-second native deadline.** In `expo-notifications@58.1.9`, the iOS task's
`defaultPresentationOptions` includes banner, list, sound and badge, and
`timeout()` presents those options. That bypasses this app's account/consent
predicate when JavaScript is delayed, including after logout or account changes.
An async handler returning false cannot protect that timeout path.

The installed SDK 57 `expo-notifications@57.0.25` task instead ends the timed-out
request without presenting it. Its JavaScript API documents missing or late
results as discarded. SDK 58 also installs an automatic presenting subscriber;
calling `setNotificationHandler(null)` removes that subscriber, which differs
from installing an async silent handler. Removing it during startup/cleanup
alone does not solve the active-handler timeout change.

The SDK 58 candidate and evidence were preserved privately, then its scene,
Router, R8, handler and type adaptations were restored from the baseline using
recorded hashes. **No custom native fork or native-source patch was introduced.**
Revisit SDK 58 only with a supported way to preserve the notification ownership
and consent behavior, then resolve CocoaPods and validate native platforms.

## Remaining constraints

- ESLint **9.39.5 is EOL**. The compatible Expo config still uses the latest
  `eslint-plugin-react` 7.37.5 and `eslint-plugin-import` 2.32.0; their peer ranges
  exclude ESLint 10. A supported lint migration remains pending compatible
  upstream releases or a separately reviewed config migration. TypeScript stays
  **6.0.3** because the current parser supports `<6.1.0`, excluding TypeScript 7.
- A pre-existing transitive peer, **react-native-gesture-handler 3.5.0**, is present
  in both the baseline npm lock and preserved CocoaPods lock, while the SDK 57
  bundle lists `~2.32.0`. Direct dependency alignment and Doctor do not flag this
  transitive mismatch. It is preserved here to avoid an unrequested native/pod
  migration and requires deliberate review before a future native release.
- Android remains on the SDK 57 toolchain (SDK/build-tools 36, Gradle 9.3.1,
  AGP 8.12.0, Kotlin 2.1.20, NDK 27.1.12297006). The separate successful Android
  baseline build used the prior dependency graph; its signed APK/AAB does not
  validate these changed JavaScript build dependencies. The updated Node 22.23.5
  local builder passed image, runtime, cached SDK setup and doctor checks.
- No Gradle, Xcode, CocoaPods, Codemagic, EAS build, simulator, store, or OTA
  workflow ran for this maintenance candidate. A future release still needs its
  platform/device validation. Xcode/CocoaPods/EAS release-tool modernization is
  deferred to that deliberate native release.

Evidence is in `/var/lib/puntos/releases/dependency-upgrade-20261111/native/`.
Final maintenance logs use the `sdk57-` prefix; rejected SDK 58 work is under
`sdk58-candidate/` and `sdk58-evidence/`. Original locks and the restoration hashes
are retained. Remove the scoped overrides only after upstream dependency ranges
adopt patched versions and the same compatibility checks pass.
