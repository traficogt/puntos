# Merchant navigation checks

The merchant menu keeps five daily tasks visible and groups the remaining tools
in five Spanish disclosures; the two operational/power-user groups sit behind one
"Ver todas las herramientas" reveal. `src/merchant-navigation.js` owns labels and
group membership; `src/navigation.js` continues to own Spanish URL fragments and
legacy aliases. A page belongs to exactly one section. Grouping does not grant
access: each screen retains its existing plan and API checks, and pages whose
plan feature is off leave the menu once the plan loads. The public demo renders
its own flat, sales-focused menu (`demoNavigation`).

The selected group opens on page changes, including browser history and saved
links, and whenever the mobile menu opens. Owners may open or close additional
groups without leaving their draft. Selecting another page continues through the
existing unsaved-change confirmation. On mobile, successful selection closes the
menu and focuses the content; Escape closes the menu and returns focus to its
toggle. Native disclosure controls support Enter and Space.

Run from the repository root with the project's Node 24 toolchain:

```sh
npm ci --prefix web/merchant --ignore-scripts
npm test --prefix web/merchant
node web/merchant/tests/navigation-browser.spec.mjs
```

The browser runner requires the repository's Playwright dependencies and its
Chromium browser. Use the normal Playwright browser cache, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chromium executable. Missing
browser dependencies fail the run; there is no skip path.

The runner builds the actual merchant application into a fresh
`/tmp/pf-merchant-navigation-*` directory and serves it on loopback with the
production merchant HTML/CSP middleware. It does not write `public/merchant` or
connect to a database. Demo data stays in browser memory. External and API
requests are blocked, except four explicitly fulfilled, read-only fixture
responses for the plan restriction check; no request reaches a provider or live
API.

Twelve browser checks cover all 38 operator route selections, the 10-entry demo
menu, keyboard disclosures and the tools reveal, legacy deep links, back/forward
history, canceled/accepted draft abandonment, plan restrictions, mobile menu
reopening and focus, and theme switching/persistence at 1440px and 390px in light
and dark themes. Because the demo renders a flat menu, the runner builds the app
with a test-only switch (`menu=operador` in the URL) that renders the operator
menu over the in-browser demo data; the demo's own menu is checked separately. The four viewport/theme checks also
assert no horizontal overflow and run axe on the sidebar. Screenshots, axe JSON
and `result.json` are written to the printed artifact directory. These are
Chromium web checks, not native-device or Safari acceptance evidence.

Existing browser scenarios that select a grouped page should use
`helpers/navigation.mjs`'s `navigateMerchant(page, label)`. It opens the mobile menu
and the matching disclosure with ordinary clicks before selecting the visible
button. Do not force-click hidden page controls.
