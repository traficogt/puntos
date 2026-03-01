# Arquitectura actual

La aplicación sigue un enfoque de monolito modular:

- rutas HTTP por dominio en `src/app/routes`
- servicios de negocio en `src/app/services`
- repositorios de datos en `src/app/repositories`
- middleware transversal en `src/middleware`
- utilidades compartidas en `src/utils`

## Piezas relevantes
- `src/app/database.js`: pool, transacciones, bootstrap de schema y migraciones
- `src/app/worker.js`: procesamiento de jobs y entregas asíncronas
- `public/admin-dashboard`: dashboard administrativo modularizado por áreas

## Deuda técnica vigente
- `database.js` concentra demasiadas responsabilidades
- algunos servicios de dominio siguen siendo grandes
- hay dashboards frontend que todavía mezclan fetch, estado y render

## Dirección recomendada
1. separar `database.js` en pool, transacciones y migraciones
2. dividir servicios grandes por responsabilidad
3. seguir moviendo el dashboard admin a controladores más pequeños por módulo
