# Disposable application workload and recovery check

Run this opt-in functional/performance check on Linux with local Docker and the
repository's Node 24 dependencies installed (`npm ci --ignore-scripts`). It does
not accept an existing API URL or database. The older read-only
`npm run ops:load:critical` command is unchanged.

```sh
node src/scripts/run-workload-isolated.mjs --run
node --test tests/unit/workload-isolated.test.js
```

If the shell injects `NODE_OPTIONS`, remove it for the runner rather than carrying
preload hooks into the fixture:

```sh
env -u NODE_OPTIONS node src/scripts/run-workload-isolated.mjs --run
```

The launcher rejects production mode, inherited database/target settings,
`DOCKER_*` overrides, and Node preload/module-path settings. It never reads the
checkout's `.env`. Unrelated inherited secrets are omitted from subprocesses.
It connects to the local Unix Docker socket, creates unique containers and an
internal network, and publishes no service ports. Only `src`, `tests`, `public`,
`node_modules`, and `package.json` are mounted read-only into the runner. No
production data, credentials, secrets directory, native app files or cloud build
workflow is used. Docker may download the pinned Node/PostgreSQL images if they
are not cached; application containers have no external network route.

The runner applies the existing managed migrations to a new `workload_test`
database and uses the existing application-role provisioning script. Its single
fictional business, owner and customer follow the existing service-completion
fixture shape: a VISIT program awards ten points per purchase. Browser sessions
are issued through the existing session service; fixture setup does not enroll
a real phone number or send messages. The provider is `dev`, integrations are
unconfigured, and background workers remain off. The application runs in
`development` because `test` mode intentionally replaces persisted browser
sessions with process memory. This exercises the normal database-backed session
and application paths across restart.

The default scenario performs:

1. Sixty bounded, concurrent reads across customer profile/history, merchant
   profile, and owner program configuration, validating returned fixture data.
2. Six purchases through `/api/staff/award`, each retried with its original
   `txId`, while reads are running. QR tokens come from the customer API.
3. One additional purchase through a loopback fault proxy. The proxy consumes
   the completed upstream response and disconnects the caller, then the runner
   kills and restarts its own API process. The original cookie and `txId` are
   reused; the retry must return the stored purchase without adding effects.
4. Refunds for all seven purchases, each retried with its original `requestId`.
   Exact transaction IDs, original/reversal links, statuses, point effects and
   customer balances are checked after every retry and after restart. Final
   customer profile and history must agree with the database.

The workload contains only supported application-flow correctness checks in its
own fictional fixture. It is not an auth, tenant-isolation, webhook or ledger
security audit. The fault is specifically a lost response **after commit**, then
an API process restart. It does not establish behavior for a database crash,
mid-transaction power loss, provider outage, native devices or production scale.

## Limits and reporting

| Option | Default | Allowed range |
| --- | ---: | ---: |
| `--reads` | 60 | 4–240 |
| `--purchases` | 6 | 1–20, plus one recovery purchase |
| `--concurrency` | 4 | 1–8 read workers, plus one sequential purchase worker |
| `--max-p95-ms` | 1000 | 1–10000 |

Requests have six-second client deadlines. The fault proxy has a five-second
upstream deadline. The entire launcher is bounded to seven minutes before
cleanup, with additional bounded Docker cleanup time. Its application container
has two CPUs/1 GiB and PostgreSQL has one CPU/512 MiB. On success, failure or a
handled interrupt, it removes only this run's named containers, volumes, network
and temporary directory. Forced termination of the launcher itself cannot run
cleanup; resource names begin with `pf-workload-` and include a random run ID.

The `WORKLOAD_REPORT` line contains machine-readable JSON:

- `correctness`: pass/fail and actual database snapshots after each operation.
- `recovery`: response loss, restart, replay outcome and time until API readiness.
- `performance`: per-path request/error/interruption counts and full-response
  average, nearest-rank p95 and maximum milliseconds. The deliberately lost
  response is reported separately and excluded from the normal latency gate.
- `counts`: acknowledged purchases/refunds, actual transactions at the last
  completed state check, measured reads/requests, unexpected errors and injected
  interruptions. Counts remain available after scenario failure.

The process succeeds only when correctness, recovery and performance all pass;
an absent/incomplete report also fails. Startup, migrations, fixture setup and
readiness polls are excluded from request latency. Latencies include response
body consumption and validation; these small local samples are a regression
signal, not production capacity or service-level evidence. Thresholds can be
set explicitly for the machine running the check.

For a deliberate negative control, this command should preserve passing
correctness/recovery while returning a nonzero status and `performance.ok=false`:

```sh
node src/scripts/run-workload-isolated.mjs --run --reads 8 --purchases 1 --concurrency 2 --max-p95-ms 1
```

The ordinary unit suite covers opt-in/count guards, direct-host refusal,
duplicate effects that cancel to a zero sum, wrong refund identities, wrong
balances, measurement separation, and an actual local HTTP response drop.
