# Update existing Wallet passes and installed-app data without native builds

User authorized all applicable updates without Codemagic after clarifying that pass content and shared API data can change without a native release. Keep iOS 0.1.0 (3), Android 0.1.0 (13), all native files, dependencies, release versions and cloud workflows unchanged. No EAS/OTA workaround, new native screens, campaign broadcasts or article work. Existing website/server functionality is deployed.

## Existing-app data compatibility

The mobile snapshot currently projects the mutable reward catalog. Reuse the established customer-scoped reward progress service so installed apps receive protected names, descriptions, point prices, expiry, and branch scope. The installed model understands stock/expiry but does not understand the newer `available`, inventory or guard fields. Its legacy `rewards` array must contain only currently eligible choices (balance need not be sufficient), avoiding a false “Disponible para ti” for unavailable stock, manual availability, stale required inventory or current redemption limits. Do not falsify stock or expiry to encode eligibility. Preserve every existing JSON field/type and tenant/customer checks. Add a separate additive authoritative reward_progress field for newer clients; do not claim older apps render this new field. No redemption/earning mutation changes. Failure must not silently fall back to unprotected terms.

Use the same eligibility facts for the existing native push classifier if it can otherwise announce an unavailable reward. Preserve registration, user opt-in, throttle/dedup/lease behavior and generic update payload. Do not create manual test notifications or expand audiences.

## Wallet content and refresh

Preserve primary/pending balances, protected next reward, existing links, identifiers, credentials, pass class identity and native Wallet layouts. Improve readable local expiry text using business region/timezone, retain precise protected earning rates and correct currency fallback when a historical cycle lacks regional metadata. Add a short stable explanation that pending points cannot yet be redeemed and Wallet content may need a connection to refresh; no financial values, merchant costs, promotions or false “live” timestamp. Keep voided cards free of progress/earning/location hints. Do not promise lock-screen notification delivery.

After tests and a scoped server release, enqueue one refresh of existing nonrevoked passes that can be delivered by configured providers. Preserve existing retry delays and leases; do not reset failures or change balances/rewards. Deduplicate this explicit rollout using a private release record and existing row revision values, retaining serials/membership tokens. Let the existing worker deliver ordinary content refreshes; record aggregate provider acceptance/remaining queue only. Provider acceptance does not prove a device displayed the new pass.

## Validation and release

Use the current isolated merchant-web worktree and baseline-hash source sync. Tests: old-client projections, protected/current reward terms, availability/guards/inventory, no cross-tenant data, expiry localization and region fallback, signed Apple pass structure and Google API payloads with provider doubles. Read-only production checks before/after; actual rollout changes only pass revision metadata, using the normal refresh channel authorized above. No credentials/PII in logs. Overlay current reporting-actions image; keep deployed 66 migrations and unpublished order/contact routes excluded. Finish with both services healthy, source hashes synchronized, exact rollout status and documented physical-device acceptance limits.
