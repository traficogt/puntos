# Observability

The app exposes JSON probes under:
- `/api/health`
- `/api/ready`
- `/api/live`
- `/api/info`

API Prometheus metrics are exposed at:
- `/api/metrics`

The worker exposes its own observability server on `WORKER_PORT` (default `3002`) with:
- `/health`
- `/ready`
- `/live`
- `/info`
- `/queue/health`
- `/metrics`

The metrics endpoint requires a valid metrics token. Send it as either:
- `Authorization: Bearer <token>`
- `X-Metrics-Token: <token>`

## Included assets

- Prometheus alerts: [prometheus-alerts.yml](/opt/puntos/deploy/monitoring/prometheus-alerts.yml)
- Grafana dashboard: [grafana-puntos-overview.json](/opt/puntos/deploy/monitoring/grafana-puntos-overview.json)

## Recommended scrape config

Example Prometheus scrape job:

```yaml
- job_name: puntos-api
  metrics_path: /api/metrics
  static_configs:
    - targets:
        - puntos.example.com
  scheme: https
  authorization:
    type: Bearer
    credentials: "<metrics-token>"

- job_name: puntos-worker
  metrics_path: /metrics
  static_configs:
    - targets:
        - worker.example.internal:3002
  scheme: https
  authorization:
    type: Bearer
    credentials: "<metrics-token>"
```

## Metrics this repo already emits

API metrics:
- HTTP rate and latency:
  - `puntos_http_requests_total`
  - `puntos_http_request_duration_seconds`
- Shared DB/webhook/process metrics:
  - `puntos_db_connections_active`
  - `puntos_db_connections_idle`
  - `puntos_webhook_deliveries_24h`
  - `puntos_customers_total`
  - `puntos_points_total`
  - `puntos_process_memory_bytes`
  - `puntos_process_uptime_seconds`

Worker metrics:
- DB connections:
  - `puntos_db_connections_active`
  - `puntos_db_connections_idle`
- Webhooks:
  - `puntos_webhook_deliveries_24h`
- Billing/message events:
  - `puntos_billing_events_24h`
- Background jobs:
  - `puntos_jobs_total`
  - `puntos_jobs_oldest_age_seconds`
  - `puntos_job_queue_depth`
  - `puntos_job_queue_driver`
- Lifecycle:
  - `puntos_churn_last_sent_timestamp`
- Process:
  - `puntos_process_memory_bytes`
  - `puntos_process_uptime_seconds`

## Operational notes

- Import the alert rules into the Prometheus or Alertmanager stack you already run.
- Scrape both the API and the worker if you want the full alert set. Queue, job, billing, and churn metrics are worker-only.
- Import the Grafana JSON dashboard and point it at your Prometheus datasource.
- Keep the metrics token out of dashboards and repos. Use Grafana/Prometheus secret management.
- Test alerts in staging with:
  - `npm run ops:smoke`
  - `npm run ops:load:critical`
  - `npm run ops:alerts:drill`
  - `npm run ops:failure:drill`

## Alert checks

You can validate the alert inputs directly against a live metrics endpoint:

```bash
npm run ops:alerts:check -- --scope api --base-url https://your-domain.example --metrics-token <token>
npm run ops:alerts:check -- --scope worker --worker-base-url https://worker.example.internal:3002 --metrics-token <token>
npm run ops:alerts:check -- --scope all --base-url https://your-domain.example --worker-base-url https://worker.example.internal:3002 --metrics-token <token>
```

Modes:
- `--mode presence`
  Verifies that all metrics required by the selected scope exist.
- `--mode evaluate`
  Verifies the current gauge-style alert inputs are below their thresholds.
  API rate/latency alerts stay presence-only here because they depend on Prometheus time-window calculations.
  A zero `puntos_churn_last_sent_timestamp` is treated as "no churn job has sent yet", not as an automatic failure.

If a staging environment is intentionally noisy, allow specific alert names:

```bash
npm run ops:alerts:check -- --scope worker --worker-base-url https://worker.example.internal:3002 --metrics-token <token> --mode evaluate --allow-alerts PuntosJobFailuresPresent,PuntosWebhookFailures24h
```
