# Official Wallet badge artwork

Prepared 2026-11-12 for the Pertenece invitation-step illustration. Use the complete, unmodified badges as noninteractive images within a visibly labeled example. The landing page has no save-pass action and its card is fictitious. Do not present these images as live buttons or links.

## Provenance

| Local asset | Source | SHA-256 |
| --- | --- | --- |
| `public/credenciales/apple-wallet-es-mx.svg` | Exact copy of `public/images/wallet/apple-wallet-es-mx.svg`. The repository's [Wallet release plan](../../superpowers/plans/2026-11-09-wallet-access.md) records that this unmodified Spanish (Mexico) SVG came from Apple's official package and its hash was verified during release. | `7e969510d2ae1340b01aadb1a0affca4e84242d506e7e00a281f7feb441eb508` |
| `public/credenciales/google-wallet-es-419.svg` | Downloaded from Google's [official SVG archive](https://developers.google.com/static/wallet/download-assets/add-to-wallet-svg.zip), member `add-to-wallet-svg/svg/es419_add_to_google_wallet_add-wallet-badge.svg`. It is byte-identical to the existing shared Google badge. | `a7e4676e40f0ead892711c9ddc0a965c4f32dec3d434b73dfd7dbeac1207be37` |

Google archive SHA-256: `8296efc3a62c4b74c3409163f9f13ef61e9cfa471b5b5f5d05bc56039e9d3425`.

Apple's current download route requires developer sign-in, so this review reused the documented repository asset. No standalone logos were extracted, redrawn, or sourced from third-party websites.

## Official guidance and usage scope

- [Apple Wallet badge guidelines](https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/): the complete official badge belongs with a Wallet-compatible pass. The guide prohibits the standalone Wallet icon and modified badge artwork. It permits text about compatibility in general marketing communications. The artwork remains subject to Apple's Wallet Marketing Artwork License Agreement.
- [Apple Design Resources](https://developer.apple.com/design/resources/): the **Badges and Logos** section describes Apple technology artwork for marketing materials and points to technology-specific guidance.
- [Google Wallet brand guidelines](https://developers.google.com/wallet/retail/loyalty-cards/resources/brand-guidelines): an operational Add to Google Wallet button must invoke a Wallet API flow. Preserve badge proportions, use at least 8 px clear space on each side, and render at least 48 px high. Guatemala does not require a translated product name in the listed localization table.
- [Google product-icon guidance](https://partnermarketinghub.withgoogle.com/brands/google/branding-guidelines/how-to-show-googles-brand/): separate product icons are obtained and approved through Partner Marketing Hub. This implementation uses the complete published save badge, not a separate icon.

The chosen treatment is a marketing depiction of the customer invitation step, labeled as an example and rendered without action semantics. The public guides do not explicitly describe an exception for inert badge illustrations; do not claim that they expressly approve that exception. An actual save control added in the future must connect to the appropriate pass-saving flow.

## Suggested markup and placement

Place this figure beside or immediately after the **member receives an invitation** explanation in `public/credenciales/index.html`. Keeping it in that explanatory step gives the imagery context. Avoid making the hero's compatibility caption look like a live download area.

```html
<figure class="wallet-example">
  <figcaption>
    <strong>Así se agrega el carné</strong>
    <span>Ejemplo de invitación</span>
  </figcaption>
  <div class="wallet-example-badges">
    <img src="/credenciales/apple-wallet-es-mx.svg"
         width="151" height="48"
         alt="Insignia de Agregar a Apple Wallet, mostrada como ejemplo">
    <img src="/credenciales/google-wallet-es-419.svg"
         width="209" height="48"
         alt="Insignia de Agregar a la Billetera de Google, mostrada como ejemplo">
  </div>
</figure>
```

In `public/credenciales/credenciales.css`, use a wrapping flex row with a 16 px gap, `align-items:center`, and 8 px padding around the row. Render each image at `height:48px; width:auto; max-width:100%; flex:none`. Do not crop, recolor, distort, add shadows, reduce opacity, animate, add hover treatments, or attach button roles or click handlers. Keep the example caption visible at all viewport sizes. Use a light background, and preserve the surrounding Pertenece typography.
