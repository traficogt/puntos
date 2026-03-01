# Quick Reference

## Quality Gates

```bash
npm run lint
npm run typecheck
npm test
```

## DB Migrations

```bash
npm run ops:migrate:status
npm run ops:migrate
npm run ops:rls-check
```

## Dev Bootstrap

```bash
./src/scripts/bootstrap-dev.sh
docker compose up -d --build
```

## Run API / Worker

```bash
npm start
npm run worker
```

Run API without in-process workers:
```bash
IN_PROCESS_WORKERS=false npm start
```

## Common Ops

Backups:
```bash
npm run ops:backup
npm run ops:backup:retention
npm run ops:backup:health
```

Perf sanity:
```bash
npm run ops:perf-sanity
```

