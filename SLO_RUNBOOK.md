# Reliability Runbook

## Suggested SLOs
- API success rate: 99.5% over 28 days
- Webhook delivery failures: under 0.1% over rolling 24h
- P99 API latency: under 800ms over 7 days

## Alert inputs
Prometheus should scrape both:
- `/api/metrics` for API request/latency signals
- the worker `/metrics` endpoint on `WORKER_PORT` for queue, job, billing, churn, and shared DB/webhook signals

Those scrapes should alert on:
- elevated 5xx ratio
- webhook delivery failures
- sustained DB connection pressure
- excessive job queue depth

Baseline alert rules and dashboard assets live in:
- [prometheus-alerts.yml](/opt/puntos/deploy/monitoring/prometheus-alerts.yml)
- [grafana-puntos-overview.json](/opt/puntos/deploy/monitoring/grafana-puntos-overview.json)

## On-call actions
1. For elevated 5xx:
   - inspect recent deploys and logs
   - hit `/api/health` and `/api/ready`
   - run `npm run ops:smoke -- --base-url https://your-domain.example`
   - verify DB credentials and connectivity
2. For webhook failure spikes:
   - inspect webhook dashboards and worker logs
   - verify downstream availability and secrets
3. For traffic spikes:
   - verify rate-limit backend health
   - scale workers if queue depth is rising
   - run `npm run ops:load:critical -- --base-url https://your-domain.example --require-super` in staging after mitigation
4. For graceful restart:
   - send SIGTERM and confirm DB pools close cleanly

## Recovery
- Use `npm run ops:backup` and `npm run ops:backup:verify -- --file backups/<file>.sql.gz`
- Use `npm run ops:restore:drill -- backups/<file>.sql.gz` for routine restore validation
- Attach the generated `artifacts/restore-drills/*.json` or `artifacts/restores/*.json` report to the incident or reliability review
- Use `npm run ops:alerts:drill` to verify API + worker metrics coverage and alert thresholds in an isolated stack
- Use `npm run ops:failure:drill` for restart/recovery validation in an isolated stack
- Re-run `npm run ops:rls-check` after major DB maintenance
