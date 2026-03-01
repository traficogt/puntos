# Incident Runbook + Backup/Restore Drill

## Severity
- `SEV-1`: full outage, data corruption risk, or active security incident
- `SEV-2`: major business flow degraded with workaround
- `SEV-3`: partial degradation of non-critical functionality

## First 15 minutes
1. Acknowledge the incident and assign severity.
2. Freeze deployments and schema changes.
3. Capture current state:
   - `docker compose ps`
   - `docker compose logs --tail=200 api`
   - `docker compose logs --tail=200 db`
4. Check health:
   - `GET /api/health`
   - `GET /api/ready`
5. Publish the first status update.

## Playbooks

### API unavailable
1. Check `docker compose logs --tail=300 api`
2. Restart API: `docker compose restart api`
3. If needed, rebuild: `docker compose up -d --build api`
4. Validate with `npm run ops:smoke -- --base-url https://your-domain.example`

### Database unavailable
1. Check `docker compose logs --tail=300 db`
2. Verify container state with `docker compose ps`
3. Restart DB only if required
4. Re-check `/api/ready`

### Incorrect award or redeem behavior
1. Capture transaction ids and tenant ids
2. Query audit and suspicious-award views
3. Pause impacted operators if needed

### Security suspicion
1. Rotate exposed secret files:
   - `jwt_secret`
   - `qr_private_key.pem`
   - `qr_public_key.pem`
   - `metrics_token`
   - provider secrets
2. Invalidate sessions if required
3. Preserve logs and evidence before cleanup

## Backups

```bash
npm run ops:backup
npm run ops:backup:verify -- --file backups/<file>.sql.gz
npm run ops:backup:health
npm run ops:backup:retention
```

Restore:

```bash
npm run ops:restore -- backups/<file>.sql.gz --yes
```

Evidence produced automatically:
- backup manifest: `backups/<file>.json`
- backup checksum sidecar: `backups/<file>.sha256`
- restore report: `artifacts/restores/restore_<timestamp>.json`
- restore drill report: `artifacts/restore-drills/restore_drill_<timestamp>.json`

## Monthly restore drill
1. Create a fresh backup
2. Restore it into a clean environment with `npm run ops:restore:drill -- backups/<file>.sql.gz`
3. Verify super login, admin dashboard, staff award/redeem, and customer `/c`
4. Attach the generated drill report and record follow-up actions
