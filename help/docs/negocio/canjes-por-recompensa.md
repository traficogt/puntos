---
title: Revisar los últimos canjes de una recompensa
description: Elige una recompensa, lee sus canjes más recientes con su marca de
  consistencia y abre los movimientos de puntos de cada canje.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/OwnerRewardRedemptions.tsx
- web/merchant/src/owner-analytics-model.ts
- src/app/routes/analytics/redemptions.js
owner_route: canjes-por-recompensa
---

# Revisar los últimos canjes de una recompensa

Elige una recompensa, lee sus canjes más recientes con su marca de consistencia y abre los movimientos de puntos de cada canje. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#canjes-por-recompensa)

## Antes de empezar

Ingresa con la cuenta del dueño; la pantalla requiere un plan con análisis avanzado y recompensas. **Canjes por recompensa** está en el grupo **Avanzado**; pulsa **Ver todas las herramientas** si el menú no lo muestra. Para entregar o restituir un canje usa **Canjes y caja**; esta pantalla sirve para revisar.

## Paso a paso

1. Abre **Canjes por recompensa** y elige una **Recompensa** de la lista. **Actualizar** vuelve a consultar.
2. Lee **Últimos canjes de …**: hasta veinte canjes recientes con fecha, código, cliente y puntos, y la marca de consistencia de cada uno (**Consistente** cuando los movimientos de puntos coinciden con el canje).
3. Pulsa **Ver detalle del canje …** en una fila para abrir **Movimientos vinculados al canje …**, con los movimientos de puntos relacionados.
4. Si un canje no es consistente, anota su código y revísalo en **Canjes y caja** y en **Conciliación del libro de puntos** antes de corregir nada.
5. Usa **Analítica avanzada** para ver el peso de esa recompensa en el total de canjes.

## Qué debe pasar

Esta pantalla es de solo lectura. La marca de consistencia aplica la misma regla que el servidor usa para el libro de puntos: el canje debe tener su descuento de puntos y, si fue restituido, la devolución correspondiente. Un canje consistente no demuestra que la recompensa se entregó físicamente; eso lo documentan los recibos de **Canjes y caja**.

## Si algo no funciona

**No hay canjes recientes para esta recompensa:** la recompensa aún no se ha canjeado o sus canjes son anteriores a los veinte más recientes. **No hay movimientos de puntos vinculados a este canje:** el canje se registró sin descuento, por ejemplo una cortesía; revísalo en **Canjes y caja**. **La lista de recompensas está vacía:** crea una recompensa en **Recompensas y catálogo**. Un canje inconsistente requiere revisión humana; no apliques correcciones solo por esta marca.

## Continúa con otra tarea

- [Revisar canjes y su registro en caja](/ayuda/negocio/canjes/)
- [Restituir puntos de un canje no entregado](/ayuda/negocio/restituir-puntos/)
- [Conciliar el libro de puntos y certificar un periodo](/ayuda/negocio/conciliacion/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#canjes-por-recompensa). Revisión del 25 de noviembre de 2026.
