# PF × Astryx prototype

An isolated browser exploration using Astryx 0.7.16, React 19 and Vite. It does not change the public homepage or the native apps. All business records and interactions are fictional, in-memory examples; no PF API is called and no messages are sent.

Preview path: `/revision-astryx/9b72f5a1/`. Hash routes: `#inicio`, `#panel`, `#componentes`. The document and PF's existing search-visibility middleware both apply noindex. This is an unlisted preview, not access-controlled storage.

## Run and build

Use the repository's Node 24 toolchain, then run `npm ci` and `npm run build` in this directory. Output goes to `public/revision-astryx/9b72f5a1/`. Serve it from the repository's `public` root to resolve the existing fonts, logo and illustration. `npm run dev` is also available, but those shared assets still need that public root.

Dependencies and the lockfile are isolated from the root package. No Codemagic workflow or native dependency is involved.

## Direction and quality bar

Preserve PF's Fraunces, Bricolage Grotesque and Inter typography, warm paper, espresso, terracotta, gold and sage palette. Use an open editorial landing composition with the approved shop illustration, a practical owner dashboard, and working component examples. The fixed brand takes precedence over generic font warnings from design detectors.

Acceptance: three usable screens at desktop and mobile widths; keyboard-operable controls and dialogs; clear fictional-data labels; light and dark themes; no page overflow, runtime errors, API calls or serious automated accessibility violations. Browser checks do not establish native-device behavior.

## What is demonstrated

- Landing adapted from Astryx's side-gallery template, with real navigation and disclosures.
- Dashboard adapted from its dashboard template: period selection, chart, customer search/filter/sort, operating mode and campaign dialog.
- Reward card with simulated visits, redemption and reset; validated business settings; bounded cost scenarios; loading, success, empty and disabled states.
- Real Astryx layout primitives, inputs, buttons, icons, tabs, segmented controls, tables, avatars, badges, progress bar, slider, switch, dialog and collapsible.

## Assets and licenses

The illustration `/images/articles/funcionan-1152.webp` is an existing approved PF editorial asset; no new artwork was generated. Fonts and brand assets are the existing self-hosted PF resources. Astryx template adaptations are identified in source comments. The build emits `THIRD_PARTY_NOTICES.txt` with the MIT licenses for bundled libraries. Source license fallbacks are retained in `licenses/` because the published Astryx core and StyleX packages omit their license files.

## Content Security Policy

Astryx 0.7.16 normally injects positioning CSS into an inline style element. PF intentionally disallows inline styles. `scripts/finish-build.mjs` writes the exact `slideRulesCss()` from the pinned package to a static CSS file and inserts a link using its `SLIDE_RULES_ID`. Astryx detects that ID and skips injection. Recheck this pinned internal API and rerun browser checks under the production CSP before upgrading Astryx; do not loosen the CSP to make the prototype work.

## Scope and limitations

This is a capability preview, not a proposal to migrate PF's production UI wholesale. Astryx's prebuilt CSS and bundle add roughly 344 KB of compressed JavaScript for this prototype. Evaluate route splitting, production component needs and library stability before adopting it broadly. State resets on reload, the sample cost calculation is not a forecast, and reward/campaign actions never affect a real account.
