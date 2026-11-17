---
title: Qué puedes hacer sin internet
description: La captura sin conexión conserva compras pendientes; no confirma saldos,
  canjes ni entregas.
reviewed: '2026-11-17'
kind: task
sources:
- public/staff.html
- public/staff/index.js
- public/staff/award-queue.js
- public/idb.js
---

# Qué puedes hacer sin internet

La captura sin conexión conserva compras pendientes; no confirma saldos, canjes ni entregas. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/equipo/escaner/)

## Antes de empezar

La sesión del personal debe haberse validado con internet y conservar una autorización vigente de captura sin conexión. La pantalla indica si está disponible; no basta con haber abierto PF alguna vez.

## Paso a paso

1. Lee **Pendientes**, **Requieren decisión**, **Rechazadas** y el mensaje de autorización en el escáner. Si te pide conectar y validar la sesión, recupera internet antes de seguir.
2. Si PF lo permite, captura el código del cliente y los datos de la compra. Revisa que se haya guardado como pendiente.
3. Explica al cliente que los puntos se verificarán al sincronizar; no prometas que ya están disponibles.
4. Conserva el navegador y sus datos. Cuando vuelva la conexión, usa la misma cuenta del negocio y pulsa **Sincronizar**.
5. Si una venta queda **Rechazada** o **Requiere tu decisión**, revísala con el responsable antes de registrarla de nuevo.

## Qué debe pasar

Las compras aceptadas por el servidor salen de la cola. Si falla la red o el servidor no responde, la compra sigue pendiente y se reintenta sola con su misma referencia. Si el servidor la rechaza, la cola muestra el motivo y no la vuelve a enviar.

## No borres la cola para resolver un error

Limpiar los datos del sitio, usar otro navegador o perder el dispositivo puede dejarte sin los registros locales pendientes. Una venta pendiente no está rechazada: la falta de respuesta no demuestra que el servidor no la haya recibido, y reenviarla con su referencia no la duplica. No la registres otra vez.

## Si algo no funciona

**Canje, gift card, cortesía, promesa, incidencia o comprobación de POS:** requieren conexión; no se guardan en esta cola. **Error de almacenamiento:** no repitas la venta; conserva la pantalla y pide ayuda. **Autorización vencida:** vuelve a validar tu sesión con internet. La captura se habilita por 24 horas desde la validación, no de forma indefinida. Si una venta no se envió porque la sesión había vencido, la cola la marca como **Requiere tu decisión**: inicia sesión y elige **Reintentar** o **Descartar**.

## Continúa con otra tarea

- [Sincronizar y revisar ventas rechazadas](/ayuda/caja/sincronizar/)
- [Entregar el turno](/ayuda/caja/cerrar-turno/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/equipo/escaner/). Revisión del 17 de noviembre de 2026.
