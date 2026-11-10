# PF Xcode Cloud setup

Repository: `https://github.com/traficogt/puntos`

Prepared branch: `feat/xcode-cloud-20261110`. Local preparation and validation do not mean that the branch has been pushed or that an Apple build has run.

| Setting | Value |
| --- | --- |
| App | PuntosFieles |
| Workspace | `apps/customer/ios/PuntosFieles.xcworkspace` |
| Shared scheme | `PuntosFieles` |
| Bundle identifier | `com.puntosfieles.customer` |
| Apple team | `PPSXDC8227` |
| Initial version / build | `0.1.0` / `1` |
| Signing | Automatic; managed by Xcode / Xcode Cloud |
| Minimum iOS target | 16.4, from the Expo SDK 57 template |
| Node | 22.22.2; verified download hashes for Apple Silicon and Intel |

## What is prepared

The native project, workspace, shared archive scheme, app icons, and executable `ios/ci_scripts/ci_post_clone.sh` are checked in. The post-clone script installs the pinned Node release in the checkout, runs `npm ci`, validates the native configuration, runs TypeScript/lint/app tests, and installs CocoaPods dependencies. Xcode's bundle phases receive the same Node binary through an ignored `.xcode.env.local` file.

Native generation remains reproducible: `plugins/with-xcode-cloud.cjs` applies the CI files, workspace, signing settings, and scheme correction during Expo prebuild. Edit `ci/xcode-cloud/ci_post_clone.sh`, then regenerate; do not maintain a divergent copy under `ios/`.

No Apple API keys, Wallet private keys, provisioning profiles, or messaging credentials belong in this repository. The Wallet pass certificate is separate from app distribution signing.

## First-time setup on macOS

Apple requires the first Xcode Cloud workflow to be configured in Xcode. The Apple API key alone does not provision a Mac or create that initial connection. [Apple's first-workflow guide](https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow).

1. Clone PF's repository and check out `feat/xcode-cloud-20261110` once it has been pushed.
2. Use a stable Xcode version supported by Expo SDK 57. Check [Expo's build infrastructure](https://docs.expo.dev/build-reference/infrastructure/) for its current SDK 57 image; the image version is a reference, not a separately verified minimum.
3. In `apps/customer`, install Node 22.22.2 and run `npm ci`. In `ios`, run `pod install` with CocoaPods available. **Commit the resulting `Podfile.lock` after successful installation**. This Linux VM has not resolved or validated the native Pods yet; the first CI install can bootstrap the lockfile, while subsequent installs use `--deployment` when it is committed.
4. Open `PuntosFieles.xcworkspace`, select the `PuntosFieles` scheme, sign in to the PF Apple team, and confirm automatic signing for `com.puntosfieles.customer`. Register the app/bundle ID in the PF account if Xcode prompts for it.
5. In Xcode, choose **Product → Xcode Cloud → Create Workflow** and grant Apple's GitHub integration access specifically to `traficogt/puntos`. This is separate from the GitHub connection used to push this branch.
6. Create a workflow named **PF customer app**. Select the workspace and scheme above, a branch-change trigger for this branch, and an **Archive / iOS / Release** action. Use Xcode Cloud build-number management. There is no native XCTest target yet; app behavior tests run in post-clone.
7. Initially keep distribution internal. Add a TestFlight internal-testing post-action after the app record, signing, and first archive succeed. Submit to public review only after device acceptance testing.

Only set `EXPO_PUBLIC_API_ORIGIN=https://app.puntosfieles.com` if overriding the compiled default is useful. No backend secrets are needed in Xcode Cloud for this client build.

## Validation and maintenance

```sh
cd apps/customer
npm run check:xcode-cloud
npm run typecheck
npm run lint
npm test
npm run export
```

The configuration check parses the Xcode project, verifies every shared-scheme target reference, checks team/bundle/version/signing settings, verifies the workspace and generated script, and checks shell syntax. It does not execute `xcodebuild`, resolve Pods, or prove signing works.

After changing native dependencies or app configuration:

```sh
npx expo prebuild --platform ios --no-install
npm run check:xcode-cloud
# On macOS:
cd ios
pod install
```

Review and commit the generated project and lockfile changes. Keep `Pods`, build outputs, `.xcode.env.local`, `.ci-tools`, and personal Xcode settings ignored. The exact Node version and both verified hashes must change together when Node is upgraded.

References: [Apple custom scripts](https://developer.apple.com/documentation/xcode/writing-custom-build-scripts), [Apple dependencies](https://developer.apple.com/documentation/xcode/making-dependencies-available-to-xcode-cloud), [Expo SDK 57 app configuration](https://docs.expo.dev/versions/v57.0.0/config/app/).
