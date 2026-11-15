# Pilot completion implementation plan

> For agentic workers: use independent worktrees and test-first implementation; review against the approved four-item scope before integration.

## Approved scope and design

The owner approved items 1–4 on November 15: private-cache isolation; actual PostgreSQL consent race validation and repair; capability-dependent pilot acceptance; and exact-release readiness evidence. Use the deployed source baseline 3bbc552. Native apps, Codemagic, real messages, live exploit probes and unrelated audit gaps are excluded. The previously rejected authentication/isolation/ledger/webhook audit tasks are not retried.

## Tasks and acceptance

- [x] Cache privacy: reproduce the accepted mixed-case/no-store issue in a real isolated browser. Change public/sw.js to bypass all API namespace case variants before every cache branch, reject no-store/private directives and remove old entries using a new cache generation. Preserve intended identity-scoped IndexedDB behavior. Regression must prove lowercase/mixed-case/versioned API exclusion, private response exclusion, upgrade purge and logout/offline nondisclosure.
- [x] Campaign consent: use actual isolated PostgreSQL and real campaign/message dispatch, dummy provider transport and two independent DB contexts. Observe the read/revocation/send interleaving; repair by serializing consent/deletion checks through provider-start with the existing customer/preference lock convention. Prove completed opt-out prevents a subsequent new send, while an already-started send is not falsely recalled. Keep retry/ambiguous-result behavior and sibling automation compatible.
- [x] Pilot v3: add a frozen capabilities snapshot (Wallet, promotional messaging, POS) at creation. Old v1/v2 contracts remain unchanged. v3 requires relevant capability checks; enrollment/phone ownership remains required. Reject not-applicable for selected required checks and preserve strict tenant/owner validation. Update owner form, accessible Spanish explanations, demo and downloadable report. Keep owner observations explicit; server-computed checklist evidence must have its own provenance and must never certify physical devices.
- [x] Readiness report: reuse existing Node test/CI tooling, produce machine-readable and human-readable passed/failed/not-tested results with exact commit and content identity, command/tool versions, timestamps, exit/test/skip counts and evidence hashes. Missing, stale, mismatched, skipped, cancelled or fabricated evidence cannot mark required execution as passed. Preserve the static release checklist and label its narrower role. Provide one documented command to execute/collect required code checks, and clearly separate manual/provider acceptance from code readiness. No shell evaluation of evidence-supplied commands, no secret/environment dumps, no native workflows.
- [ ] Integrate isolated commits and run source regressions, scoped DB suites, browser acceptance, merchant build/lint/typecheck and root applicable checks. Review with fresh eyes and resolve material findings. Record a readiness report for the exact final revision, push branch, deploy website/backend through guarded existing release workflow with backup/rollback and verify health/source. Do not mark physical-device or provider checks passed.

## File boundaries

Cache: public/sw.js; PWA unit/browser tests. Consent: src/app/services/campaign-message-service.js and narrowly necessary messaging helpers; tests/integration/growth-messaging.test.js or dedicated real-PG regression. Pilots: public/pilot-checklists.js; merchant-pilot service/routes; additive migration; web/merchant pilot components/model/tests. Readiness: src/scripts/release-* and focused helper/tests/docs; package scripts; existing CI if it can preserve manual native triggers. Parent alone handles integration, migration checksum lock, generated merchant bundle, release and deployment.

## Execution and evidence

Use already available local dependencies and Node 24. Tests use disposable dummy databases and providers; no shared data. Security-specific fixtures use OS-enforced no-egress isolation, readonly source/toolchains, empty allowlisted dummy environment and bounded ephemeral scratch/resources. Parent retains exact red/green observations. Required external acceptance remains not tested.

Final integration and deployment results are recorded outside the source tree in `/var/lib/puntos/releases/pilot-completion-20261115/` so that reports and deployed images retain the exact tested commit identity. The release receipt is authoritative for deployment status.
