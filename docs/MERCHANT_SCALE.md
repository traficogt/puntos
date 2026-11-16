# Merchant scale fixture and measured import change

Run with Node 24, installed locked root dependencies, Docker and the preloaded
pinned PostgreSQL image:

```sh
npm run test:integration:domains -- merchant-scale
```

The release-readiness `--run all` command includes this suite. It uses managed
migrations in a disposable database, with no `.env`, real contacts or providers.
The dedicated fixture gets six minutes for setup and execution; the general
domain timeout remains two minutes. Its container is limited to one CPU, 1 GiB
RAM and 128 processes, on an ephemeral loopback-only PostgreSQL port.

## Data and checks

- Main business: 10,000 fictional customers, ten purchases each, Q40 per purchase,
  distributed across 28 days. Second business: 2,000 customers and 20,000 purchases.
- Real overview and audience queries must return exactly 100,000 purchases,
  Q4,000,000 recorded sales and 10,000 matching customers, without the other tenant.
- Customer directory: first/last/empty pages, literal wildcard search, foreign and
  deleted profiles, and compare-and-set name edits. Name conflicts must not overwrite.
- A 5,000-row import is previewed and processed through all 50 real chunks. It must
  create 5,000 distinct accounts and opening ledger rows with exactly two points
  each. Replaying completion cannot change balances or duplicate rows; the original
  customers and the other business stay unchanged.
- The fixture retains complete triggers. Most setup time is seeding history;
  setup is excluded from operation timings. EXPLAIN ANALYZE/BUFFERS profiles are
  recorded for overview, search and audience queries without private SQL parameters.

## Observed measurements (November 16, 2026)

Same VM, Node 24.22.3, pinned PostgreSQL 16.15, constrained container. Read timings
are the maximum of five samples (the nearest-rank p95 at this small sample size).
The import write timing is one complete 5,000-row run per implementation.

| Operation | Before | After | Regression budget |
| --- | ---: | ---: | ---: |
| 30-day overview | 287 ms | 296 ms | 3,000 ms |
| First customer page | 18 ms | 29 ms | 3,000 ms |
| Last customer page | 21 ms | 24 ms | 3,000 ms |
| Customer search | 29 ms | 32 ms | 3,000 ms |
| Audience preview | 131 ms | 200 ms | 3,000 ms |
| 5,000-row import preview | 37 ms | 70 ms | 3,000 ms |
| 5,000-row import processing | 10,895 ms | 10,196 ms | 60,000 ms |

Read paths were already comfortably within the deliberately generous budgets;
their implementation was left intact. The measured expensive path was import
processing: **20,400 service SQL calls became 15,400**, 5,000 fewer (24.5%). This
counter excludes BEGIN/COMMIT and trigger-internal SQL, not the database work itself.
The elapsed-time difference is only an observation from these runs, not a reliable
6% speedup estimate. Shared-host load and caching affect timings; future gate runs
produce their own JSONL evidence rather than reusing this table.

## Why the import change is conservative

The transaction, business/request lock, sorted per-phone locks, customer insert,
conflict policy and audit remain unchanged. Only the new balance and its opening
ledger entry are combined into a dependency-ordered statement. Customer creation
stays in an earlier statement so row-level security can see it. A proposed wider
combined statement was rejected after a restricted-role test demonstrated an RLS
failure. Restricted-role tests cover mixed existing/new/zero-point rows, reject
rollback, skipped-account preservation, source/impersonation metadata and replay.

These are service-level measurements, not HTTP-load tests, production SLAs,
concurrent-tenant capacity claims or native-device acceptance. The scale fixture
seeds and invokes services using its disposable admin connection; separate
restricted-role domain suites verify row-level-security behavior. No conclusions
about real merchant outcomes or campaign effectiveness follow from synthetic data.
