# Plan de migracion frontend (sin big-bang)

Objetivo: migrar de HTML/CSS/JS plano a un frontend moderno (React + Vite recomendado) sin reescribir backend ni detener operacion.

## Resumen ejecutivo

- Dificultad: **media-alta**.
- Estrategia: **incremental por rutas**.
- Backend actual (Express + APIs) se mantiene.
- Riesgo controlado si se migra por fases y con feature flags.

---

## Fase 0 - Preparacion (1 semana)

1. Definir stack:
   - React + Vite + TypeScript
   - Router cliente (React Router)
   - Cliente HTTP comun para `/api/*`
2. Definir design tokens (colores, tipografia, spacing) a partir de `public/styles.css`.
3. Crear libreria de componentes base:
   - Button, Input, Card, Badge, Modal, EmptyState, Toast.
4. Definir estrategia de auth y CSRF en cliente nuevo.

Entregable: app nueva compilando, sin reemplazar rutas productivas.

---

## Fase 1 - Shell y paginas de bajo riesgo (1-2 semanas)

Migrar primero:

- Landing (`/`)
- Login staff (`/staff/login`)
- Join (`/join/:slug`)

Mantener en legacy:

- Staff scan (`/staff`)
- Admin dashboard (`/admin`)
- Super (`/super`)

Tecnica sugerida:

- Servir build nuevo bajo prefijo temporal `/new/*`.
- Comparar UX/funcion con legacy.

---

## Fase 2 - Customer y PWA (1 semana)

Migrar:

- Customer card (`/c`)
- Manifest/service worker integrados en nuevo frontend.

Validar:

- Instalacion PWA en Android Chrome/Brave
- Offline basico de vistas criticas

---

## Fase 3 - Staff y Admin parcial (2-4 semanas)

Prioridad:

1. Staff scan y award/redeem
2. Admin dashboard (analytics, operaciones, recompensas)

Estrategia:

- Migrar modulos por seccion (no toda la pantalla a la vez).
- Reusar mismos endpoints existentes.

---

## Fase 4 - Super admin + retiro legacy (1-2 semanas)

- Migrar `/super`.
- Encender rutas nuevas en produccion.
- Dejar legacy en modo fallback por 1 release.
- Retirar archivos legacy cuando metrica de errores sea estable.

---

## Criterios de salida por fase

Cada fase se considera lista si:

1. `npm test` pasa.
2. `npm run test:e2e` pasa.
3. Capturas visuales desktop/mobile aprobadas.
4. Sin regresiones en auth/CSRF/roles.
5. Textos publicos en espanol.

---

## Riesgos y mitigacion

1. **Regresion de flujos criticos (award/redeem)**
   - Mitigar: pruebas e2e obligatorias + rollout gradual.
2. **Inconsistencia visual entre viejo y nuevo**
   - Mitigar: tokens y componentes base antes de migrar pantallas.
3. **Duplicacion temporal de codigo**
   - Mitigar: calendario claro de retiro legacy.

---

## Recomendacion pragmatica

Si el objetivo inmediato es vender y operar:

- Mantener stack actual durante onboarding comercial inicial.
- Empezar migracion en paralelo solo para rutas de experiencia (landing/join/customer).
- Migrar admin/staff cuando haya 2-3 clientes reales usando el sistema y feedback concreto.

