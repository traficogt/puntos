---
title: Revisar alertas y asignar pagos sin cliente
description: Lee las alertas recientes del negocio y asigna a un cliente los pagos que
  llegaron sin teléfono reconocido.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/OwnerAlerts.tsx
- web/merchant/src/owner-operations-model.ts
- src/app/routes/admin/fraud.js
- src/app/routes/payment-webhook-routes.js
owner_route: alertas
---

# Revisar alertas y asignar pagos sin cliente

Lee las alertas recientes del negocio y asigna a un cliente los pagos que llegaron sin teléfono reconocido. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#alertas)

## Antes de empezar

Ingresa con la cuenta del dueño; la pantalla requiere un plan con análisis avanzado. **Alertas y pagos pendientes** está en el grupo **Avanzado**; pulsa **Ver todas las herramientas** si el menú no lo muestra. Ten a mano el teléfono con el que el cliente se inscribió en PuntosFieles: un nombre, correo o número de recibo no lo sustituye.

## Paso a paso

1. Abre **Alertas y pagos pendientes**. **Actualizar** vuelve a consultar ambas listas.
2. En **Centro de alertas**, lee las alertas recientes: compras marcadas como sospechosas, trabajos en segundo plano fallidos y otros avisos del negocio, con su fecha.
3. Para una compra marcada, usa **Transacciones marcadas** para ir a **Límites y políticas**, donde están los umbrales y la lista completa.
4. Para un trabajo fallido, usa **Ver trabajos en segundo plano** y revisa su estado allí.
5. En **Pagos sin cliente**, localiza el pago por su referencia e importe. Escribe el teléfono en **Teléfono del cliente · referencia** y pulsa **Asignar pago referencia**.
6. Confirma el mensaje: nombra el teléfono y el importe. Al terminar aparece **Pago asignado y puntos otorgados.** y el pago desaparece de la lista.

## Qué debe pasar

Las alertas son informativas: leerlas no cambia nada. Asignar un pago sí tiene efecto: PuntosFieles vincula el pago al cliente con ese teléfono y le otorga los puntos que correspondan según la regla vigente, como si la compra se hubiera registrado en caja. Si no hay pendientes, la sección dice **No hay pagos pendientes por asignar.**; si no hay avisos, **Sin alertas recientes.**

## Si algo no funciona

**Escribe el teléfono del cliente:** el campo está vacío o incompleto. **El teléfono no corresponde a un cliente inscrito:** el pago no se asigna; verifica el número en **Clientes** y vuelve a intentarlo. **El pago sigue en la lista tras asignarlo:** pulsa **Actualizar**; si persiste, revisa **Trabajos en segundo plano** y la conexión. No asignes un pago cuyo cliente no puedas confirmar: los puntos otorgados quedan registrados en el libro y requieren una corrección manual para revertirse.

## Continúa con otra tarea

- [Revisar trabajos en segundo plano y recalcular la analítica](/ayuda/negocio/trabajos/)
- [Ajustar límites, alertas, vencimiento y políticas](/ayuda/negocio/limites/)
- [Conciliar el libro de puntos y certificar un periodo](/ayuda/negocio/conciliacion/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#alertas). Revisión del 25 de noviembre de 2026.
