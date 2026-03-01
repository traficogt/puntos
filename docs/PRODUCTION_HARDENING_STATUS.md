# Estado de hardening para producción

Fecha de verificación: 2026-02-27

## Estado actual (este repo/stack)

- [x] Lint en cero warnings/errores (`npm run lint`)
- [x] Typecheck enfocado activo y pasando (`npm run typecheck:focused`)
- [x] Escaneo estático de seguridad pasando (`npm run ops:security-scan`)
- [x] Tests unit/integration pasando (`npm test`)
- [x] Guard de inmutabilidad de migraciones (`npm run ops:migrate:lock-check`)
- [ ] Dependencias auditadas sin vulnerabilidades (ejecutar `npm audit --omit=dev` en un entorno con acceso a registry/CI)
- [x] API container saludable (`docker compose ps`)
- [x] Validación de configuración en runtime (`src/config/index.js` carga sin error)
- [x] `.env` sin secretos inline; secretos cargados desde archivos
- [x] Headers de seguridad fuertes en respuestas API (CSP, HSTS, COOP, XFO, etc.)

## Controles de seguridad ya implementados

- Validación de inputs con Zod en rutas críticas.
- CSRF con token + validación de timing-safe compare.
- RBAC (super/admin/staff/customer) y chequeos por feature plan.
- SQL parametrizado (sin interpolación directa en queries).
- Rate limiting global y estricto para endpoints sensibles.
- Protección SSRF para webhooks (bloquea redes privadas/metadata).
- Cifrado de secretos de webhooks y soporte de rotación.
- Auditoría y eventos de seguridad (`audit_logs`, `security_events`).

## Riesgos residuales (operativos, fuera del código)

- [ ] Endurecimiento del edge proxy (Caddy): limitar exposición de rutas sensibles y reglas anti-bot.
- [ ] Backups reales automáticos verificados (restauración periódica con RTO/RPO definidos).
- [ ] Runbook de respuesta a incidentes ejecutado en simulacro.
- [ ] MFA o equivalente para acceso de super admin (recomendado).
- [ ] Monitoreo/alertas externas (CPU, RAM, disco, errores 5xx, latencia p95).

## Gate mínimo para “go-live”

1. DNS + Caddy + upstream validados extremo a extremo (sin 502).
2. Backups programados + prueba de restore en entorno limpio.
3. Secretos finales y rotados (JWT, DB, webhooks, métricas).
4. Revisión final de CORS/APP_ORIGIN para dominio definitivo.
5. Smoke test completo (login, escaneo QR, canje, super admin, jobs, analytics).

## Ejecución práctica (VM app + VM gateway)

### 1) Gateway -> API (evitar 502)

En **gateway VM**:

```bash
curl -I --max-time 5 http://10.10.1.5:3001/api/health
curl -I --resolve 1testdomene.xyz:443:127.0.0.1 https://1testdomene.xyz
journalctl -u caddy -n 80 --no-pager
```

Debe responder `200` en health y no mostrar `connect: connection refused` en logs de Caddy.

### 2) API stack (VM app)

En **app VM**:

```bash
docker compose ps
ss -ltnp | grep 3001
curl -I http://127.0.0.1:3001/api/health
```

### 3) Secretos y config final

En **app VM**:

```bash
grep -n "CHANGE_ME\\|REPLACE_ME\\|default" .env
node -e "import './src/config/index.js'; console.log('config_ok')"
docker compose exec -T api node -e "import('./src/config/index.js').then(()=>console.log('container_config_ok'))"
```

### 4) Calidad y seguridad de código

En **app VM**:

```bash
npm run lint
npm run typecheck:focused
npm run ops:security-scan
npm test
npm audit --omit=dev
```

### 5) Backups (sanidad mínima)

En **app VM**:

```bash
bash -n src/scripts/backup-db.sh
bash -n src/scripts/restore-db.sh
bash -n src/scripts/backup-retention.sh
bash -n src/scripts/backup-health.sh
```

> Recomendado: ejecutar restore real en entorno limpio antes de producción.
