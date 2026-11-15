# Release Readiness Implementation Plan

> **For agentic workers:** Execute inline in the assigned worktree, following the approved parent task; no additional delegation or live execution. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Produce one exact-revision website/backend readiness report from executed existing checks, without mistaking static checks or external acceptance for functional proof.

**Architecture:** A small allowlisted Node CLI captures bounded subprocesses, source identity, timestamps, tool versions, exit status, and reporter artifacts. A pure helper validates directly captured receipts and parses reporter evidence; JSON and Markdown separate static, functional, database, browser, and external gates. Dirty, changed, stale, incomplete, skipped, cancelled, or mismatched evidence cannot pass.

**Tech Stack:** Existing Node test runner/TAP, domain integration JSONL, Playwright JSON, Node built-ins, Git, existing npm scripts.

---

### Task 1: Evidence validation and source identity

**Files:** Create `src/scripts/release-readiness-lib.mjs` and `tests/unit/release-readiness.test.js`.

- [x] Write assertions that missing exports fail and representative TAP/Playwright/domain JSONL parse into counts; malformed, duplicate, skipped, failed and incomplete results cannot pass.
- [x] Parent's isolated runner executes `node --test --test-reporter=tap tests/unit/release-readiness.test.js`; confirm missing implementation failure.
- [x] Implement parsers and digest/source helpers with built-in modules. Source identity includes HEAD, tree, tracked/untracked content digest and dirty flag; direct-capture evaluation recomputes artifact digest and reporter results, never uses submitted status.
- [x] Test wrong revision/content, dirty tree, changed source, stale/future evidence, wrong command, failure/cancellation and injected secrets.

### Task 2: Bounded command capture and CLI

**Files:** Create `src/scripts/release-readiness.mjs`; extend the same regression suite.

- [x] Add subprocess fixtures for passing/failing/skipped Node tests, timeout, nonexistent executable, source mutation, private artifact writes, and safe report rendering.
- [x] Execute failing regression tests in the parent's local runner.
- [x] Implement fixed check catalog and bounded process capture with no shell or command execution from evidence; capture source identity before/after execution. Reports only contain fixed labels, validated metadata and numeric counts; raw evidence stays private.
- [x] Add CLI `--revision`, `--output`, and `--run` arguments; require explicit selected execution and exact full SHA. Default report generation marks missing checks `not_tested`. Output JSON plus Markdown; external physical/provider/security gates stay `not_tested`.
- [x] Run regressions in the isolated runner; inspect JSON and Markdown from a fixture report.

### Task 3: Integration and documentation

**Files:** Modify `package.json` and `src/scripts/release-checklist.mjs`; create `docs/RELEASE_READINESS.md`.

- [x] Add `ops:release:readiness` package script and explicitly label existing checklist output static.
- [x] Document the single report command, all allowlisted checks, safe local prerequisite environment, direct-execution trust boundary, evidence age policy, exit codes, report/artifact privacy, and external gates. Keep existing workflows and native releases untouched.
- [x] Parent's runner executes regression suite, focused ESLint and repository typecheck as applicable.
- [x] Review diff for scope, commit tested changes, and hand parent the commit plus usage and limitations. Parent owns final source commit, report execution and integration.

Validation: 22 focused regressions passed in the parent-provided read-only/no-egress runner, including real Node and Playwright reporter subprocesses, temporary Git source fixtures, production build environment, handled cancellation and loopback API revision drift. Full catalog execution on the final integrated revision remains the parent release task.
