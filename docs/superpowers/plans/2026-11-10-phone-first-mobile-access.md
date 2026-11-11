# Phone-first mobile sign-in

The native entry screen currently requires a business link/code before exposing sign-in. Returning customers must be able to use their phone without knowing a business code. Keep independent business customer records and existing join/deep-link behavior.

## API contract

- POST /api/mobile/access/request-code {phone}: uniform {ok:true}; no customer or business discovery before phone proof. Send a generic PF code via existing configured phone delivery, never unverified email. Provider failure is a safe 503. Rate-limit IP and normalized phone, persist limits/failed attempts; supersede old codes. Hash codes, ten-minute expiry, five attempts.
- POST /api/mobile/access/verify {phone,code}: successful proof consumed once. If one active membership, return {status:'signed_in',token,expiresAt,customer,business}, matching current native auth response fields. If multiple, return {status:'choose_card',accessToken,expiresAt,cards:[{id,name,slug}]}. If none, {status:'no_cards'}. Membership lookup only after valid proof. Ignore client tenant claims.
- POST /api/mobile/access/select {accessToken,businessId}: return signed_in response. Grant is random, hashed, five-minute expiry, one-time, phone-bound; atomic consumption/session issuance; recheck selected membership still active and belongs to proven phone. Generic errors for invalid/expired credentials. Customer sessions keep existing tenant constraints.
- Private no-store responses. Protect global auth storage with scoped DB privileges/RLS. Generic security message logging (null business, privilegedLog) masks codes. No real OTP, token, or memberships in logs. No real customer test messages.

## Implementation sequence

1. Backend in isolated .worktrees/mobile-access-backend: failing unit and real PostgreSQL tests; migration/repository/service/routes with existing dependency injection, DB grants and checksum/order. Test limits, attempts persisted, expiry/replay, normalized phones, no enumeration, deletion, cross-business selection and concurrency. Existing endpoints preserved.
2. App in .worktrees/customer-app: reproduce failed behavior in browser regression. Default Iniciar sesión with phone form, separate Crear una tarjeta business entry; generic code verification and multiple-card selection/empty state. Preserve linked business login/join, resend cooldown, stale request cancellation, secure activation, demo. Grant only in memory and clear on back. Extend API allowlist solely for /access. Preserve fonts/theme, accessibility and narrow/dark layouts.
3. Separate spec and quality reviews; repair findings. Full affected backend/app unit suites, PostgreSQL integration, app lint/typecheck, browser acceptance and screenshots. Expo SDK57 documentation checked before native API changes. No native dependency changes expected.
4. Deploy only scoped backend changes over current live image source. Backup DB, correct migration owner loyalty, transaction migration and checksum preflight before image rollout. Health/auth/privacy probes, rollback prepared. Mirror tested source files into root without overwriting unrelated work.
5. Commit app-scoped changes, cherry-pick into clean publication tree, push PF own branch and manually run Codemagic TestFlight. Verify signed IPA and Apple VALID, add build to existing PF Internal group. Real phone-code/notification delivery remains a device/provider check and must not be claimed without evidence.

## Additional authorized scope: native app presentation

User requested in parallel that the app feel like an app rather than the website. Retain PF brand/fonts/colors; adapt for frequent short phone visits per Apple's iOS and tab-bar HIG. Keep four stable labeled tabs, focused loyalty card/QR action, compact rewards and chronological activity, grouped account settings. Remove duplicate marketing-style body headings when native navigation already names the screen. Preserve all loading/offline/QR expiry/reward eligibility/Wallet/push/delete behavior. No new dependencies. Separate implementation owner in existing app worktree, distinct files from Access/API. Verify rendered narrow/light/dark states, dynamic text and functional acceptance before the same TestFlight release.
