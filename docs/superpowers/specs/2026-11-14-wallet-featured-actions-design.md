# Two useful Apple Wallet actions

The owner authorized adding Wallet actions from the server and explicitly requested both slots. Use Apple's system-defined `viewOffersRewards` and `membershipBenefits` actions, in that order. The existing Node/passkit-generator 3.7.0 supports the schema; no native app, dependency, signing identity or pass style change is needed.

## Destinations and access

For an active pass with a valid public business slug, use `https://app.puntosfieles.com/ingresar/{slug}?destino=ofertas` and the equivalent `destino=beneficios`. Construct both from the configured HTTPS origin and encode the public slug. These URLs contain no customer identifier, pass token, credential or automatic opt-in. Missing/invalid slugs fall back to the authenticated web account with the corresponding fixed fragment.

The existing customer login page may continue immediately to `/mi-tarjeta/#ofertas` or `#beneficios` only after its current-session checks establish the intended business and customer. Otherwise preserve the existing phone-verification flow. Only these two destinations are accepted; arbitrary redirect URLs are never supported. After verification, use the same account destination without issuing another pass. Preserve normal login/enrollment behavior without `destino`.

The customer web account resolves the fragment after its data loads. Offers navigate to eligible offers, or rewards when none exist. Benefits navigate to the level/benefits section. Move accessible focus to the destination heading once; background refreshes must not repeatedly scroll or steal focus. Session invalidation and existing offline/tenant safeguards remain authoritative.

## Compatibility and privacy

Retain the existing account/support links, QR, primary/pending points, serial, update token and store-card layout. Add equivalent details links for older iOS versions. Revoked/voided passes have no featured actions or offer/benefit links. Apple supplies action labels/icons; don't promise custom labels or a verified iPhone rendering. No `changeMessage` or marketing push is introduced. Google passes remain unchanged.

## Release and acceptance

Test actual signed ZIP contents, manifest/signature integrity, action order/types/URLs, URL privacy, unsafe/missing slug fallback and revocation. Test customer navigation and business-scoped login in browser fixtures, including signed-out/wrong-business/no-offer cases. Run wallet/customer regressions, typecheck/lint and desktop/mobile browser checks. Deploy the additive server/browser change with rollback images; enqueue one deduplicated content refresh for existing active Apple passes while preserving retry schedules/leases. This is an ordinary pass-content refresh, not a visible campaign alert. Physical iPhone rendering remains an explicit acceptance item.

Sources checked November 14, 2026: [Apple WWDC26](https://developer.apple.com/videos/play/wwdc2026/209/), [Wallet metadata/action types](https://developer.apple.com/documentation/walletpasses/defining-the-metadata-of-your-wallet-pass), [Apple Wallet design guidance](https://developer.apple.com/design/human-interface-guidelines/wallet).
