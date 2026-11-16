# Isolated failure simulations

Run with Node 24, local Docker, and the repository's installed dependencies:

```sh
env -u NODE_OPTIONS node src/scripts/run-domain-integration-isolated.mjs failure-simulations
NODE_ENV=test node --test tests/unit/failure-fixture-guard.test.js tests/unit/transaction-connection-loss.test.js
```

The suite uses the domain runner's fresh `failure_simulations_test` database and
managed migrations. The runner creates its own PostgreSQL container, publishes
only an ephemeral loopback port, supplies generated credentials, bounds Docker
resources and child runtimes, and removes its container, volumes and temporary
working directory. It never accepts a caller-supplied database or target URL.
Application imports happen only after checking the isolated-run marker, fixture
database identity, port, credentials, development message provider, and absence
of `.env` in the temporary working directory. The subprocess environment is
allowlisted; secret-file settings and inherited database, Redis and Node preload
settings are rejected by the fixture guard. The suite also disables live `fetch`.

The suite calls existing services against fictional businesses, staff and
customers. It sends no customer messages. Loyverse responses and a failed Redis
enqueue are injected in memory; no provider account, Redis server, real receipt,
phone verification or live payment is involved. PostgreSQL runs locally with
bounded resources; this is not a network sandbox for arbitrary code.

## Required cases and invariants

| Scenario ID | Deterministic interruption | Required recovered state |
| --- | --- | --- |
| `database-session-loss` | A fixture-only trigger terminates its own PostgreSQL session after inserting an award, before balance update or commit. | SQLSTATE `57P01`; zero committed ledger rows and zero balance after failure; retry and replay leave one ten-point award. |
| `worker-interruption-reclaim` | A child running the real job worker commits 100 of 101 import rows, then blocks in its second chunk. The suite observes the lock, kills only that child with `SIGKILL`, waits for its database transaction to disappear, and advances the stored lease past its expiry. | The first 100 rows survive; lease recovery requeues the job; four stale-claim mutations are rejected; the real worker completes on attempt two with 101 customers, 101 opening ledger entries, two committed chunks and 202 points. A further worker pass finds no work. |
| `queue-enqueue-outage` | The existing enqueue dependency throws while pushing the Redis pointer, after the real job repository persists an analytics job. | One warning and one failed push; one durable queued job; the database worker finishes it once; a second pass finds no work and no ledger effects are created. |
| `provider-outage-and-event-replay` | The real Loyverse adapter receives a refund before its sale. An injected HTTP 503 interrupts the next sync; after recovery, one award reply is lost after commit. Replays include the old refund and duplicate sale receipts. | Both failed attempts preserve the prior sync checkpoint. Replays report four duplicate sales, one refund receipt, one purchase and one linked reversal, and zero final points. Successful attempts advance the checkpoint. |
| `overlapping-writers-after-rollback` | Four requests for one award overlap at observed PostgreSQL locks. The first writer is cancelled with SQLSTATE `57014` before commit; the remaining three proceed. | One successful ledger effect, two successful replays of that same transaction, no committed effect from the cancelled writer, and ten points total. |

Each case has a 30-second test deadline. Database statements have a ten-second
timeout; lock observation polls for at most eight seconds. Blocking points use
observed locks rather than timing guesses. Cleanup kills any surviving fixture
child, releases its locks, drops fault triggers, and closes pools. The outer
runner bounds the whole suite and removes its disposable database container.

The TAP output includes a JSON diagnostic with
`kind: "failure-simulation-coverage"`, the five `expected` scenario IDs, each
scenario's `status` and checked `counters`, and an overall `ok` value. Treat this
metadata together with the domain runner's exit status and TAP counts: success
requires all five tests to pass, with no failures, cancellations, skips or TODOs.
A setup failure, zero scenarios or missing scenario is a failed gate. The JSON
contains counts and scenario names, not database URLs or customer identifiers.

## Scope and reproduced defect

The database-session test reproduced an uncaught client socket error during
transaction cleanup even though PostgreSQL correctly rolled back the award.
`withTransaction` now listens for connection errors while it owns the client,
preserves the original operation error, and evicts the client if rollback or
session reset fails. Healthy connections remain reusable. The focused unit
regressions failed before this fix, and the full PostgreSQL simulation exercises
the actual driver behavior.

These cases extend the [lost-response workload](WORKLOAD_RECOVERY.md), and reuse
existing import, job, external-award and POS services. They are ordinary
functional recovery tests. They do not establish physical power-loss durability,
PostgreSQL server-crash recovery, idle-pool outage behavior, Redis failover,
provider acceptance or ordering guarantees, multi-host failover, production
scale, native device behavior, or authorization/security audit coverage.
