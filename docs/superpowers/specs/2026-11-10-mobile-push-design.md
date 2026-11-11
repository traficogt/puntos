# Native iPhone notifications

The user authorized implementation after supplying the APNs key and being told that device registration, app permissions, server delivery, a new TestFlight build, and device validation remained. This extends the customer app; the existing Wallet update protocols remain unchanged.

## Behavior

Provide an explicit Notifications section in the authenticated iPhone Account screen. Explain points/reward alerts before asking iOS permission. Default off per customer/business, with enable, disable, settings recovery after denial, and an explicitly requested test notification. Do not prompt at launch, register demo/browser/Android users, or send promotions. Preserve the current visual system and Spanish copy.

Send a generic points-update notification after authoritative points/pending balances change, and a reward notification when confirmed available points cross an active, in-stock, unexpired reward's cost and the plan enables rewards. Registration establishes a baseline; it does not notify for old activity. Coalesce rapid changes. Do not place names, phone numbers, amounts, balances, bearer tokens, membership codes, or arbitrary navigation URLs in notifications. Tap routing only opens Card/Rewards for the currently matching customer and business, then refreshes authoritative data.

## Registration contract

- `PUT /api/mobile/customer/push-device`: authenticated CUSTOMER session; strict body `{installationId: UUID, installationSecret: base64url-encoded 32 bytes, token: APNs hexadecimal token, platform: "ios"}`. Server chooses APNs topic and production environment. Returns `{enabled:true, expiresAt: ISO timestamp}`. Store only a hash of the installation secret and encrypted APNs token. Installation identity/secret live in native SecureStore and never ordinary cache.
- `POST /api/mobile/customer/push-device/revoke`: registered before bearer middleware; body `{installationId, installationSecret}`. This credential authorizes only disabling that installation, including after logout/session expiry. Rate-limit, compare secrets safely, return a uniform `{ok:true}` for absent/mismatched registrations, and expose no customer data.
- `POST /api/mobile/customer/push-device/test`: authenticated and rate-limited; body `{installationId, installationSecret}`. Verify same customer/business and device ownership, then send one generic test alert only when explicitly requested by that device. Return `{sent:true}` for APNs acceptance, never claim phone delivery.
- `GET /api/mobile/customer/push-status`: authenticated, reports `{available:boolean}` for locally enabled/configured iOS delivery. Never returns credentials or tokens.

Registration is customer/business/session-bound, with a maximum 30-day consent lease refreshed when the app reconnects. A browser session's idle timeout must not silently turn off background notifications; the lease is a separate notification consent, not authorization to access PF data. Explicit session invalidation, customer deletion, revocation, or expired device lease suppresses delivery. Session ID is checked for explicit invalidation. The app revokes on sign-out, account switching, invalidation, permission removal, or opt-out, retains a pending revoke across offline exits, and retries on reconnect. A new account requires its own opt-in. Disallow taking over an existing installation or token without the installation credential. Invalid APNs tokens disable that registration.

## Delivery and lifecycle

Use direct APNs HTTP/2 with the provided server-only P-256 key, ES256 provider tokens, fixed PF topic, fixed production host, bounded request time/body, connection reuse, and redacted errors. Distinguish invalid device tokens from credential/topic errors and transient failures. Never delete a valid registration on a server credential error. Handle 429/5xx with bounded retry/backoff and release worker leases. Delivery is best-effort; collapse IDs reduce duplicates but do not guarantee exactly-once display after an ambiguous failure.

Use additive tenant-isolated storage and durable change tracking from confirmed balances. Worker claims are bounded and lease-protected; initialize baselines under transaction/locks to avoid registration races, and only acknowledge the claimed revision. Recheck revocation, customer status, and installation generation before sending. Notifications already accepted by APNs cannot be recalled; generic content limits exposure during a logout race, and the app clears delivered notifications on account changes.

## Delivery gates

Test token/provider errors, ownership and tenant isolation, logout/deletion, offline pending revocation, stale async permission/registration responses, simultaneous workers, retries, and baseline/reward transitions. Publish only a scoped backend overlay over the running images and an additive migration, with rollback. Build through PF's own Codemagic branch using the prepared production push profile. Invite the existing PF Internal tester to the updated build. Actual delivery remains a device gate requiring a signed-in, opted-in iPhone; no authentication bypass or artificial customer points change is permitted to manufacture a test result.
