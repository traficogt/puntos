# First article: evidence, assets and review lifecycle

Checked 2026-11-14. The article is a narrative review, outside the published guide catalog. No third-party paper is redistributed.

## Evidence used

- **Belli et al. (2022)** — DOI `10.1007/s11747-021-00804-z`. Publisher abstract only. It reports 429 effect sizes, stronger behavioral than attitudinal findings, and variation by context. The article makes no pooled-effect or ROI claim and discloses limited access.
- **Leenheer et al. (2007)** — DOI `10.1016/j.ijresmar.2006.10.005`. Full author manuscript: https://repub.eur.nl/pub/9042/ERS-2006-076-MKT.pdf . Observational household data, seven programs and twenty chains, instrumental-variable model. Accounting for selection changes the estimate. The article's 8→8 / 3→3 diagram is explicitly invented, not study data.
- **Liu (2007)** — DOI `10.1509/jmkg.71.4.019`. Full author PDF: https://www.yupingliu.com/files/papers/liu_loyalty_program_effects.pdf . Selected sample of 1,000 members with at least two purchases, two-year convenience-store observation. No comparable nonmember control; the article preserves that limitation.
- **Nunes & Drèze (2006)** — DOI `10.1086/500480`. Full manuscript: https://faculty.wharton.upenn.edu/wp-content/uploads/2012/04/PSC.pdf . Randomized 300 cards (150 per arm): eight empty spaces versus ten with two bonus stamps; eight paid washes remained in both. Redemption: 19% versus 34%. No profit outcome.
- **Food Standards Agency et al. (2024)** — DOI `10.46756/sci.fsa.paq622`. Full report: https://science.food.gov.uk/article/123528.pdf . 32 randomized outlets, 29 completed the 2022 trial; no statistically significant increase in plant-based meal sales. Short duration and limited power. Bibliography follows the current HTML/PDF author list including FSA; Crossref omits the corporate author. Metadata are not mixed with the separate Sage paper.

The article discloses narrative selection, access limits, PF's commercial interest, and the absence of Guatemala/PF-specific validation.

## Figures and photography

- Original HTML/CSS/SVG: three-outcome concept, invented selection diagram, and experimental card structure. Captions distinguish conceptual content, invented values and the published experiment's design. No copied published figures. Mobile layouts use legible HTML/table equivalents.
- Bhuwan Bansal, *A coffee maker sitting on top of a counter* (2024-01-20). Source: https://unsplash.com/photos/a-coffee-maker-sitting-on-top-of-a-counter-DG49wcbrl7E . Free Unsplash License checked 2026-11-14: https://unsplash.com/license . Commercial use permitted; this is not CC0. Credit and license link appear in the article. Illustrative photography, not a PF customer or endorsement.
- Download: https://images.unsplash.com/photo-1705719418777-6ad45f437938?auto=format&fit=max&w=1400&q=82&fm=jpg . Local file `mostrador.jpg`, 1400×2100; digest in `assets.json`.

## Review lifecycle

- Route: `/revision-editorial/7fc4175cd754b74d9ebe8791/`. The identifier limits discovery; it is not authentication.
- Content lives outside `public`; an exact allowlist exposes only HTML, CSS and the photograph. HTTP noindex/nofollow/noarchive/noimageindex, HTML noindex, and no-store are set. Sitemap, article catalog and public navigation remain unchanged.
- To withdraw: remove the middleware mount, route and assets in a subsequent API release.
- Publication requires the owner's editorial approval and a deliberate addition to the guide catalog. Do not remove noindex from this review URL as a shortcut.

## Verification

- 16 focused route/search/catalog tests passed, including GET/HEAD, headers, unknown files, aliases and absence from the sitemap.
- New JavaScript passed ESLint; server and middleware syntax checks passed.
- Chromium: 1440, 768, 390 and 320 px. No horizontal overflow, broken internal anchors, missing alternative text, unloaded images, font failures or console errors. Inspected desktop and mobile screenshots, including the decoded photograph.
- Independent evidence/code review found small mobile SVG labels; resolved with mobile-specific readable layouts.
- Impeccable detector run: fixed skip-link hover contrast. Retained the user-required fonts; diagram internal padding and CSS checkmark borders are false positives. Display heading verified in screenshots.
- No dependency changes, database migrations, worker changes or native app work.
