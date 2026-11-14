# First article: evidence, assets and review lifecycle

Checked 2026-11-14. The article is a narrative review, outside the published guide catalog. No third-party paper is redistributed.

## Evidence used

- **Belli et al. (2022)** — DOI `10.1007/s11747-021-00804-z`. Publisher abstract only. It reports 429 effect sizes, stronger behavioral than attitudinal findings, and variation by context. The article makes no pooled-effect or ROI claim and discloses limited access.
- **Leenheer et al. (2007)** — DOI `10.1016/j.ijresmar.2006.10.005`. Full author manuscript: https://repub.eur.nl/pub/9042/ERS-2006-076-MKT.pdf . Observational household data, seven programs and twenty chains, instrumental-variable model. Accounting for selection changes the estimate. The article's 8→8 / 3→3 diagram is explicitly invented, not study data.
- **Liu (2007)** — DOI `10.1509/jmkg.71.4.019`. Full author PDF: https://www.yupingliu.com/files/papers/liu_loyalty_program_effects.pdf . Selected sample of 1,000 members with at least two purchases, two-year convenience-store observation. No comparable nonmember control; the article preserves that limitation.
- **Nunes & Drèze (2006)** — DOI `10.1086/500480`. Full manuscript: https://faculty.wharton.upenn.edu/wp-content/uploads/2012/04/PSC.pdf . Randomized 300 cards (150 per arm): eight empty spaces versus ten with two bonus stamps; eight paid washes remained in both. Redemption: 19% versus 34%. No profit outcome.
- **Food Standards Agency et al. (2024)** — DOI `10.46756/sci.fsa.paq622`. Full report: https://science.food.gov.uk/article/123528.pdf . 32 randomized outlets, 29 completed the 2022 trial; no statistically significant increase in plant-based meal sales. Short duration and limited power. Bibliography follows the current HTML/PDF author list including FSA; Crossref omits the corporate author. Metadata are not mixed with the separate Sage paper.

The article discloses narrative selection, access limits, PF's commercial interest, and the absence of Guatemala/PF-specific validation.

## Illustrations — revised edition

The second review replaces the diagrams and stock photograph with two conceptual ink-and-gouache illustrations generated for this article. They do not depict data or real customers. AI assistance is disclosed in the article. Exact prompts, generation mode and file provenance are in `ILLUSTRATIONS.md`; image digests are in `assets.json`. The previous photograph's attribution remains in Git history with the first draft.

The main prose is shortened and addresses owners directly. Full APA references remain visible. Additional methods/access disclosures are in a native expandable note; essential causal and profitability qualifications stay beside the relevant claims.

## Review lifecycle

- Route: `/revision-editorial/7fc4175cd754b74d9ebe8791/`. The identifier limits discovery; it is not authentication.
- Content lives outside `public`; an exact allowlist exposes only HTML, CSS and the two illustrations. HTTP noindex/nofollow/noarchive/noimageindex, HTML noindex, and no-store are set. Sitemap, article catalog and public navigation remain unchanged.
- To withdraw: remove the middleware mount, route and assets in a subsequent API release.
- Publication requires the owner's editorial approval and a deliberate addition to the guide catalog. Do not remove noindex from this review URL as a shortcut.

## Verification

- 16 focused route/search/catalog tests passed, including GET/HEAD, headers, unknown files, aliases and absence from the sitemap.
- New JavaScript passed ESLint; server and middleware syntax checks passed.
- Chromium: 1440, 768, 390 and 320 px. No horizontal overflow, broken internal anchors, missing alternative text, unloaded images, font failures or console errors. Inspected desktop and mobile screenshots, including decoded responsive artwork and keyboard operation of the research disclosure.
- First-draft evidence/code review found small mobile SVG labels. The second edition replaces those diagrams entirely with original editorial artwork.
- Second-edition Impeccable detector: increased small credit text. Retained the user-required fonts and visually checked the display heading. Independent review requested image optimization; implemented 640/1152 WebP variants (about95/326KB per pair).
- No dependency changes, database migrations, worker changes or native app work.

Second edition: main prose 720 words; total body with notes and bibliography 1,041 words, compared with 2,186 previously. All five citations and APA entries retained.
