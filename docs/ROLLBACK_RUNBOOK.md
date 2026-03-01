# Rollback Runbook

Use this when a deploy is unhealthy, a smoke gate fails, or a schema/app change must be reversed quickly.

## Immediate rule

Do not keep pushing fixes into a broken rollout. Stop, preserve evidence, and return the service to the last known good state first.

## App rollback

1. Identify the last known good image or commit.
2. Redeploy that exact version.
3. Run:

```bash
npm run ops:smoke -- --base-url https://your-domain.example --require-super-login
```

4. Confirm `/api/health`, `/api/ready`, and one authenticated path are healthy before reopening traffic.

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

That drill now writes a machine-readable report under `artifacts/restore-drills/`.

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
npm run ops:smoke -- --base-url https://your-domain.example --require-super-login
```

## After rollback

1. Record what was rolled back: app version, backup file, migration state.
2. Attach the generated restore/restore-drill report to the incident record.
3. Keep the bad build or migration blocked until a root-cause fix exists.
4. Add or update a smoke test, CI gate, or runbook step that would have caught the issue earlier.
