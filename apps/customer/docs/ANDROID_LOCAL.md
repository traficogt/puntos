# Build Android on the PF Linux VM

Android builds use the PF Linux VM. Codemagic is reserved for explicitly requested iOS builds. All Android commands are manual and produce local artifacts; they do not upload to Google Play or change the installed apps.

On the PF VM, use the root operator account that owns the private signing files and builder state. From the repository root:

```bash
node apps/customer/scripts/android-local.mjs doctor
node apps/customer/scripts/android-local.mjs setup
node apps/customer/scripts/android-local.mjs build --version-code 13
```

Code 13 is only for verifying the current 0.1.0 (13) baseline locally. A future release must explicitly select a code higher than all previously uploaded Play versions. The source app version and native UI are not changed by these commands. Publishing requires a separate owner request.

## How the build works

`setup` builds a dedicated Linux Docker toolchain and installs the Android SDK into a persistent cache. The toolchain pins Node 22.23.5 and a Java 17 image by digest. Google's command-line tools and Node downloads are verified against published SHA-256 checksums. Android platform 36, build tools 36.0.0, NDK 27.1.12297006 and CMake 3.22.1 match the existing app build. No emulator or Android Studio is installed.

`build` copies the app into a private workspace, installs the existing npm lockfile, runs lint, type checks and tests, then uses Expo prebuild and the existing release signing/Gradle script. The checked-in app, iOS files and dependencies are not modified in place. Generated Android files and compilation caches stay outside the repository.

The build validates the package/version, release signature, merged permissions, APK ZIP alignment, AAB bundle alignment and native 16 KB LOAD/RELRO alignment before exporting binaries. These checks do not establish real-device behavior.

## Storage and operating limits

State and caches default to `/var/lib/puntos/android-builder`. The launcher checks free disk before large downloads and builds, and available memory before compilation. PF's conservative thresholds are 25 GiB free disk and 4.5 GiB available RAM. They protect the application host; they are not vendor minimum specifications.

The host-wide `/run/puntos-android-builder.lock` permits only one local setup or build at a time, including commands using different cache directories. Each operation also holds `<state>/operation.lock`; do not remove either while its owning process/container is active. Containers are capped at one CPU, 4 GiB memory and 512 processes, with capabilities dropped, no added privileges and no host Docker socket. Gradle uses one worker and a bounded JVM shared with the Kotlin compiler. CMake job pools also limit native compilation and linking to one job per module; Gradle worker limits alone do not constrain Ninja. Builds on this two-CPU host may take longer than on Codemagic. Check PF API/worker health during and after the initial build.

The VM disk was expanded from 30 GiB to 80 GiB on 11 November 2026. The root ext4 filesystem was grown online after saving its partition table; the API and worker remained healthy. Keep enough room for caches, artifacts, production data and rollback images. Do not prune database volumes or rollback releases to force a build.

## Signing and outputs

The builder reuses PF's existing upload identity:

- Keystore: `/var/lib/puntos/credentials/android/pf-upload.p12`.
- Password file: `/var/lib/puntos/credentials/android/pf-upload.password`.
- Alias: `pf-upload`, store type PKCS12.

Keep these private files outside source control. They are mounted read-only, never copied into image layers, and their values are not passed as Docker environment variables or command arguments. The container loads them only after the app checks pass. The release script cleans its temporary decoded keystore on exit. Artifacts and diagnostics stay in the private builder state directory; do not publish a complete workspace or cache.

Validated output includes `PuntosFieles-<code>.aab`, `PuntosFieles-<code>.apk`, signature/manifest/alignment reports, checksums and source provenance. Use the AAB for an explicitly requested Play upload. Rebuilding the same source does not guarantee byte-identical output to the prior macOS build.

References: [Expo local release builds](https://docs.expo.dev/guides/local-app-production/), [Android command-line builds](https://developer.android.com/build/building-cmdline), [Android command-line tools](https://developer.android.com/studio#command-line-tools-only).

## Verified baseline build — 11 November 2026

The VM filesystem expansion and local toolchain/SDK setup succeeded. Using the original Node 22.22.2 toolchain and unchanged SDK 57 dependency graph, a complete
signed verification build produced **PuntosFieles 0.1.0 (13)** APK and AAB using
the same upload certificate as the previously validated Codemagic build. All four
approved permissions, target API 36, package/version, signature, ZIP alignment,
bundle alignment and 96 native-library LOAD/RELRO checks passed.

Final app/launcher suite: **101 tests passed**, with lint and typecheck clean.
Independent spec and correctness reviews approved the launcher, including the
host-wide lock and preservation of recovery state when container cleanup cannot
be confirmed. The first attempt exhausted the build container memory limit during native
compilation. The retry shares the Gradle JVM with Kotlin and limits native
compiler/linker concurrency through CMake job pools. The final launcher setup
path was also run successfully with the installed SDK cache. Build provenance records
the exact source snapshot and toolchain image used for the signed artifacts.

Artifacts: `/var/lib/puntos/android-builder/artifacts/2026-11-11T17-47-00-181Z-5a1dfbb4-b6a3-48e6-8854-0ac17a9c8de4`. Evidence: `/var/lib/puntos/releases/android-local-20261111`.
PF API/worker stayed healthy. No Codemagic/EAS jobs, OTA updates or Play uploads
were performed. App features, dependencies, release version and iOS source are
unchanged. Physical-device acceptance remains separate.

## Dependency-maintenance toolchain

The current builder pins Node **22.23.5** in the separate image
`puntos-android-builder:20261111-node22-23-5`. Its image build, runtime version, cached SDK setup and doctor
checks have passed. The combined application
and launcher suite passes **105 tests**, with lint/typecheck clean. The baseline
APK/AAB above does not certify the changed JavaScript build dependencies. A future
app release must build its selected source and complete device acceptance.
