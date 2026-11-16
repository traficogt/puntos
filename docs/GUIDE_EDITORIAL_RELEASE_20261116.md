# Article examples and illustrations — November 16, 2026

This pass applies the owner's request for varied PF examples, calculator links
in relevant articles, and at least one illustration within each article in
addition to its hero. It changes the canonical guide manifest, not the saved
publication schedule. Existing study settings, research findings, citations and
APA references remain intact.

## Editorial changes

The six own examples now use a laundry, a bakery with a bread reward, a bookshop
with a notebook reward, a barbershop, a bicycle workshop, and a plant shop.
These are explicitly hypothetical PF scenarios. The real carwash experiment,
university café experiments, South Korean restaurant, Dutch supermarkets and
other study contexts remain as previously reviewed. Café settings in original
research have not been renamed to fit the editorial variety.

The first article's own calculation now includes an explicit Q2 future-reward
allowance: Q160 ÷ (Q16 − Q2), rounded up to 12 purchases. The cost article adds a
Q3 allowance (a notebook costing Q9 per three new purchases):
Q840 ÷ (Q28 − Q3), rounded up to 34. This keeps the examples consistent with the
calculator's treatment of rewards earned by the hypothetical additional
purchases. Neither is measured return or evidence of PF effectiveness.

The barbershop's invented visit intervals are four and eight weeks. Starting
after the first visit, six required purchases leave five intervals (20 or 40
weeks), and ten leave nine intervals (36 or 72 weeks). A Q12 reward spread over
six Q80 purchases is Q2 per purchase and 2.5% of sales; over ten it is Q1.20 and
1.5%. These are direct reward costs, not total profit margins. The public
methodology note now identifies the barbershop as the hypothetical example;
its description of the original café study is unchanged.

Five articles that discuss cost or funding link `/calculadora`: whether programs
work, program design, reward costs, visit thresholds, and welcome stamps. The
progress-framing article keeps its focus and does not receive an unrelated tool
link. The existing first article already has an in-body illustration and retains
it. The five scheduled articles each gain one.

For prose, the designated style reference was read on November 16, 2026:
[Exposición I](https://edu.tallerlumiere.com/tecnica/exposicion-i/) and
[Albert Renger-Patzsch](https://edu.tallerlumiere.com/perfiles/albert-renger-patzsch/).
The changes use concrete examples followed by explanation and distinctions. No
wording, personal experience or factual claim from those articles is transferred
to PF. This is not a new literature review; the previously verified source
passages and references are protected by regression checks.

## Illustration provenance and inspection

The five additional illustrations are exact copies of the 1536×1024 and 768×512
WebP deliveries in the approved gallery. No regeneration, cropping, compositing
or image-content edit was made. Their full prompts, source image hashes and
generation provenance remain in
[`src/content/illustration-review/PROMPTS.md`](../src/content/illustration-review/PROMPTS.md)
and [`assets.json`](../src/content/illustration-review/assets.json). The original
PNGs remain in that gallery's `originals/` directory. They were generated with
the built-in image tool on November 14, 2026. They are not photographs of the
businesses or research establishments.

| Article | Public body-image stem | Approved source | Inspection and editorial role |
| --- | --- | --- | --- |
| Program design | `disenar-ensayo` | `10-ensamble` | The full original shows supported instruments, coherent standing/seated scale and contact with the floor. The ensemble accompanies the explicit rehearsal step, as a conceptual image of coordinated tasks. |
| Reward cost | `costos-libreria` | `08-libreria` | The reader holds the book; chair, table, cat and shelves have coherent scale and support. The illustration gives the own bookshop example a setting without presenting it as a real PF merchant. |
| Visit thresholds | `visitas-comercios` | `01-plaza` | The full original has coherent elevated perspective, supported storefronts, pedestrians scaled to doors and paving. It is an imaginary neighborhood, not a claimed Guatemalan landmark. Its caption connects different businesses to different visit rhythms. |
| Welcome stamps | `avance-bienvenida` | `06-confianza` | The envelope, key, wax seal and leaf form a clear supported still life, without a geographic or anatomical claim. It accompanies the explicit terms of the welcome promise. |
| Progress framing | `progreso-puente` | `07-puente` | The arch spans the stream, people are scaled to the crossing, and the figures' gestures and ground contact were checked. The image distinguishes the two ends of a single route without suggesting a measured research result. |

The barber illustration was inspected but not selected: its mirror repeats
similar-facing profiles, leaving reflection geometry uncertain. Its original
gallery files were not changed. No location-specific Guatemala image was needed
for these five conceptual/editorial roles. Each public figure has descriptive
alternative text and a caption that establishes its connection to the article.

The program-design hero now references `disenar-v2-1536.webp` and
`disenar-v2-768.webp`. The coordinating release owns those corrected files and
their updated watch illustration provenance in the gallery's `PROMPTS.md` and
`assets.json`. This commit only selects the corrected hero and changes its alt
text to identify a pocket watch opened from the back; it does not overwrite the
watch originals or duplicate the coordinator's artwork commit.

## Verification and integration

The new unit checks assert that all six articles retain their dates, statuses and
scheduled instants; compare APA metadata and the previously reviewed study
passages; require hero plus responsive body imagery; check relevant calculator
links; and compare the five delivered image pairs byte-for-byte with their
gallery sources. One numeric bridge inside a cited paragraph changes from
thirty to thirty-four own-example purchases; the test normalizes only that
phrase before comparing the otherwise unchanged study paragraph.

The existing guide tests continue checking citation/reference matches, image
existence, schema, escaping, preview isolation and scheduled publication. A local
browser fixture renders all six articles at 1440px and 390px, decodes each hero
and body image, checks responsive sources, citation targets, calculator links
and page overflow. It does not alter the actual public schedule. Captures are
written to the ignored `.impeccable/review/editorial/` directory.

Run:

```sh
node --test tests/unit/guides-calculator-editorial.test.js tests/unit/guides-editorial.test.js tests/unit/guides-schedule.test.js tests/unit/guides.test.js tests/unit/guide-previews.test.js
node --test tests/integration/guides-editorial.browser.test.js
```

The source-audit files under `src/content/guides/drafts/` preserve the earlier
reviewed draft examples. This document records the newer own-example arithmetic
for the canonical manifest; it does not silently rewrite those research records.
Integrate after the separate corrected-watch asset commit and alongside the
calculator route. No native app change or independent deployment is included.
