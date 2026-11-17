---
title: La compra o los puntos no aparecen
description: Revisa primero si falta actualizar la tarjeta, sincronizar la compra
  o liberar los puntos.
reviewed: '2026-11-17'
kind: task
sources:
- public/customer.html
- public/customer/index.js
- public/staff/award-queue.js
- web/merchant/src/TransactionHistory.jsx
- public/admin-dashboard/fragments/pos-integration.html
---

# La compra o los puntos no aparecen

Revisa primero si falta actualizar la tarjeta, sincronizar la compra o liberar los puntos. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/mi-tarjeta/)

## Antes de empezar

Conserva el comprobante y el negocio donde compraste. Un saldo pendiente y un saldo disponible no son lo mismo.

## Paso a paso

1. En la tarjeta, comprueba el negocio y pulsa **Actualizar tarjeta** con conexión.
2. Revisa **Actividad reciente** y los **puntos pendientes**.
3. Pide al personal comprobar si la compra sigue en **Cola de sincronización** y con qué estado: pendiente, rechazada o en espera de su decisión. Debe revisarla con la cuenta y dispositivo que la registraron.
4. Si ya fue confirmada, el responsable puede abrir **Movimientos**, buscarla y usar **Explicar**.
5. Entrega al responsable fecha, importe y referencia del comprobante para que revise la regla y el resultado.

## Qué debe pasar

Puedes saber si la compra está pendiente, registrada o requiere corrección. Una compra repetida para resolver la duda puede crear un doble registro.

## Si algo no funciona

**La tarjeta muestra una copia sin conexión:** vuelve a consultar online. **Los puntos están pendientes:** se liberan según la regla del negocio, no por pulsar actualizar. **Faltan registros del POS:** revisa la integración antes de añadir puntos manualmente. Con Loyverse, consulta **Recibos para revisar**: allí quedan los recibos que PF ya no reintenta, con su motivo. Una venta registrada en Loyverse sin cliente asociado no suma puntos.

## Continúa con otra tarea

- [Enviar pendientes](/ayuda/caja/sincronizar/)
- [Buscar un movimiento](/ayuda/negocio/movimientos/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/mi-tarjeta/). Revisión del 17 de noviembre de 2026.
