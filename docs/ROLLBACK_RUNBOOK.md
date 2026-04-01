# Rollback Runbook

Use this when a deploy is unhealthy, a smoke gate fails, or a schema/app change must be reversed quickly.

## Immediate rule

Do not keep pushing fixes into a broken rollout. Stop, preserve evidence, and return the service to the last known good state first.

## What "explicit rollback path" means here

For this repo, a safe rollback requires four concrete things:

1. Preserve the currently running app image before rebuilding.
2. Capture a release snapshot before opening traffic.
3. Roll back the app image first, not the database, unless the incident is a data/schema problem.
4. Verify the rollback landed on the expected version/build before reopening traffic.

## Before each deploy

On the target VM, preserve the current image and capture the live release state:

```bash
npm run ops:release:tag-local -- release-20260308T120000Z
npm run ops:release:snapshot -- \
  --base-url https://your-domain.example \
  --image-ref local:puntos-api:release-20260308T120000Z \
  --build-sha <git-sha>
```

Artifacts produced:
- release snapshot: `artifacts/releases/release_snapshot_<timestamp>.json`

That snapshot records:
- live `/api/health`, `/api/ready`, `/api/info`
- expected release version/build information
- applied and pending migrations at deploy time

## App rollback

Use this when the problem is app behavior, stale assets, bad UI code, broken auth, or an otherwise healthy schema/data state.

1. Identify the last known good local image tag, for example `release-20260308T120000Z`.
2. Retag that preserved image back onto the runtime image and restart the API:

```bash
npm run ops:rollback:local-image -- release-20260308T120000Z
```

3. Verify the rollback target explicitly:

```bash
npm run ops:rollback:verify -- \
  --base-url https://your-domain.example \
  --expect-version 1.3.7 \
  --expect-build-sha <git-sha> \
  --require-super-login
```

Artifacts produced:
- rollback verification report: `artifacts/rollback-verifications/rollback_verify_<timestamp>.json`

That verification checks:
- `/api/health`
- `/api/ready`
- `/api/info`
- optional super-admin login/session
- that there are no pending managed migrations
- that the observed version/build matches the intended rollback target

4. Confirm one authenticated path and one merchant-critical path are healthy before reopening traffic.

Recommended follow-up check:

```bash
npm run ops:smoke -- --base-url https://your-domain.example --require-super-login
```

## Database decision

Only restore the database if the incident involves bad data or an irreversible schema/data mistake. App-only failures should be fixed with an app rollback, not a database rewind.

Before touching data:
- freeze writes if possible
- capture logs, migration version, and failing request samples
- create a fresh backup

```bash
npm run ops:backup
npm run ops:backup:verify -- --file backups/<latest>.sql.gz
```

Expected artifacts:
- backup file: `backups/puntos_<timestamp>.sql.gz`
- checksum sidecar: `backups/puntos_<timestamp>.sql.gz.sha256`
- manifest: `backups/puntos_<timestamp>.sql.gz.json`

## Database restore

Restore the selected backup into a clean drill first:

```bash
npm run ops:restore:drill -- backups/<file>.sql.gz
```

That drill writes a machine-readable report under `artifacts/restore-drills/`.

If that drill passes, restore the target environment:

```bash
npm run ops:restore -- backups/<file>.sql.gz --yes
```

The production restore writes a report under `artifacts/restores/`, including:
- selected backup file and checksum
- pre-restore safety backup path
- stage reached
- duration and exit code

Then verify:

```bash
npm run ops:rls-check
npm run ops:rollback:verify -- \
  --base-url https://your-domain.example \
  --require-super-login
```

## Backward-compatibility rule

An app rollback is only safe if the previous app version can run against the currently migrated schema.

Before deploying schema changes:
- prefer additive migrations over destructive ones
- avoid dropping columns/tables/indexes that the previous app version still expects
- do not assume database rollback will be available as your first recovery tool

If a migration is not backward-compatible, treat the release as a coordinated app+schema cutover and write that risk into the incident/release notes before deploy.

## After rollback

1. Record what was rolled back: local image tag, observed version/build, backup file if used, migration state.
2. Attach the generated snapshot and rollback verification reports to the incident record.
3. Keep the bad build or migration blocked until a root-cause fix exists.
4. Add or update a smoke test, CI gate, or runbook step that would have caught the issue earlier.
