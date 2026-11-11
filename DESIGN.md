# PuntosFieles website and application

## Direction

A bright café table: warm paper, espresso text, burnt orange, a butter-yellow loyalty card, and daylight coffee photography. The public homepage should feel welcoming to a business owner and show the product's mechanism immediately. Retain Bricolage Grotesque, Fraunces, and Inter exactly; improve their hierarchy rather than introducing another font.

## Composition

An open masthead leads to a large Fraunces headline and a prominent interactive loyalty-card demonstration. A hospitality photograph grounds the product in its use scene. Follow with a three-step journey, a quiet product-capability section, accessible questions, and the existing demo-request form. Do not invent testimonials, customer counts, pricing, or business results.

## System

- Warm paper `#f7f5ef`, espresso `#302820`, secondary brown `#675e55`, terracotta `#a43d28`, pale gold `#f0dda5`, sage `#e4eadc`.
- Fraunces for display headings; Bricolage Grotesque for branding and product labels; Inter for controls and body text.
- Fluid typography, a 1240px content maximum, 24–72px responsive side margins, and substantial separation between sections.
- Thin rules and open layouts organize content. Rounded surfaces belong to the demonstrated product and its controls.
- Focus rings, 44px minimum primary controls, readable contrast, semantic landmarks, reduced-motion support, and visible content without JavaScript.
- One purposeful interaction: simulate a purchase, see points increase, and reach a reward. All values are labeled as an example.

## Implementation boundary

Keep homepage styles in `public/styles/marketing.css`; do not change shared application tokens. Keep the contact endpoint, field identifiers, challenge verification, and request payload compatible. Retain the existing legal links and Viasolvia credit.

Customer and operational screens use dedicated `customer-modern.css` and `operations-modern.css` overrides. Carry the same fonts, spacing, flat surfaces, and palette into task-focused layouts. Preserve light/dark theme selection, tenant branding, all DOM IDs, and application behavior. Dark surfaces use warm charcoal, pale text, and amber accents.

## Research

- [PHIN PHIN on Awwwards](https://www.awwwards.com/sites/phin-phin): a physical café ritual becomes a recognizable digital interaction.
- [Hozon on Awwwards](https://www.awwwards.com/sites/hozon-the-art-of-keeping): focused product imagery, generous space, and strong type hierarchy.
- [Bettr Academy on Awwwards](https://www.awwwards.com/sites/bettr-academy): expressive hospitality branding paired with clear information architecture.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): visible focus, target size, keyboard access, and readable contrast.
- [Responsive design](https://web.dev/learn/design/): layouts that respond to content, viewport, and user preferences.
- [Core Web Vitals](https://web.dev/articles/vitals): prioritize loading, interaction responsiveness, and layout stability.

Photography: [Unsplash coffee image](https://images.unsplash.com/photo-1495474472287-4d71bcdd2085), hosted locally as a compressed image. Illustrative hospitality photography; not presented as a PuntosFieles customer.
