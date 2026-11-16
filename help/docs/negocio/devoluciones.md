---
title: Revisar devoluciones de caja y sus puntos
description: Comprueba si una devolución tiene una reversión de puntos confirmada
  o necesita revisión.
reviewed: '2026-11-16'
kind: task
sources:
- web/merchant/src/PosRefunds.jsx
- web/merchant/src/RedemptionReturns.jsx
owner_route: conectar-caja
---

# Revisar devoluciones de caja y sus puntos

Comprueba si una devolución tiene una reversión de puntos confirmada o necesita revisión. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#conectar-caja)

## Antes de empezar

Ten el recibo original y la devolución. Los importes se devuelven en tu POS; este panel revisa su relación con puntos en PF.

## Paso a paso

1. Abre **Conectar caja** y busca **Devoluciones y conciliación**.
2. Elige **Devoluciones que quieres revisar** y pulsa **Actualizar devoluciones**.
3. Lee el motivo de cada **Requiere revisión**. Compara recibo original, artículos e importe.
4. Si faltaba importar la venta original y ya lo corregiste, utiliza **Comprobar de nuevo** cuando esa acción aparezca.
5. Para una devolución parcial, usa **Abrir historial y auditoría en administración**, al final del panel, y acuerda la corrección autorizada con el responsable. El botón **Revisar recibo e historial** de esa devolución permanece desactivado.

## Qué debe pasar

Una reversión automática exige comprobar una devolución completa. Las devoluciones parciales requieren revisión; PF no calcula una reversión proporcional automática.

## Si algo no funciona

**Totales coinciden:** no basta para probar devolución completa; deben corresponder los artículos y la evidencia del proveedor. **Solo devolvió una parte:** no anules toda la compra para resolverlo. **Faltan recibos:** los conteos solo incluyen lo recibido en PF, no lo que el POS aún no envió.

## Continúa con otra tarea

- [Explicar un movimiento](/ayuda/negocio/movimientos/)
- [Restituir puntos de un canje](/ayuda/negocio/restituir-puntos/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#conectar-caja). Revisión del 16 de noviembre de 2026.
