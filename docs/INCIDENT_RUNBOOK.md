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

### Billing webhooks failing or a payment that did not activate
Symptoms: an owner paid in Recurrente but the app still shows the trial lock, Recurrente's
webhook dashboard shows non-2xx deliveries, or `puntos_billing_events_total{type="failed"}`
or `{type="invalid_signature"}` grows.

1. Check the deliveries: `GET /api/super/billing/events?business_id=<id>` (super console)
   lists each webhook with `status` (`processed`, `ignored`, `failed`) and `error`.
   - `invalid_signature` / 401 in Recurrente's dashboard: the signing secret in
     `recurrente_webhook_secret` does not match the endpoint (each endpoint and each Sandbox
     has its own `whsec_…`); fix the secret file and restart the api. Recurrente redelivers
     on its own schedule; use its dashboard's "resend" for older events.
   - `live_mode_mismatch`: the key and the events belong to different environments
     (Sandbox events reaching the live endpoint or the reverse).
   - `failed` with a provider error: the follow-up read `GET /subscriptions/{id}` failed;
     the next redelivery reprocesses the row automatically.
   - `ignored` with `unmatched_*`: the payload could not be tied to a checkout or business
     (metadata lost); activate by hand (step 3) and keep the event id for support.
2. Check the local state: `GET /api/super/billing/subscriptions?status=active` and the
   business row (`billing_status`, `plan`, `trial_status`). The daily `billing.reconcile`
   (worker) converges every provider subscription on the next run; to converge now run
   `node -e "import('./src/app/services/billing/subscription-service.js').then(m=>m.subscriptionService().reconcileOnce())"`
   inside the worker container.
3. Manual activation when the money is in Recurrente but the webhook cannot be recovered:
   `POST /api/super/businesses/<id>/billing/manual-activate` with `{ "plan": "NEGOCIO",
   "currency": "USD", "note": "<Recurrente intent id>" }` (super console, "Pruebas" card).
   It records a `manual` subscription, converts the trial and lifts the lock; audit_logs and
   security_events keep who did it. When the Recurrente subscription later reports through
   a webhook, the paid subscription replaces the manual row.
4. Wrong charge or dispute: refunds are manual in Recurrente (`POST /refunds`); the app only
   records `payment.refunded` / `payment.disputed` in the tenant ledger. Cancel a
   subscription immediately with `POST /api/super/businesses/<id>/billing/cancel`
   (`{ "at_period_end": false }`), which locks the business with the retention clock.
5. If the provider is down for long: nothing in the app blocks on it except the hosted
   checkout (owners see 502 `BILLING_PROVIDER_ERROR`) and branch additions log
   `subscription.sync_failed` instead of blocking. Reconcile once it is back.

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
