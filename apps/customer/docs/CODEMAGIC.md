# Build PF with Codemagic

`codemagic.yaml` lives at the **repository root**, while both workflows run inside `apps/customer`. This path is intentional for the PF monorepo.

## First build

After the branch is pushed, select `feat/xcode-cloud-20261110` in the PF Codemagic application and click **Check for configuration file**. Start **PF iOS - first simulator build** (`pf-ios-simulator`). It needs no Apple signing credentials and does not upload to an app store. The Mac builder installs dependencies, checks the app, and performs a real native iOS simulator compilation.

Download `PuntosFieles-simulator.app.zip`, the Xcode build log, and `Podfile.lock` from the build artifacts. A simulator `.app` cannot be installed on an ordinary iPhone. The first successful macOS build has supplied the committed lockfile, so later builds install native dependencies with `--deployment`.

The workflow selects an M2 Mac, Node 22.22.2, and Xcode 26.6, matching the current Expo SDK 57 reference image. Both workflows start manually; pushing this file does not itself start builds.

## Signed iPhone / TestFlight build

Before starting **PF iOS - signed internal TestFlight** (`pf-ios-testflight`):

1. The app-scoped **pf_app_store** variable group contains encrypted `APP_STORE_CONNECT_PRIVATE_KEY`, `APP_STORE_CONNECT_KEY_IDENTIFIER`, `APP_STORE_CONNECT_ISSUER_ID`, and `CERTIFICATE_PRIVATE_KEY`. The API credentials are validated, and PF's private key now matches its Apple-issued iOS distribution certificate. Do not commit or print secret values. A separate Developer Portal UI integration is not required by this workflow.
2. The PF bundle ID `com.puntosfieles.customer` and [App Store Connect record](https://appstoreconnect.apple.com/apps/6832824995) are registered. The signed workflow obtains or creates the matching app distribution certificate/profile using Codemagic's supported automatic signing CLI. The Apple Wallet pass certificate is separate.
3. **APP_STORE_APPLE_ID** is configured as **6832824995** in **pf_app_store**. This is the numeric app ID, not the bundle ID, team ID, or API-key ID.
4. Run the signed workflow after the simulator workflow succeeds. It uploads an internal-only TestFlight build and explicitly disables public App Store submission. Native device acceptance remains necessary.

The Codemagic API token is separate from both the Apple API key and GitHub push credentials. It can start and monitor builds, but the source branch and root YAML must first be accessible in GitHub. The API does not list YAML workflow IDs before cloning; the IDs are the keys in this YAML file.

References: [Codemagic React Native guide](https://docs.codemagic.io/yaml-quick-start/building-a-react-native-app/), [unsigned simulator builds](https://docs.codemagic.io/yaml-code-signing/ios-simulator-builds/), [automatic signing through CLI](https://docs.codemagic.io/yaml-code-signing/alternative-code-signing-methods/), [build API](https://docs.codemagic.io/rest-api/builds/).

## Verified build checkpoint

The [simulator build](https://codemagic.io/app/6af28aff56afb2c38c819342/build/6af290d868cf3c59a27a88e1) succeeded on Codemagic, produced the simulator app ZIP and build-log archive, and resolved 181 native pods with CocoaPods 1.16.2. The native app icon is opaque RGB at 1024×1024.

The first signed attempt stopped before archive creation because Apple refused another universal `DISTRIBUTION` certificate. This was resolved using the existing PF private key to request an `IOS_DISTRIBUTION` certificate, a [supported Codemagic signing option](https://github.com/codemagic-ci-cd/cli-tools/issues/262). Apple issued certificate `P249MB7K2B`, expiring November 10, 2027, and its public key was verified against the protected PF private key. Existing apps' certificates were preserved. The workflow already searches both certificate types, so no signing command change was needed.

The signing files and a recovery manifest are retained under PF's protected credential storage, outside the repository and build artifacts. Reuse this signing key for later PF builds. An App Store Connect `.p8` API key or a Wallet pass key cannot substitute for it. Existing certificates may serve other apps; do not revoke them as an automatic recovery action. Codemagic also supports [sharing a distribution certificate across apps](https://help.codemagic.io/articles/8514945589-how-do-i-share-certificates-across-multiple-apps-using-automatic-code-signing).

The [second signed build](https://codemagic.io/app/6af28aff56afb2c38c819342/build/6af2a2423e77cfd64c93c207) passed all checks, signing, archive creation, and upload to App Store Connect. It produced `PuntosFieles.ipa` (17,656,173 bytes), version **0.1.0 (1)**, requiring iOS **16.4 or later**. The package's bundle ID, embedded distribution profile, and signature resources were checked after download. Apple reported `UPLOAD SUCCEEDED with no errors`, delivery `ec729a16-9b2a-4ea0-8c30-6b21b8ec0b6b`.

Apple completed processing and reports the build as **VALID**, with internal state **IN_BETA_TESTING**. It is available in [PF's TestFlight area](https://appstoreconnect.apple.com/apps/6832824995/testflight). The requested owner invitation was sent through `PF Internal`, and Apple now reports the tester as **INSTALLED**. Full physical-device acceptance and real phone-code delivery remain outstanding.

The first successful upload's optional Codemagic post-processing step attempted external beta review and stopped because external-review contact information was absent. This does not invalidate the accepted internal build. The workflow now sets `submit_to_testflight: false`: that setting controls external beta review, while the upload itself makes a processed build available in TestFlight. Internal-only export options remain enabled; public App Store submission remains disabled. The corrected publishing configuration is schema-checked; the existing accepted binary does not require recompilation.

## Native push credential preparation

APNs key `9FDM3HC9ZW` is stored only in PF's protected server credential storage, with Team ID `PPSXDC8227` and topic `com.puntosfieles.customer` recorded in its separate push manifest. Local EC P-256 and ES256 checks passed. Apple's push capability is enabled, and active App Store profile `LNXMZJ2353` includes the production APNs entitlement and PF's existing distribution certificate. The signing manifest points to this replacement profile; no certificate was revoked.

Build 0.1.0 (1) does not contain native app notifications. The notification implementation adds explicit opt-in under **Cuenta → Notificaciones**, permission recovery, a user-requested test, safe card/reward navigation, and durable revocation when signing out or changing accounts. It supports physical iPhones running a production-signed build. Demo, browser preview, Android, simulator, and development builds do not register for production APNs.

The app stores the installation ID, revocation secret, and consent binding in native SecureStore. The server stores the token encrypted and the revocation secret hashed. Device consent lasts up to 30 days and refreshes when the app reconnects. Explicit session invalidation, account deletion, opt-out, or consent expiry stops delivery; ordinary browser idle expiry alone does not. An offline opt-out remains pending until the device reconnects, so a generic alert may still arrive in the meantime. Alerts omit balances and contact details. APNs acceptance is not proof of display on the phone.

Keep the APNs private key on the sending server; it does not belong in Codemagic artifacts or the app bundle. Runtime variables are `MOBILE_PUSH_ENABLED`, `MOBILE_PUSH_APNS_TEAM_ID`, `MOBILE_PUSH_APNS_KEY_ID`, `MOBILE_PUSH_APNS_KEY_FILE`, and `MOBILE_PUSH_APNS_TOPIC`. The production APNs host is fixed in the provider. Apple Wallet update delivery retains its separate existing configuration.

The manual `pf-ios-resolve-pods` workflow resolves new native dependencies on macOS and exports `Podfile.lock`; review and commit that artifact before running the signed workflow, which retains `pod install --deployment`. The [notification dependency build](https://codemagic.io/app/6af28aff56afb2c38c819342/build/6af2b50828a297c70385a85e) succeeded and added Expo Notifications, Crypto, Device, and the transitive Application pod without changing existing pod versions. The signed notification build and physical-device acceptance are tracked below.


## Notification release checkpoint

The [signed notification build](https://codemagic.io/app/6af28aff56afb2c38c819342/build/6af2b63531027302ea2909f8) passed validation, native dependency installation, signing, compilation, and upload. Version **0.1.0 (2)** is **VALID** in Apple and assigned to the existing **PF Internal** group. The requested tester remains installed; no new public or external testing group was created.

The downloaded IPA is 18,049,566 bytes, SHA-256 `0c39bc7755f3d224d42919fd2f5809289ea8b18ee402661be95d813e6314da73`. Its actual signed Mach-O entitlement and embedded provisioning profile both specify production APNs for `PPSXDC8227.com.puntosfieles.customer`; debug access is disabled. The profile's CMS signature was checked. Apple delivery/build ID: `d3cb0160-15c9-4861-a39b-7fc68cbc5f59`.

The backend release is deployed with its additive migration, protected APNs key, healthy API/worker, and verified APNs TLS/HTTP2 connectivity. Validation passed: 56 app tests, 828 backend unit tests, 22 isolated PostgreSQL tests, 28 checks inside the release image, five existing browser scenarios, and seven notification UI states. App lint, TypeScript, Expo doctor, and the Xcode configuration checks passed. The server release evidence and rollback are retained under `/var/lib/puntos/releases/mobile-push-20261110` on the PF VM.

**Device acceptance remains:** update PF in TestFlight, sign in to a real PF account, open **Cuenta → Notificaciones → Activar notificaciones**, allow iOS permission, then choose **Enviar notificación de prueba**. Confirm the alert arrives and opens the matching card. Real customer sign-in still depends on the configured OTP delivery channel; the demo cannot register for push. No artificial points change or authentication bypass was used, and no live APNs delivery has been claimed.

## Firebase project reference

The owner supplied [PF's Firebase project console](https://console.firebase.google.com/u/1/project/ardent-kite-485612-v1/overview) on November 10, 2026. Project ID: `ardent-kite-485612-v1` (also used by the existing Google Wallet service account). Retain this project for potential Android Firebase Cloud Messaging setup. The console URL identifies the project; it does not itself grant API access or prove an Android Firebase app/FCM configuration exists. This iPhone release sends through APNs directly and does not embed Firebase credentials.
