# Article launch and weekly publication

**Goal:** Publish the approved first article now, write five complete follow-ups with citations and APA references, and release those weekly from Saturday November 21, 2026 at distinct randomly selected daytime hours in America/Guatemala (owner correction).

**Authorized direction:** The owner explicitly approved launch, five additional articles, weekly publishing and the illustration style. Retain the accepted concise article voice and fonts. No extra approval gate is needed for publication. Keep native apps and build services unchanged.

**Implementation:** Existing Express guide catalog stays the source of truth. Add strict scheduled timestamps and evaluate eligibility on every request, shared between article routes, hub and sitemap. Future articles remain 404/noindex and unlisted until their publication instant. Clock injection proves releases without restarting. Guide documents and sitemap bypass browser/server caches. Content remains server-owned JSON with escaped structured blocks, references and illustrations; no raw HTML input or CMS dependencies.

**Editorial:** Publish the first reviewed text without substantive rewriting. Prepare design, reward cost, threshold, endowed progress and progress-display pieces, approximately 500–700 words each plus references. Read original evidence, match citations to APA bibliography, record access limits, use original hypothetical examples, and disclose methodological limits near claims. Use the owner's selected Taller Lumière prose references and approved artwork. Preserve the first article's existing credit; the owner's general image-disclosure policy is still undecided.

**Ownership:** Root owns renderer, CSS, public imagery, service-worker handling, first article conversion, costs article, manifest integration and deployment. Independent writing agents own only their two draft JSON files and evidence notes. Scheduling agent owns catalog, guide/search middleware, schedule tests and publishing docs.

- [x] Publishable renderer: maintain approved reading experience with illustrated header, readable measure, linked author–date citations, full APA references, useful internal links, actual dates and Article metadata.
- [x] Scheduling: exact five Saturday timestamps, safe host/URL handling, no future disclosure, dynamic sitemap/hub/noindex, no stale cache, regression and boundary tests.
- [x] Six finished articles: verified original sources, arithmetic, readable prose and illustrations, no invented author credentials/results.
- [x] QA: focused route/schema/SEO/cache tests; browser at desktop/tablet/mobile; image loading, reference anchors, no overflow or console errors; simulate all dates against one server process.
- [x] Commit and push; checked API-only overlay deployment with health and rollback guards; live first article/hub/sitemap verification and future article 404 verification.
- [x] Report public link, five titles and dates, and publication mechanism. Record release evidence privately.

## Schedule

- 2026-11-14: ¿Funcionan los programas de fidelización?
- 2026-11-21 17:11 GT: Cómo diseñar un programa de fidelización.
- 2026-11-28 10:48 GT: Cuánto cuesta una recompensa.
- 2026-12-05 14:03 GT: Cuántas visitas para una recompensa.
- 2026-12-12 11:50 GT: La ventaja de empezar con sellos.
- 2026-12-19 12:39 GT: Cómo mostrar el progreso.

The owner requested varied random times instead of 09:00. Each saved local time is UTC−06:00; times were sampled once and do not change at runtime. Static committed schedules survive restarts and require neither Codemagic nor a future assistant session. A missed request at release time does not skip publication: the next request after the instant sees it.

## Validation evidence before deployment

- All six articles reviewed for citations, APA metadata, access notes and arithmetic. First approved text, both illustrations and captions retained.
- Browser checks: hub + all six article pages at 1440, 768, 390 and 320 px; no overflow, missing images or page errors; every reference link/target verified. Actual rendered desktop/mobile header, body, notes and bibliography inspected.
- TypeScript check passes using existing matching merchant dependencies (no dependency changes). Gallery fixture tuple annotation corrected. Targeted ESLint passes. Impeccable static scan reports no findings; rendered browser checks supply the visual verification it cannot perform.
- Independent read-only code review found no actionable issues.

## Live deployment

API-only release `puntos-api:articles-launch-20261114-51a8fbf` deployed 2026-11-14T21:31:55.514910+00:00. Health check passes; worker image unchanged. 27 public HTTP checks pass: hub and first article return indexable200, all five future articles return404/noindex, documents and sitemap carry no-store, both artwork sizes load, public home/support/legal pages return200, and www redirects to the canonical host. Source commit `51a8fbfb2783b4e01e221bee5e3a37c2643c02b1` is pushed. Private deployment and rollback evidence: `/var/lib/puntos/releases/articles-launch-20261114/`.

Owner-requested time change deployed in `puntos-api:articles-random-times-20261114-9c6e851` at 2026-11-14T21:36:36.883954+00:00. Saved local times: Nov21 17:11, Nov28 10:48, Dec5 14:03, Dec12 11:50, Dec19 12:39. The updated calendar passes 22 scheduling/search tests; live checks pass, and each release boundary was rechecked inside the production image. Evidence: `/var/lib/puntos/releases/articles-random-times-20261114/`.
