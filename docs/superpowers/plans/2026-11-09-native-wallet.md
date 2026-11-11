# Native Wallet implementation

User authorization: build Apple and Google Wallet support while verification and credentials are pending. Preserve the ledger, existing fonts, authentication, and offline checkout. Live issuance stays disabled until configured.

## Design

- Authenticated customer issuance, tenant isolation, CSRF protection, private/no-store responses.
- Real signed Apple store cards and Google loyalty objects. Stable, opaque, revocable membership barcodes identify accounts for earning; they do not authorize reward spending.
- Encrypted pass credentials. One active pass per customer/provider; revocation voids existing cards and permits replacement with new credentials.
- Apple device registration, update listing, download, unregister and bounded device logging routes authenticated according to the native protocol.
- Transactional database triggers enqueue refreshes. A leased, revision-aware worker retries independently of checkout. Offline cards display the last synchronized balance.
- Parallel-agents workflow delegates isolated Apple/Google providers and storage. Parent owns configuration, orchestration, routes, staff integration, customer UI and release verification.

## Execution

1. Provider/configuration/authorization tests with mocked transports and ephemeral signing keys.
2. Additive migration, RLS, encryption, durable revision queue; verify on disposable PostgreSQL.
3. Customer status/issue/revoke and Apple protocol routes; verify tenant/token/disabled/deleted cases.
4. Stable membership earning with existing operation UUIDs and offline staff grants, preserving QR replay protection.
5. Conditional accessible save controls, offline guidance and logout cleanup; desktop/mobile checks.
6. Credential readiness tooling, setup guide and real-device acceptance checklist.
7. Full unit/type/lint and focused database/browser integration; scope any release against audited live images.

## External prerequisites

Apple Developer membership, Pass Type ID, signing certificate/private key and matching WWDR intermediate. Google Wallet issuer, publishing approval (or authorized demo testers), enabled API and issuer-authorized service account. Private credential mounts must exist in API and worker. No live issuance, device install or APNs delivery claim without those prerequisites.
