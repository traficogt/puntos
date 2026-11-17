---
title: Enviar pendientes y revisar ventas rechazadas
description: Confirma qué compras guardadas en este dispositivo llegaron al servidor.
reviewed: '2026-11-17'
kind: task
sources:
- public/staff.html
- public/staff/index.js
- public/staff/award-queue.js
- public/idb.js
---

# Enviar pendientes y revisar ventas rechazadas

Confirma qué compras guardadas en este dispositivo llegaron al servidor. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/equipo/escaner/)

## Antes de empezar

Recupera internet y entra con la cuenta que guardó las operaciones. La cola está separada por negocio y usuario; otra cuenta no envía tus pendientes.

## Paso a paso

1. Revisa **Pendientes**, **Requieren decisión**, **Rechazadas** y **Última actividad**.
2. Pulsa **Sincronizar** y espera el resultado **Sincronizados**.
3. Abre **Cola de sincronización** para ver cada venta con su estado y su motivo. La cola se abre sola cuando aparece una venta que necesita tu atención.
4. Si una venta **Requiere tu decisión**, la sesión no autorizó su envío. Inicia sesión con la misma cuenta y pulsa **Reintentar** para enviarla con su referencia original, o **Descartar** si no debe registrarse. Antes de volver a registrar una venta descartada, confirma en los movimientos del cliente que no se haya acreditado.
5. Si una venta quedó **Rechazada, no se reintentará**, lee el motivo del servidor e informa al responsable. Corrige la causa, pulsa **Descartar** y, si corresponde, regístrala de nuevo.
6. Antes de cerrar el turno, deja constancia de las ventas que siguen pendientes o esperan tu decisión.

## Qué debe pasar

Las operaciones confirmadas se retiran de la cola. Si falla la red, se agota la espera o el servidor tiene un error temporal, la venta sigue en **Pendientes** y se reintenta sola con la misma referencia, también al recuperar la conexión; reenviarla así no la acredita dos veces. Una venta rechazada no se reenvía nunca. Una venta que requiere tu decisión solo se envía si pulsas **Reintentar**.

## Si algo no funciona

**Nada que sincronizar para esta cuenta:** confirma usuario, negocio y dispositivo; no supone que otra cuenta no tenga pendientes. **Operaciones antiguas sin identidad:** requieren revisión y no se envían automáticamente. **Una venta sigue pendiente:** no la registres otra vez; se reintentará con su referencia. Si no se envía después de recuperar la conexión, escala con la referencia. **El mismo rechazo se repite:** no borres el almacenamiento; escala con el motivo y la referencia antes de registrar otra venta.

## Continúa con otra tarea

- [Pedir ayuda con datos útiles](/ayuda/problemas/pedir-ayuda/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/equipo/escaner/). Revisión del 17 de noviembre de 2026.
