# Merchant capability discovery and browser reliability

> For agentic workers: use isolated worktrees for independent tasks, then spec and quality review before integration. The owner approved implementation; preserve native apps and existing local edits.

**Goal:** Make selected PF capabilities understandable to prospective owners, reduce navigation overload, and improve browser/workload verification.

**Architecture:** Keep the existing marketing HTML/CSS, React/Mantine merchant interface, Spanish routes, Playwright and isolated Docker/PostgreSQL fixtures. All public claims describe implemented behavior, not proven business results.

## Approved scope

- [x] Landing: replace the existing broad business block with one prominent illustrative recovery example and four concise supporting capabilities: reward budgets, bounded staff authority, campaign measurement, and multiple locations. Exclude integrations from this showcase. Clearly say this is a selection of capabilities, not the complete feature list; preserve plan-dependent qualification and link to demo and plans. Keep existing fonts, contact form, Turnstile and Wallet badges. Files: `public/index.html`, `public/styles/marketing.css`, relevant marketing browser checks. Inspect at 390 and 1440 pixels; check links, no horizontal overflow, and truthful example labeling.
- [x] Merchant navigation: replace the 26-item flat list with a short everyday section and expandable Spanish task groups, preserving every existing route, selected-page visibility, keyboard controls, mobile behavior and unsaved-change protection. Extract the catalog into a module, with coverage for every known route exactly once. Files: `web/merchant/src/main.jsx`, `navigation.js`, new `merchant-navigation.js`/component, merchant tests. Use existing Mantine components and production build; no new UI framework.
- [x] Browser engine coverage: add focused WebKit customer/enrollment web tests with existing Playwright fixtures, rather than pretending Chromium establishes Safari behavior. Keep browser-specific launch flags scoped correctly. Include explicit test selection/count checks, zero silent skips, local Linux execution and CI when reasonable. Do not build native apps or claim iPhone/Wallet-device acceptance. Own config and a dedicated focused spec/runner plus tests and documentation. Preserve existing Chromium suites.
- [x] Representative workload/recovery: extend existing tooling with an opt-in isolated scenario exercising real customer/merchant application requests and bounded purchase/retry/refund operations against synthetic fixture data. Record correctness and latency separately; test restart or interrupted-response recovery with stable request identity and no duplicate effects. Only disposable local databases and dummy providers; refuse production targets/config and never probe live customers, send messages or alter deployed data. Reuse existing fixtures and contracts, not a new performance framework. Keep old read-only load CLI compatible. Own new workload runner/test/docs; coordinate package scripts centrally.
- [ ] Integrate and review: inspect each diff, run focused behavioral tests and applicable unit/typecheck/lint/browser/build gates. Production bundle belongs to the parent integration task. No native source or dependency edits. Push reviewable work, then deploy through the existing guarded release process if all checks pass; preserve backup/rollback evidence and compare served artifacts.

## Review criteria

- All five public capabilities map to implemented screens; location/cost/campaign statements do not promise guaranteed revenue, complete POS capture or financial accounting values.
- Navigation keeps all capabilities reachable and opens the selected group for deep links, browser history and mobile entry.
- WebKit evidence is labeled web-engine verification and missing browser dependencies fail rather than skip.
- Workload tooling cannot accidentally target live data and reports actual outcomes, not merely HTTP 200s. It is ordinary functional/performance verification, not a continuation of previously blocked security audit work.
- Native workflows remain manual and existing installed APIs unchanged. Final results distinguish code/browser evidence from physical/provider acceptance.

## Landing verification and visual provenance

`public/images/merchant-recovery-preview.jpg` is a browser screenshot of PF's own existing `/demostracion/#recuperar-clientes` screen at source `c8546d7`, captured locally on November 15, 2026. Only built-in fictional demo data were used, external requests were blocked, and no production customer records were queried. The crop shows the actual recovery heading, filter and table; it does not include the navigation being changed by this release. The public caption explicitly identifies fictitious data. This is a product screenshot, not generated artwork.

Five marketing browser scenarios pass, including the actual deep link from the new section, the existing simulated reward flow/contact payload, mobile overflow, and no-JavaScript content. Twelve related unit contracts pass. The baseline had one stale marketing test pointing to a removed contact-link label; it now follows the existing “Hablar con nosotros” link. Render inspection covered 320/390/768/1440 widths. Impeccable reports established font/palette warnings, which are required by the owner's retained design, and wrapper-padding heuristics; rendered section spacing was checked rather than changing the established design to satisfy these heuristics.

## Integrated verification

The grouped merchant navigation passed 142 unit tests and nine production-build browser checks (all 26 routes, history, draft protection, plan restrictions, desktop/mobile, light/dark, focus and sidebar accessibility). The combined homepage passed five browser scenarios. The WebKit gate passed all four named customer flows with zero skips or retries against disposable fixtures. The workload scenario passed 99 measured requests, seven purchase/refund pairs including response-loss/restart replay, exactly 14 final transaction rows, and zero unexpected errors or duplicate effects. These checks establish the tested browser/application behavior, not provider/device acceptance or production capacity.
