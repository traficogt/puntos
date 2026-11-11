# PuntosFieles customer app — proposed first release

## Product and scope

Build a customer app for iOS and Android using the existing PF backend, accounts, business programs and points ledger. Preserve Spanish, tenant branding, light/dark themes, Bricolage Grotesque, Fraunces and Inter. Adapt the existing customer experience to native navigation.

The first development slice includes business-link entry, phone/code sign-in, a customer card and QR, points, rewards, activity, account controls and links into the available Wallet flows. Keep one business session active at a time, matching the current account model; switching businesses must not merge balances or identities. Existing staff and owner web tools continue to operate against the same backend.

## Recommended approach and alternatives

Use React Native with Expo and TypeScript for a shared iOS/Android implementation. It supports native controls and secure device storage while letting us reuse PF's JavaScript knowledge and API contracts. Keep its dependencies and builds in a separate application directory.

A Capacitor wrapper would reuse more of the current HTML, but would require special care around browser sessions and Wallet navigation and offers less native interaction. Separate Swift and Kotlin apps offer the most platform-specific control with two implementations to maintain. Expo is the recommended starting point.

## Navigation and behavior

- Card: business identity, points, progress, a clear scan action and available Wallet actions.
- Rewards: available and locked rewards with their actual point requirements; clear empty and error states.
- Activity: the customer's real earning/redemption history with retry and refresh.
- Account: verified identity, business context, support, theme, sign-out and account-management links.

Authentication must reuse PF's verification and session rules, with a native API transport where the browser-cookie contract requires it. Device credentials belong in platform secure storage. No service-account JSON, Apple private key or administrative credential belongs in the application bundle.

Repository discovery confirms that customer authentication currently reads an opaque server-managed session from an HTTP-only cookie; verification returns customer data and sets that cookie. A native session adapter must therefore be part of implementation, preserve server-side expiry/revocation and business scope, and keep existing browser cookie and CSRF protections intact. Do not treat the current API as already supporting native bearer authentication.

Offline mode shows the last synchronized information and its age. It never manufactures points, extends an expired QR, or treats cached rewards as redeemable. Redemption and new verification require connectivity. Sign-out and business changes clear the previous account's local data, and late responses cannot restore it.

## Delivery and verification

The first deliverable is a runnable, reviewed application foundation with working API integration, explicit loading/error/offline states, and a clearly labeled sample preview for UI review. Preview data must never be presented as a live account. Verify navigation, API contracts, expiry, logout, business boundaries and offline behavior, plus render narrow and wide phone sizes.

Store distribution is a later build/review step. This Linux VM can develop the app; iOS signing/building needs an appropriate Mac or cloud build service. Google Wallet remains in Demo Mode until publishing approval. Real phone sign-in still depends on the messaging VM the user previously deferred. Native Wallet handoff and physical-device behavior need device acceptance; any unfinished platform integration must remain explicitly identified.

## Approved scope

The user approved this customer-only iOS/Android scope on November 10, 2026 ("Go"). Staff checkout remains in the existing web application. Use Expo SDK 57 initially because Expo's current documentation identifies it as the physical-device Expo Go version during the SDK 58 transition.

## References

- https://reactnative.dev/docs/environment-setup
- https://docs.expo.dev/get-started/create-a-project/
- https://docs.expo.dev/versions/latest/sdk/securestore/
