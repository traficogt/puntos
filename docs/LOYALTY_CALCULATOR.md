# Public loyalty calculator

The public `/calculadora` page starts with a simple two-input reward budget.
The original three-step calculator remains at `/calculadora/detallada`. Both have no
API calls, storage, account requirement, lead form, or merchant-setting writes.
It inherits the existing public website fonts and colors. This is website work;
it changes no native application or build workflow.

## Integration

- Serve `public/calculadora.html` at `/calculadora` using the marketing host's
  usual public-page routing; redirect the `.html` alias to the canonical route
  if that is the central routing convention.
- Serve the dedicated `public/calculator/` assets and the existing
  `/regional-catalog.js`, `/styles/fonts.css`, `/styles/marketing.css`, fonts and
  logo. No new package, API, CSP exception, or database migration is needed.
- Add the route to central navigation, sitemap and relevant articles in the
  containing release. This implementation intentionally does not edit those
  shared files.
- The calculator links the guide currently published on November 16, 2026,
  `/guias/funcionan-los-programas-de-fidelizacion`, and the guide hub. It does not
  link future scheduled articles before their publication.

## Simple default (owner feedback, November 16)

`public/calculator/simple-model.js`, `simple.js` and `simple.css` implement the
new default. The only initial numerical inputs are reward delivery cost and the
number of rewards to cover in a month. Currency remains selectable; optional
monthly expenses and fictional examples are closed native details disclosures.
Missing costs never silently become zero. An omitted monthly-expense total is
explicitly excluded. This total may include the PF quote, messages and operations. Lost contribution
from displacing a paid sale belongs in the per-reward cost, so it is also
reserved for rewards earned by new sales. No price is invented.

An optional return section opens only after a valid budget. It asks the amount
left from a sale after ordinary variable expenses, purchases needed for a reward,
and optionally additional sales to simulate. Available money from each extra
sale = entered amount − reward cost / purchases per reward. The additional-sales
threshold uses exact integer minor-unit/rational arithmetic for the budget and
per-purchase reserve, avoiding cancellation-induced extra purchases. Zero or
negative available amounts cannot cover a positive budget. Unknown additional
sales produce no scenario balance. These sales are separate from the activity
behind the starting budget; their new reward obligations must not be counted in
both places. Results are estimates of included costs, not predictions or profit.

Changing budget inputs hides all results; changing optional sales inputs hides
only the return result and removes its stale print assumptions. Reset clears
both forms. Printing includes the current budget and only a valid return result, even when
the return disclosure has been collapsed. Nonzero balances below the currency
minor unit are shown as less than that unit rather than falsely displayed as zero.
There is no local storage, write request or provider dependency.

The detailed page is noindex and linked in both directions. Its static HTML alias
redirects to the canonical secondary route. Existing article/help links still
open the simple calculator. It preserves multiple rewards, detailed cost inputs,
redemption scenarios, margin/variable-cost options and text export.

## Detailed calculator arithmetic and assumptions

`public/calculator/model.js` exports the pure calculation model. All inputs use
one month and one currency. The supported catalog is shared with the website and
server. Currency formatting shows the code; CLP accepts whole monetary units,
the other supported currencies accept two decimal places. A per-purchase future
reward allowance accepts six decimals because it represents an allocation.
Changing the currency never converts amounts.

For each reward, the user enters a whole number of base units and its delivery
cost. Retail price is optional reference information and is never substituted
for delivery cost. A discount's cost is the forgone amount, counted once; the
paid purchase amount is entered before that program discount. For a service,
optional lost contribution from displacing another sale is separate from its
delivery cost. Blank costs are unknown; an entered zero is confirmed. A zero
quantity has zero exposure even if its unit cost is unknown.

The full reward budget is the sum of every base unit's delivery cost and any
entered service opportunity cost. The scenario multiplies each reward's units
by the chosen redemption percentage and rounds units upward. A lower redemption
scenario never removes the full budget. An unknown base reward cost blocks a
complete budget and threshold, including in a zero-redemption scenario.

Optional monthly subscription, messaging and extra operations are added once.
Setup expense is divided by the entered 1–120 months; the page distinguishes
that allocation from the initial cash payment. Blank optional charges are
excluded and listed in the on-screen and exported summary. No PF price is
assumed, including in the examples.

Purchase contribution is either average paid purchase times contribution margin,
or average paid purchase minus its ordinary variable cost. The two methods are
mutually exclusive, so ordinary variable cost is never subtracted twice. Negative
contribution is supported. Future rewards earned by each additional purchase
require an explicit allowance at 100% fulfillment, or an explicit confirmation
that those purchases earn none. The allowance is subtracted from the per-purchase
contribution before calculating either threshold. It is not reduced by the base
redemption scenario.

The additional-purchase threshold is the ceiling of the base scenario budget
divided by available contribution per purchase. The full-budget threshold is
also displayed. A positive budget cannot be covered by nonpositive available
contribution. Zero included budget requires zero extra purchases. The optional
additional-purchase hypothesis determines contribution after the program:
additional purchases times available contribution, minus the scenario budget.
A blank hypothesis does not mean zero or predicted growth. This is not observed
return, accounting liability, or net profit; causal attribution and unentered
costs are outside the model.

The model rejects nonfinite, negative cost, fractional quantity, overprecision,
unsupported currency and out-of-range inputs. Bounds are 12 reward types,
1,000,000 units per type or additional purchases, 1,000,000,000 per amount, and
1,000,000,000,000 for calculation totals and a calculable threshold. Margin is
bounded from −100% to 100%. Decimal comma or decimal point is accepted; grouping
and exponent syntax must not be used. Display rounding is separate from the
unrounded arithmetic used for the threshold.

The blank own-business path is primary. The four explicitly fictional examples
cover a retail product plus discount, salon service with opportunity cost,
carwash service with available capacity, and café beverage. The examples state
their per-purchase allowance rule and claim no typical margin or PF performance.

## Verification

Run with the repository's Node 24 toolchain:

```sh
node --test tests/unit/loyalty-calculator.test.js tests/unit/simple-calculator.test.js
node --test tests/integration/loyalty-calculator.browser.test.js
node node_modules/eslint/bin/eslint.js public/calculator/*.js tests/unit/loyalty-calculator.test.js tests/integration/loyalty-calculator.browser.test.js --max-warnings=0
```

The model tests exercise full/scenario budgets, multiple reward types, confirmed
zero versus unknown, opportunity cost, discounts, margin versus variable cost,
future reward reservation, zero/negative contribution, optional purchases,
allocation, unsafe numbers, precision and regional currency formatting.

The browser test serves a local static fixture under a CSP with no connections,
drives all examples, checks error recovery and keyboard focus, validates CLP,
checks no page overflow at 390px, verifies stale-result invalidation, literal
rendering of entered names, text download and print styling, reset, and absence
of storage and write requests. The test writes inspection screenshots to the
ignored `.impeccable/review/calculator/` directory. It is not a production-host
routing check and does not establish native device behavior.

The page includes explanatory text, focusable error summaries linked to fields,
visible focus, semantic controls and headings, and a scrollable, keyboard
accessible reward table. Print/PDF uses the browser's print feature; text export
contains the actual inputs, omitted costs, outputs and formulas. All state is
discarded on reload.

The Impeccable detector reported only Inter and Fraunces as overused fonts. Both
are explicitly required by the owner and already belong to the site, so they
were preserved. The established design files were left unchanged.

The simple-page browser regression also checks two visible inputs at entry,
optional expenses and return, stale print prevention, four fictional examples,
CLP precision, no storage/writes, and zero axe violations at 1440/390/320px.

Independent review reproduced and resolved service-cost allocation guidance, an
exact 492-purchase rounding boundary, and collapsed-disclosure printing. Local
verification passed 35 model/search/editorial checks, both calculator browser
flows and the self-service routing/status browser suite, strict typecheck, lint
and the security-pattern gate. The 300-scenario model invariant verifies that
the stated threshold covers its budget and one fewer purchase does not.
