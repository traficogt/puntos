# Guided demo and broad functional bug hunt

Approved scope: an optional short owner walkthrough, continued access to every
demo screen, and broad website/server debugging. Native apps and builds stay
unchanged. Production data is not used as a test fixture.

## Demo implementation

1. Add `web/merchant/src/demo-guide.js` with three ordered screens: `recovery`,
   `growth`, `economics`. Parse `vista=inicio|guia|libre` from the URL; explicit
   screen links default to free exploration. Build same-origin URLs while
   preserving the existing `demo=1` development mode. Unit tests cover invalid
   modes, legacy fragments, canonical fragments and unrelated parameters.
2. Add `DemoGuide.jsx` using the installed Mantine controls. The entry offers
   “Ver un ejemplo” and “Explorar todas las funciones”. Each guided screen has
   one practical instruction, previous/next controls and an exit. Keep visible
   fictional-data and plan-availability notices. No invented ROI or claims that
   a newly edited draft produced historical results.
3. Integrate into `main.jsx`: share the existing dirty-form confirmation for
   guide and sidebar navigation; restore both screen and mode on browser history;
   focus the content when changing steps. Default entry shows the choice before
   the full dashboard. Deep links bypass the entry. Reuse `styles.css` fonts and
   palette and provide mobile/dark-theme layouts.
4. Extend `web/merchant/tests/navigation-browser.spec.mjs` to check entry, all
   three steps, exit/restart, direct links, history, dirty cancellation, keyboard,
   narrow viewport, dark theme and no live API/provider traffic. Existing 26-route
   coverage remains. Update the public “Explora más funciones” link to explicitly
   choose free exploration.

## Parallel functional review

- Customer/Wallet agent: customer enrollment/session/preferences, progress,
  browser caching, pass payload and update behavior.
- Operations/POS agent: staff scan/award/redemption context, offline queue,
  purchase/refund adapters and job lifecycle.
- Merchant agent: campaigns/audiences/measurement, reward costs, inventory,
  imports, currency and merchant workspace error states.
- Parent: public/demo navigation, cross-area integration and release checks.

Every fix requires a concrete observed failure and a regression test where the
behavior has material consequences. Record areas examined without implying that
all possible defects or provider/device behavior have been established.

## Integration and release

Review and cherry-pick agent commits; obtain an independent review. Run the
merchant tests/build and isolated browser navigation, then build the final assets
and advance the service-worker cache version once. Run the full exact-commit
release-readiness suite from a non-hidden disposable checkout with synthetic DB,
plus focused new regressions and existing WebKit/workload checks as relevant.

Use a new private release directory, verify source/image hashes, take and verify
a database backup, deploy API/worker with the guarded release script, check public
routes and browser assets, and merge/push the reviewed commit to main. Preserve
the owner's three existing dirty root files. Publish concise coverage/results and
remaining physical-device/provider limitations.
