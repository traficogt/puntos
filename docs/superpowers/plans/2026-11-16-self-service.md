# Self-service and support implementation plan

Approved by the owner on November 16, 2026: finish the calculator, MkDocs help,
independent status site and real support workflow; only then push and deploy the
combined release. Website/server only. Preserve installed native applications.

## Boundaries and ownership

- Calculator agent: public calculator, pure economic model and tests.
- Help agent: curated MkDocs source, reproducible static build, task documentation
  and browser checks. Never expose the repository's internal docs directory.
- Support agent: durable cases, tracking capabilities, screenshots, platform
  support console, additive migration, access controls and integration tests.
- Integrator: public routing/navigation, status monitoring and external hosting,
  dependencies, source-preserving integration, combined verification and release.

## Calculator acceptance

1. Multiple product/service/discount rewards with quantity and fulfillment cost.
2. Separate customer retail value, full commitment, redemption scenarios and
   merchant-entered additional purchases. Unknown is not zero.
3. Contribution and break-even calculations include ordinary variable costs,
   extra program expenses and rewards earned on additional purchases.
4. General editable examples spanning business types; no guaranteed return.
5. Accessible desktop/mobile form, validation, reset and printable results.
6. Economic edge cases and browser interactions verified.

## Help acceptance

1. MkDocs, pinned build dependencies and strict reproducible compilation.
2. Separate employee, owner and customer paths; small complete task pages.
3. Exact current controls, permissions, expected results, troubleshooting,
   offline limitations, demo screenshots and review dates.
4. Search supports Spanish and short queries such as QR. Links checked.
5. Public source tree is explicitly curated; editorial articles stay in /guias/.
6. Contextual entry points from public and application screens.

## Status acceptance

1. Public /estado entry and independently hosted status site remain usable when
   the PF VM is unavailable. Use Upptime's established external monitoring.
2. Only measured service checks get operational indicators. API/database
   reachability is not proof of reward redemption or device delivery.
3. Last observation, stale/unknown state, incident history and safe next actions.
4. Preserve all recorded incidents; no invented historic uptime or delivery.
5. Source and pinned workflow for the independent status repository are retained
   under deploy/status; create/push/deploy externally only at final release.
6. Automated tests cover missing, old, malformed and failed observations, and
   offline browser display. No private metrics or tenant data leave PF.

## Support acceptance

1. Case accepted durably before receipt, idempotent retries, clear reference.
2. Secure requester tracking/replies; platform admin processing and history.
3. Optional screenshot really attaches. Sharp decodes/re-encodes bounded input;
   private storage, authorized download and expiry/purge are implemented.
4. Narrow, reviewable opt-in diagnostics; no credentials, QR values or URL
   query tokens; anti-abuse, tenant isolation and CSRF remain enforced.
5. No fictitious response SLA or email-delivery claim. Email remains fallback.
6. Real database tests and browser workflows demonstrate the complete lifecycle.

## Editorial addition (owner steering)

1. Link relevant existing articles to /calculadora.
2. Vary PF's own worked examples across retail and services; retain original
   studies' actual settings and all author-date citations and APA references.
3. Every article has at least one in-body illustration in addition to its hero,
   using approved ink-and-gouache assets with accurate alternative text.
4. Preserve publication dates, unindexed preview routes and disclosure wording.

## Integration and release

1. Review each local commit and integrate into this worktree, not the user's
   dirty root checkout. Preserve the existing AGENTS/package edits.
2. Update explicit routes, runtime grants, migration lock and generated OpenAPI.
3. Run unit/type/lint checks, actual database migration/access tests, reproducible
   help build and browser checks at desktop/mobile widths. Review rendered UI.
4. Run consolidated release readiness for the exact final source revision.
5. Once all four additions and editorial changes pass, push and deploy together;
   configure the independent monitor and verify its first external observations.
6. Verify live routes, headers, screenshots and support configuration without
   sending unsolicited messages or adding fake production support cases.
7. Report actual URLs, tests, release revision and any demonstrated limitation.
