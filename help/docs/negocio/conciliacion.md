---
title: Conciliar el libro de puntos y certificar un periodo
description: Revisa señales de riesgo, descuadres de saldo y correcciones manuales, y
  descarga la certificación de un periodo.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/OwnerLedger.tsx
- web/merchant/src/owner-operations-model.ts
- src/app/routes/analytics/anomalies.js
- src/app/routes/analytics/ledger.js
- src/app/routes/analytics/corrections.js
- src/app/routes/analytics/certification.js
owner_route: conciliacion
---

# Conciliar el libro de puntos y certificar un periodo

Revisa señales de riesgo, descuadres de saldo y correcciones manuales, y descarga la certificación de un periodo. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#conciliacion)

## Antes de empezar

Ingresa con la cuenta del dueño; la pantalla requiere un plan con análisis avanzado. **Conciliación del libro de puntos** está en el grupo **Avanzado**; pulsa **Ver todas las herramientas** si el menú no lo muestra. Las correcciones manuales siguen una regla de dos personas: quien solicita una corrección no es quien la aplica.

## Paso a paso

1. Abre **Conciliación del libro de puntos**. **Actualizar** vuelve a consultar todas las secciones.
2. En **Señales de riesgo**, lee los valores atípicos detectados (importes o puntos fuera de lo habitual) con su fecha y descripción.
3. En **Conciliación de saldos**, revisa las conciliaciones recientes y, en **Descuadres de la última conciliación**, los clientes cuyo saldo guardado no coincide con la suma de sus movimientos. Para uno de ellos, pulsa **Solicitar corrección para el cliente …**: el formulario se rellena con su identificador.
4. En **Correcciones manuales**, completa **Identificador del cliente** y **Razón de la corrección** y pulsa **Solicitar corrección**. La solicitud queda pendiente.
5. Para una solicitud pendiente de otra persona, pulsa **Aplicar** o **Rechazar corrección**; el rechazo pide **Razón del rechazo de la corrección** y se confirma con **Confirmar rechazo**.
6. En **Certificación del periodo**, elige **Desde** y **Hasta** y pulsa **Consultar periodo**. Lee los movimientos diarios y descarga **Descargar CSV del periodo** o, por día, **Descargar CSV del …** y **Descargar JSON del …**. Las certificaciones guardadas aparecen en **Certificaciones archivadas**.

## Qué debe pasar

Leer señales, conciliaciones y certificaciones no modifica el libro. Aplicar una corrección sí: ajusta el saldo del cliente al valor que resulta de sus movimientos y queda registrada en **Auditoría** con quién la solicitó y quién la aplicó. Una certificación describe el periodo tal como estaba al consultarlo; si después se registran movimientos con fechas de ese periodo, vuelve a consultarlo.

## Si algo no funciona

**No puedes aplicar tu propia solicitud:** es la regla de dos personas; pide a otra cuenta de dueño que la revise. **Escribe la razón:** la solicitud y el rechazo requieren un motivo. **El periodo no devuelve días:** amplía **Desde** y **Hasta** o comprueba que haya movimientos en esas fechas. **Un descuadre reaparece:** revisa **Trabajos en segundo plano** y espera a la siguiente conciliación antes de solicitar otra corrección. Usa **Ver auditoría** para seguir el rastro de cada cambio.

## Continúa con otra tarea

- [Consultar la auditoría del negocio](/ayuda/negocio/auditoria/)
- [Revisar trabajos en segundo plano y recalcular la analítica](/ayuda/negocio/trabajos/)
- [Buscar y explicar un movimiento](/ayuda/negocio/movimientos/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#conciliacion). Revisión del 25 de noviembre de 2026.
