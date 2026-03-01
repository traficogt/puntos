# Guia de contribucion UI (PuntosFieles)

Esta guia permite que otra persona (dev/disenador) colabore sin romper flujos criticos.

## 1) Objetivo

- Mantener consistencia visual y de idioma (espanol).
- Evitar regresiones en onboarding, staff scan, customer card y paneles admin/super.
- Entregar cambios pequenos, revisables y testeables.

## 2) Flujo de trabajo recomendado

1. Crear rama por tarea: `feature/ui-<tema>`.
2. Hacer cambios pequenos (1 objetivo por PR).
3. Adjuntar capturas desktop + mobile de las pantallas tocadas.
4. Ejecutar antes de merge:
   - `npm test`
   - `npm run test:e2e`
5. Merge solo cuando ambos pasan.

## 3) Estructura actual frontend

- Vistas: `public/*.html`
- Logica cliente: `public/*.js`
- Estilos globales: `public/styles.css`

Regla: si agregas un nuevo bloque UI, agrega sus estilos en `public/styles.css` con clases especificas y nombres claros.

## 4) Checklist obligatorio por PR UI

- Texto en espanol (sin mensajes en ingles al usuario final).
- Responsive (minimo: 360px, 768px, desktop).
- Accesibilidad basica:
  - labels en inputs
  - contraste legible
  - foco visible en botones/campos
- Estados de carga, vacio y error en componentes nuevos.
- Sin datos sensibles en consola ni en HTML.

## 5) Convenciones visuales

- Reusar componentes existentes:
  - `card`, `badge`, `small`, `row`, `grid`, `metric-*`.
- Mantener tono visual de marca (actual esquema calido + verde).
- Evitar estilos inline complejos; moverlos a CSS.

## 6) QA funcional minimo

Si tocas admin dashboard:

1. Login owner/manager.
2. Revisar tabs visibles por plan.
3. Probar filtros de sucursal.
4. Validar textos y alertas en espanol.

Si tocas staff:

1. Login staff.
2. Escaneo QR / otorgar puntos.
3. Canje de recompensa.

Si tocas customer:

1. Join/login.
2. Apertura de tarjeta `/c`.
3. Flujo PWA (instalacion) en Android Chrome/Brave.

## 7) Que NO hacer

- No hardcodear secretos/tokens en frontend.
- No cambiar endpoints backend sin coordinar contrato API.
- No mezclar refactor grande + feature en un solo PR.

## 8) Plantilla breve de PR UI

- Objetivo:
- Pantallas tocadas:
- Riesgo (bajo/medio/alto):
- Pruebas manuales:
- `npm test`: pass/fail
- `npm run test:e2e`: pass/fail
- Capturas:

