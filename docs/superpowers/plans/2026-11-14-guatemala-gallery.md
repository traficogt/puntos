# Guatemala illustration gallery implementation plan

**Goal:** Produce five geographically grounded Guatemalan scenes in the approved ink-and-gouache style, including Parque Central in Guatemala City, and publish another image-only unindexed review gallery.

**Architecture:** Extend the existing allowlisted illustration review middleware with a second collection. Retain the existing gallery, image-only enlarged views, responsive delivery and noindex/no-store headers. No native releases or public navigation entries.

**Tech stack:** Built-in image_gen with approved style and photographic reference inputs; Express; static HTML/CSS; existing Chromium for delivery encoding and browser QA.

## Approved direction

The owner approved the previous illustrations and image-only gallery and requested five Guatemalan scenes with realistic scale, direction and detail. Carry forward that visual design; subjects are Parque Central (capital), Antigua, Panajachel/Atitlán, Xela and Flores. Use place-specific architecture and everyday life, with restrained color and no added national-symbol decoration. Photographic inputs are internal reference material, not publicly redistributed assets. Generated scenes remain illustrations rather than architectural surveys.

## Execution

- [x] Inspect approved art and real photographic references for all five places. Record source URLs and specific geometry constraints in internal provenance.
- [x] Generate each scene separately with the built-in image tool; inspect full-size compositions for recognizable architecture, orientation, proportions, people and boat geometry. Correct material defects before publishing.
- [x] Save five original PNGs plus complete prompts and hashes under `src/content/guatemala-review/`. Create 768px/1536px WebP delivery files, an image-only index and five larger HTML views.
- [x] Extend `src/middleware/illustration-review.js` with an explicit second collection and exact allowlists; apply the same redirect, method, noindex and cache rules. Preserve the prior collection.
- [x] Extend `tests/unit/illustration-review.test.js` to exercise both collections, unknown/source paths and unindexed assets. Run focused preview and service-worker checks, then browser checks at desktop/mobile sizes with no visible text or console errors.
- [x] Review diff; commit and push the existing review branch. Build a checked API-only overlay over the running release, deploy with health check and rollback guard, then verify all served assets match reviewed files and prior public surfaces remain available.
- [x] Prepare the delivery URL and local originals/prompts index. Keep internal provenance available without adding visible page text.

## Verification before release

All five generated originals were individually inspected against their location photographs. No material architecture, horizon-order or human/boat placement defect was found. Atmospheric color, minor surface detail and incidental pedestrian activity remain artistic interpretation. The source photos are retained outside the repository under the deployment working directory; internal source URLs accompany each prompt.

23 focused tests passed covering both galleries, editorial previews, public SEO routes, guide publishing and service-worker preview bypass. Lint and whitespace checks passed. Chromium checks at 1200, 768, 390 and 320 CSS pixels confirmed five loaded illustrations, no visible text, no horizontal overflow, accessible image descriptions, keyboard enlargement/return, and no browser errors. The one Impeccable detector warning is the approved warm paper palette, deliberately retained from the user's accepted illustration style.

## Release result

API-only release `puntos-api:guatemala-gallery-20261114-bd4f57f` is healthy. The running worker is unchanged. All 17 gallery documents and delivery assets match the reviewed file hashes and send noindex/no-store. Private prompt/manifest/original paths return 404. The public homepage, sitemap, prior article preview and ten-image gallery continue to return HTTP 200. Live Chromium checks at 1200px and 390px pass with five loaded images, no visible text, no overflow and no console errors.

Review URL: https://puntosfieles.com/revision-ilustraciones/aa93b82b2b9f4e6979c8a2b4/

Originals and prompts: `src/content/guatemala-review/PROMPTS.md`.
