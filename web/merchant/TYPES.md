# Merchant browser type checking

Run from the repository root after installing both lockfiles (Node 24):

```sh
npm ci --ignore-scripts
npm --prefix web/merchant ci --ignore-scripts
npm --prefix web/merchant run typecheck
npm --prefix web/merchant test
```

The workspace uses the root's pinned TypeScript 7 compiler and has direct,
locked React 19 and React DOM type dependencies.

`typecheck` runs two complementary passes:

- `tsconfig.json` checks every file under `src`, the Vite configuration, build
  scripts. `allowJs` and `checkJs` are enabled, so every
  existing React JSX screen, model and demo module participates. The legacy
  baseline has `strict: false`; implicit `any` and nullable state remain in
  unannotated JavaScript. It does not represent a completed strict migration.
- `tsconfig.strict.json` checks every TypeScript/TSX source and contract fixture
  with `strict: true`. Imported legacy JavaScript is checked by the first pass,
  rather than pretending that it meets strict mode. New TSX screens are included
  automatically. `typecheck:contracts` runs this strict pass alone.

Both passes use real Mantine, React and DOM definitions. `skipLibCheck` skips
third-party declaration internals, not our source. `/lib.js` maps to the existing
public transport declaration because that module is served separately by the
application. No merchant source file is excluded or marked `@ts-nocheck`.

The legacy JavaScript browser harnesses and runtime unit tests are deliberately
outside this static migration. They still execute through `npm test` and local
browser checks; `tests/types` contains separate compile-time tests.

## API and form boundaries

`api-contracts.ts` defines reviewed endpoint relationships for region and launch
program reads and writes. Its transport takes `unknown` JSON and asserts the
server contract at one explicit boundary. Its mutation helper serializes the
same payload, method, signal and options as the existing code. It is used by
RegionSettings and LaunchProgramEditor; Launch's program read also uses the
reviewed resource contract. The definitions mirror `merchant-region-service.js`
and `merchant-launch-service.js`.

`typed-api.ts` also exports `request<Response>` for other endpoints with a
caller-owned response interface. Omitting the response interface yields
`unknown`. This is a static contract, not runtime JSON validation. Existing
unmigrated callers of `api.js`/`useResource` still inherit the legacy transport's
untyped response. They receive baseline JSX checking but do not yet receive
complete property checks for every endpoint. Add reviewed contracts as those
screens change; avoid blanket response index signatures.

Program form input permits unfinished strings and a missing legacy rate;
ProgramUpdate requires a numeric rate after the existing Mantine validation.
RegionDraft/RegionUpdate distinguish edited values from the required concurrency
version. RewardPayload explicitly types the validated reward and optional
inventory mapping. Mantine NumberInput and Select are specialized in `inputs.ts`
to decimal numbers and string IDs, preserving the original components without
runtime wrappers. Numeric input state still permits unfinished strings.

`tests/types` contains positive examples and `@ts-expect-error` negative tests:
unknown endpoint paths, wrong response properties, missing region fields, text
instead of a numeric rate, unvalidated form payloads, unknown generic JSON,
nullable resources, and wrong input value types. The directive makes the test
fail when a formerly rejected expression becomes accepted.

## Runtime verification

```sh
PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright node web/merchant/tests/typecheck-boundaries-browser.spec.mjs
PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright node web/merchant/tests/launch-activation-browser.spec.mjs
PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright node web/merchant/tests/branded-qr-browser.spec.mjs
```

These checks use isolated fixtures/demonstration data and temporary builds;
there are no production API calls or native builds. The boundary check exercises
the actual built chart's accessible name and region save. The launch fixture
checks numeric program submission and the current persisted rehearsal protocol,
including reload/reset, on desktop/mobile in light/dark themes. The QR fixture
checks rendering, scan verification and accessibility. Test output gives the
actual result; passing static checks alone does not establish browser behavior.
