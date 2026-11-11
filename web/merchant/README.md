# Merchant website

React 19.3 + Mantine 9.8 with Recharts. Separate dependencies and release cadence
from `apps/customer`. Express serves `/merchant/`; existing administration remains
at `/admin-dashboard`. Owner login opens the merchant overview; managers retain
the existing staff workflow.

Run from the repository root:

```sh
npm ci --prefix web/merchant
npm --prefix web/merchant test
npm --prefix web/merchant run build
PLAYWRIGHT_BROWSERS_PATH=0 node web/merchant/tests/browser.spec.mjs
```

The build writes `public/merchant` and includes dependency notices. The browser
check uses a local static server and synthetic fixtures; it never sends production
requests. Screenshots and test evidence are written to the release evidence path
in the script. Backend tests use a disposable database explicitly supplied via
`MERCHANT_OVERVIEW_TEST_DB_URL`.

`src/middleware/merchant-web.js` adds a fresh nonce to generated HTML and the
style policy; Mantine uses it for runtime style tags. The service worker does not
cache merchant HTML or APIs. Hashed JavaScript/CSS remain ordinary static assets.
Do not serve the HTML directly from a CDN without preserving this nonce handling.

Analytics count purchase records with a positive amount, visits or items, valid
purchase source/type/status and no reversal. They are program-recorded activity,
not all POS sales or proof of causal revenue. The configured server timezone
controls dates; today and the comparison endpoint are partial days. Existing
native APIs and commercial feature gates remain unchanged.

Campaign forms edit the existing rules API. Templates remain disabled drafts
until explicitly activated and saved; no outbound messaging occurs. Existing
unsupported configurations link to advanced administration. The client checks for
intervening edits before saving, but the existing API is not an atomic revision
protocol: avoid simultaneous edits from multiple admin sessions.

The npm archive of react-remove-scroll-bar 2.3.8 declares MIT but omits its license
file. `licenses/react-remove-scroll-bar-MIT.txt` retains the upstream notice from
https://raw.githubusercontent.com/theKashey/react-remove-scroll-bar/master/LICENSE
retrieved 2026-11-10. Other runtime notices are copied from the installed archives.

## Password-free preview

Open `/merchant/?demo=1` to explore synthetic business data without signing in.
The preview API module handles every request in memory and rejects unsupported
operations; it never falls through to the real API. Campaign edits last until
reload. The sample enrollment QR points back to the preview and registers no
customers. Exiting preview does not log out a real account in another tab.
Verify this boundary with:

```sh
PLAYWRIGHT_BROWSERS_PATH=0 node web/merchant/tests/preview.spec.mjs
```
