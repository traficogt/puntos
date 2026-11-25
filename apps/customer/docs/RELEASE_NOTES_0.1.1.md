# Customer app 0.1.1 — program-aware card (draft, 25 November 2026)

Owner authorization of 25 November 2026 ("Retire and release") covers this native
release. Version numbers in `app.json` and `package.json` are bumped by the release
lead at build time; this document describes the code change and the checklist.
Baseline in the stores: iOS **0.1.0 (3)** in TestFlight, Android **0.1.0 (13)** on
Google Play internal testing.

## What changed

The one Expo app (iOS and Android, PF container with business-branded cards) now
renders every program type the server supports instead of only points, stamps and
the member discount:

- **Cashback**: the card shows the Q balance and the earn rate ("Ganas 5% de cada
  compra como saldo"); the Activity tab and the new "Mi saldo" screen list the
  stored-value ledger (EARN, SPEND, REVERSE).
- **Gift card**: the card shows the balance and the load bonus; "Mi saldo" lists
  loads (base + bonus), gifts received and given, and spends, and offers the
  member-to-member gift flow (recipient phone + amount, confirmation step, server
  result). The request uses the same body and `requestId` idempotency key as the
  browser card; a retry of the same attempt resends the same key, so the server
  replays instead of transferring twice. Client errors show the server's own
  Spanish reason (for example "Saldo insuficiente para regalar.").
- **Program-aware copy**: cashback, gift-card and discount cards no longer say
  "puntos" anywhere (card, Activity, QR screen, Account); stamp cards say "sellos"
  in reward costs and availability.
- **Tiers** (read only): current level, multiplier, progress to the next level and
  perks, when the plan has `tiers` and the business configured levels.
- **Referrals** (read only): the member's referral code with a native Share
  action (code plus the business registration link) and the invited/completed
  counters, when the plan has `referrals`.

Older server payloads keep working: every new field is optional and a payload
without them renders exactly as 0.1.0 did. The offline snapshot cache keeps Q
balances like it keeps points, but never stores the referral code or free-text
gift notes.

### Server dependency (deploy before or with the app)

`GET /api/mobile/customer` gained additive fields, and
`POST /api/mobile/customer/giftcard/transfer` is new
(`src/app/routes/mobile-routes.js`). Installed 0.1.0 clients ignore the new
fields, so the server can ship first. The new fields mirror the browser card's
`/api/customer/me` payload:

| Field | Source |
| --- | --- |
| `cashback: { balance_q, percent } \| null` | same as `/api/customer/me` `cashback` |
| `program_wallet: { kind, balance_q, percent, bonus_percent } \| null` | same shape as `/api/customer/me` `wallet`; renamed because the mobile `wallet` key is the native-pass status |
| `wallet_history[]: { id, tx_type, amount_q, balance_after_q, created_at, base_q, bonus_q, note }` | `cashback_transactions` rows for the member (`listStoredValueHistory`) |
| `tier` | `/api/customer/tier` fields, numbers normalized |
| `referral_code: { code } \| null`, `referral_stats` | `/api/customer/referral-code`, `/api/customer/referrals` |

## Local checks run for this change

- `apps/customer`: `npm run typecheck`, `npm test` (node unit tests incl.
  `tests/wallet.test.ts`), `npm run lint`.
- Server: `node --test tests/unit/mobile-routes.test.js tests/unit/cashback-service.test.js`,
  `npm run openapi:generate` (docs regenerated), strict `tsc`.

Browser tests do not establish native device behavior. No binary was built and
no store upload or Codemagic run happened as part of this change.

## Release checklist for the lead

1. **Collect the release**: confirm `main` contains this change and the server
   change is deployed to `app.puntosfieles.com` (the app reads
   `/api/mobile/customer` there). Smoke-test the gift transfer and the cashback
   card in the browser wallet against the same server first.
2. **Bump versions deliberately**: `apps/customer/app.json` (`version`,
   `ios.buildNumber`, `android.versionCode`) and `apps/customer/package.json`.
   Keep stored data and API compatibility with 0.1.0 installs.
3. **Local checks again on the release commit**: `npm ci`, `npm run typecheck`,
   `npm test`, `npm run lint`, `npm run export` from `apps/customer`.
4. **Android (local Linux builder, no cloud minutes)**: follow
   [ANDROID_LOCAL.md](ANDROID_LOCAL.md) for the manual build on the PF VM
   (`scripts/android-local.mjs`, signed AAB/APK, merged-manifest and artifact
   checks), then the Google Play upload steps and status record in
   [ANDROID_RELEASE.md](ANDROID_RELEASE.md). Local artifacts do not authorize an
   upload by themselves; the owner's release request does.
5. **iOS (Codemagic, explicitly requested only)**: follow
   [CODEMAGIC.md](CODEMAGIC.md) for the signed TestFlight build; triggers stay
   manual. Record the build and TestFlight acceptance there.
6. **Device checks before public release**: on an iPhone and an Android device
   verify the gift flow (keyboard, VoiceOver/TalkBack labels for balance and
   movements, Dynamic Type), the cashback card, the tier and referral sections,
   the native Share sheet, offline/stale states and session expiry.
7. **Store listing**: screenshots and the description may mention balance and
   gifting; privacy disclosures are unchanged (no new data collection; the
   referral code and gift notes are not stored on the device).
8. **Record the checkpoint** in [APP_QUALITY.md](APP_QUALITY.md),
   [ANDROID_RELEASE.md](ANDROID_RELEASE.md) and [CODEMAGIC.md](CODEMAGIC.md), and
   update the native baseline line in the repository `AGENTS.md`.

## Not covered in this release

- Achievements and challenges (`/api/customer/achievements`) are not shown.
- Tiers and referrals are read only; the join flow in the app does not yet
  accept a referral code (the server's `verify` body already does).
- No in-app wallet pass changes: Apple Wallet still opens the web card and Google
  Wallet keeps its approval gate.
- Staff-side gift-card loads and cashback spends stay on the staff terminal; the
  app shows them as movements only.
