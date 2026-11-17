---
title: Registrar puntos de una compra
description: Registra los datos de la compra una vez y comprueba la confirmación.
reviewed: '2026-11-17'
kind: task
sources:
- public/staff.html
- public/staff/index.js
- public/staff/award-queue.js
---

# Registrar puntos de una compra

Registra los datos de la compra una vez y comprueba la confirmación. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/equipo/escaner/)

## Antes de empezar

Selecciona al cliente y confirma que corresponde a la compra. Revisa la **Regla activa**: puede usar importe, visitas o artículos. Si la venta ya llega desde un POS integrado, sigue el procedimiento del negocio para evitar un registro manual adicional.

## Paso a paso

1. En **Registrar puntos**, introduce el dato que usa el programa: **Monto**, **Visitas** o **Items**.
2. Revisa la vista previa. Los puntos finales pueden depender de bonos, límites y condiciones del cliente.
3. Pulsa **Registrar** una vez y espera el resultado antes de pasar al siguiente cliente.
4. Comprueba **Último movimiento**, **Saldo actual** y el mensaje de la operación. Si dice que la venta quedó pendiente o que la sesión venció, sigue la guía de sincronización.

## Qué debe pasar

Con confirmación del servidor, el movimiento queda registrado. Los puntos que estén sujetos a liberación pueden seguir pendientes y todavía no sirven para canjear.

## Si algo no funciona

**No hay confirmación o aparece un error de red:** la venta queda pendiente y se reintenta sola con su misma referencia; revisa la cola y **Sincronizar**, pero no crees otra compra para “asegurarte”. **La sesión venció antes de confirmar la venta:** queda guardada y no se envía sola; vuelve a entrar y elige **Reintentar** o **Descartar** en **Cola de sincronización**. **Aparece “No se registró”:** el servidor rechazó la venta y no la reintentará; corrige el motivo con el responsable antes de registrarla de nuevo. **Monto incorrecto:** informa al responsable con hora e identificador del movimiento; no compenses con una segunda operación improvisada. **Registrar desactivado:** selecciona al cliente, revisa permisos y conexión.

## Continúa con otra tarea

- [Enviar operaciones pendientes](/ayuda/caja/sincronizar/)
- [Revisar un movimiento](/ayuda/negocio/movimientos/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/equipo/escaner/). Revisión del 17 de noviembre de 2026.
