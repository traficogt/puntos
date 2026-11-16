# Article capability alignment

**Goal:** Audit all six canonical articles against shipped browser features, correct misleading operational examples, and add restrained, useful product references.

**Design:** Keep the research independent of the product. Distinguish observed research, invented worked examples, manual recommendations and verified PF features. Add one optional `productNote` per article, after the prose and before methodology/references. Use a small heading, ordinary text and one public help link. Start with three notes (design/practice, cost reporting, customer progress); omit notes where they would be forced. Remove the repeated sales pitch at the article end. Preserve fonts, artwork, source passages, APA references and publication times.

**Architecture:** Repository-owned content and the existing Zod catalog/SSR renderer. No database, ledger, customer app, dependency or native build changes. No new analytics claim without a working report. Current gaps are evaluated in the audit, not automatically declared delivered.

## Tasks

- [x] Read every canonical article and trace operational claims to UI, API and help; obtain two independent audits.
- [x] Create isolated worktree, preserve owner edits, run baseline editorial checks (33 passed).
- [x] Add tests for optional product-note escaping, accessible labelling, internal-help-only targets and absence when not supplied.
- [x] Add optional strict `productNote: {text, href, linkText}` schema (text <=560, link label <=120, href restricted to `/ayuda/` paths), a small semantic aside and restrained styles.
- [x] Correct the bakery earning/practice example; clarify separate first-buyer follow-up and incomplete observation windows; clarify physical-card/presentation experiments and manual threshold tracking.
- [x] Add three verified feature notes with relevant help links and material limits. Keep archived draft/source evidence untouched and explicitly labelled historical. Correct the still-served original review's arithmetic and label it historical with a link to the current article.
- [x] Save an article-by-article evidence matrix and prioritized gap evaluation in `docs/ARTICLE_CAPABILITY_AUDIT_20261116.md`. Document the editorial rule in `docs/GUIDES.md`.
- [x] Run existing editorial/citation/scheduling tests plus new rendering tests, focused lint/typecheck and six-article desktop/mobile browser verification. Inspect screenshots of notes; verify all linked help pages.
- [x] Obtain independent review; resolve both content findings (qualified reporting scope and dated software references).
- [ ] Commit, merge, push and deploy website-only changes using the current API image as the base with rollback available. Check live article/previews/help links, schedule/privacy headers and health. Completion is recorded in the external release evidence folder.

## Acceptance

- Every article remains useful without buying PF; studies are not altered to fit the product.
- No repeated promotional footer or in-body sales pitch; three concise, optional help notes.
- Product references describe browser features with inputs and plan limits where relevant.
- No automatic weekly first-purchase/30-day cohort, universal welcome stamps, dynamic progress framing, minimum-per-visit or daily award-cap claim.
- Article schedule, citations, references and artwork are unchanged. No native app release.
