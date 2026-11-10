# Build PF with Codemagic

`codemagic.yaml` lives at the **repository root**, while both workflows run inside `apps/customer`. This path is intentional for the PF monorepo.

## First build

After the branch is pushed, select `feat/xcode-cloud-20261110` in the PF Codemagic application and click **Check for configuration file**. Start **PF iOS - first simulator build** (`pf-ios-simulator`). It needs no Apple signing credentials and does not upload to an app store. The Mac builder installs dependencies, checks the app, and performs a real native iOS simulator compilation.

Download `PuntosFieles-simulator.app.zip`, the Xcode build log, and `Podfile.lock` from the build artifacts. A simulator `.app` cannot be installed on an ordinary iPhone. Commit the generated lockfile after the first successful macOS build to lock native dependencies for later builds.

The workflow selects an M2 Mac, Node 22.22.2, and Xcode 26.6, matching the current Expo SDK 57 reference image. Both workflows start manually; pushing this file does not itself start builds.

## Signed iPhone / TestFlight build

Before starting **PF iOS - signed internal TestFlight** (`pf-ios-testflight`):

1. The app-scoped **pf_app_store** variable group contains encrypted `APP_STORE_CONNECT_PRIVATE_KEY`, `APP_STORE_CONNECT_KEY_IDENTIFIER`, `APP_STORE_CONNECT_ISSUER_ID`, and `CERTIFICATE_PRIVATE_KEY`. These have been configured through Codemagic's API using the PF Apple key. Do not commit or print their values. A separate Developer Portal UI integration is not required by this workflow.
2. The PF bundle ID `com.puntosfieles.customer` is registered. Create its initial app record in [App Store Connect](https://appstoreconnect.apple.com/apps); Apple does not expose app-record creation through its API. The signed workflow obtains or creates the matching app distribution certificate/profile using Codemagic's supported automatic signing CLI. The Apple Wallet pass certificate is separate.
3. Add **APP_STORE_APPLE_ID** to **pf_app_store**, using the numeric App Store Connect app ID. This is not the bundle ID, team ID, or API-key ID.
4. Run the signed workflow after the simulator workflow succeeds. It uploads an internal-only TestFlight build and explicitly disables public App Store submission. Native device acceptance remains necessary.

The Codemagic API token is separate from both the Apple API key and GitHub push credentials. It can start and monitor builds, but the source branch and root YAML must first be accessible in GitHub. The API does not list YAML workflow IDs before cloning; the IDs are the keys in this YAML file.

References: [Codemagic React Native guide](https://docs.codemagic.io/yaml-quick-start/building-a-react-native-app/), [unsigned simulator builds](https://docs.codemagic.io/yaml-code-signing/ios-simulator-builds/), [automatic signing through CLI](https://docs.codemagic.io/yaml-code-signing/alternative-code-signing-methods/), [build API](https://docs.codemagic.io/rest-api/builds/).
