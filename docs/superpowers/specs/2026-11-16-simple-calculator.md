# A simpler calculator for business owners

The owner finds the current calculator too complex. Replace its default surface
with a single monthly reward-budget task: cost of one reward and quantity to
cover. Keep the approved PF fonts/colors. No wizard, financial terminology,
percentage inputs, parallel summary tables, or explanatory sidebars in this flow.
Currency defaults to GTQ and remains selectable without conversion. Empty cost
is unknown; an explicitly entered zero is valid. Optional monthly expenses live
in a closed details element. Blank expenses are visibly excluded from results.

After calculating a budget, an optional “Can extra sales cover this?” section
asks how much a normal sale leaves after its variable costs (a money amount),
how many purchases earn a reward, and optionally how many additional sales to
try. Reserve rewardCost / purchasesPerReward for rewards earned by those extra
sales. Show the break-even count and, only when requested, the scenario balance.
Use “costs included” and additional sales, never total member sales or a promise
of profit. These sales are additional to the activity behind the starting reward
budget; do not count their rewards in both places. Preserve full-fulfillment cost.

Offer four clearly fictional examples across retail, salon, carwash and cafe.
They are optional and collapse behind an examples disclosure. Keep the detailed
calculator at /calculadora/detallada (noindex), with a link back to the simple
page. Existing article links continue to /calculadora. No APIs, storage, analytics,
new dependencies, native files or build workflows. Data stays in the page.

Verification: arithmetic boundaries, zero/unknown/negative contribution,
future reward reserve, stale result invalidation, currencies, keyboard errors,
mobile 320/390 and desktop 1440, accessibility, strict CSP, advanced regression,
search routing and existing article contracts. Push/deploy within the owner's
standing authorization after checks. Preserve unrelated root worktree changes.
