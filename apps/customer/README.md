# PuntosFieles customer app

Expo SDK 57 / React Native app for iOS and Android, with a browser preview. It uses the existing PF customer account and business, rather than creating a separate app identity.

The first version includes business enrollment links, phone/code login or signup, points, customer QR, rewards, activity, account deletion, support, and system/light/dark themes. The original PF fonts are bundled. “Explorar una tarjeta de ejemplo” opens a clearly labeled sample without creating an account.

## Development

From this directory, use Node **22.22.2** (also recorded in `.nvmrc`):

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run check:xcode-cloud
npm run start
```

The default API origin is `https://app.puntosfieles.com`. `EXPO_PUBLIC_API_ORIGIN` can select another HTTPS origin at build time. This variable is public; never place server credentials, Wallet signing keys, or messaging API keys in the mobile project.

The server must expose the `/api/mobile` routes: business lookup, login/join request-code and verification, authenticated customer snapshot, QR, logout, account deletion, and Wallet operations. Browser sessions and native bearer sessions are separate; both identify the same existing PF customer. WhatsApp delivery remains dependent on reconnecting the sending phone.

## Preview and checks

```sh
npm run export:web
# Requires the repository's Express/Playwright development dependencies and Chromium:
PLAYWRIGHT_BROWSERS_PATH=0 node ../../tests/e2e/customer-app-preview.mjs
```

The browser fixtures intercept network calls; they do not send verification codes or change production accounts. The export is served under `/app-preview/`. Browser testing does not verify iOS signing, native keyboard/safe-area behavior, SecureStore on a device, or native performance.

## Account and offline behavior

- Native session credentials use SecureStore. The browser preview keeps credentials in memory.
- Offline storage is scoped to the customer and business, expires after eight hours, and excludes tokens, QR codes, phone numbers, and customer names.
- Cached points and rewards are informational. Fresh QR generation and account changes require a server connection. Reconnecting does not mark stale balances current until a matching refresh succeeds.
- Logout, account deletion, invalid sessions, and changing businesses clear the active account. Late responses cannot restore a previous session.

## Wallet and native builds

Google Wallet opens the server-issued Google save link; public availability depends on Google's issuer approval. Apple Wallet currently opens PF's existing web card in Safari and may require signing in there. This version does not claim a native PassKit download flow.

See [Codemagic setup](docs/CODEMAGIC.md) for hosted Mac builds without renting a separate Mac. See [Xcode Cloud setup](docs/XCODE_CLOUD.md) for the checked-in iOS project and first build. `npm run export` checks JavaScript/Hermes exports for iOS, Android, and web; it does **not** compile an `.ipa` or Android package.

For Android, `npm run android` requires a configured Android SDK. `eas.json` also supplies development, internal APK preview, and production build profiles; EAS requires its own authenticated Expo project before cloud builds can run.

The native iOS project is intentionally committed for cloud discovery. Expo Doctor's generic “app config not synced” check is disabled for this setup; run prebuild and `check:xcode-cloud` after native configuration changes.
