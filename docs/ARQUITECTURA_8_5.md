# Arquitectura actual

Este documento fue reemplazado por [ARCHITECTURE.md](ARCHITECTURE.md), que describe el
código tal como existe (verificado contra el árbol el 2026-11-23).

Notas para quien llegue desde una referencia antigua:

- `src/app/database.js` ya está dividido: `src/app/db/pools.js`, `db/context.js`,
  `db/session.js`, `db/transactions.js` y `db/migrations.js`; `database.js` solo reexporta.
- `src/app/repositories/` **no** es una capa general de acceso a datos. El SQL vive en los
  servicios; un repositorio se justifica solo para acceso a filas compartido por varios
  servicios o para modelos de lectura de analítica (ver "Layering reality" en ARCHITECTURE.md).
- El panel administrativo tiene tres pilas de interfaz (PWA vanilla, React + Mantine en
  `web/merchant`, app Expo); el estado de la consolidación está en
  `docs/product/2026-11-23-owner-ui-consolidation.md`.
