# Simplify the calculator implementation plan

**Goal:** A business owner can get a reward budget from two numbers.
**Architecture:** Local HTML/CSS/JS, a small pure quick-calculation module using
shared currency/number utilities, and the existing detailed calculator retained
unchanged in function at a secondary route.

- [x] Add model regressions for two-input budget, optional expenses, extra-sales
  allowance, missing inputs, currency precision, nonpositive contribution and
  arithmetic limits. Confirm missing quick model fails.
- [x] Implement `public/calculator/simple-model.js` with bounded numbers and no
  inferred costs, conversion, growth or PF prices. Keep advanced model unchanged.
- [x] Move existing HTML to `public/calculator/detallada.html`; adjust canonical,
  noindex and back link. Add canonical route/alias redirects in self-service web.
- [x] Replace `public/calculadora.html`; add `simple.js` and `simple.css` for two
  required money/count fields, native details for extras/examples, optional return,
  safe DOM updates, clear validation, stale results, reset and print.
- [x] Update existing calculator browser fixture to retain detailed coverage;
  add simple budget and return lifecycle, keyboard/mobile/AXE/CSP tests in the
  same CI-selected file. Verify route and search visibility for detailed mode.
- [x] Update calculator documentation and preserve article/help links. Run model,
  browser, routing, type/lint/security checks and inspect actual screenshots.
- [ ] Merge/push, deploy the website/server image with rollback available, verify
  public pages and interactive simple/detailed calculations. Native apps unchanged.

Release execution is recorded separately under
`/var/lib/puntos/releases/calculator-simple-20261116/`.
