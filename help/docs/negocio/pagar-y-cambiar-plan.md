---
title: Pagar con tarjeta, cambiar o cancelar tu plan
description: Elige Conecta, Impulsa o Expande en Plan y facturación, paga con tarjeta a través
  de Recurrente, guarda el comprobante fiscal y cambia o cancela el plan cuando lo necesites.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/OwnerPlan.tsx
- web/merchant/src/billing-model.ts
- web/merchant/src/TrialBanner.tsx
owner_route: plan
---

# Pagar con tarjeta, cambiar o cancelar tu plan

Elige Conecta, Impulsa o Expande en **Plan y facturación**, paga con tarjeta a través de Recurrente, guarda el comprobante fiscal y cambia o cancela el plan cuando lo necesites. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#plan)

## Antes de empezar

Ingresa con la cuenta del dueño. **Plan y facturación** está en el grupo **Caja, equipo y ajustes** y también en **Configuración**, bajo **Plan y cobro**; durante la prueba gratis, el botón **Mejorar plan** del aviso **Prueba gratis** abre esta misma pantalla. Ten a mano una tarjeta de crédito o débito y el NIT con el que quieres el comprobante fiscal (o "CF" si no lo necesitas). El precio es por sucursal al mes: la pantalla multiplica el precio del plan por tus sucursales y muestra el total en la moneda del catálogo (dólares, salvo que tu negocio tenga precios en quetzales). El pago en línea cubre hasta 9 sucursales; con más, escríbenos. Si la pantalla dice **El pago con tarjeta estará disponible pronto**, el cobro en línea todavía no está activo en tu servidor: envía la solicitud y te contactamos.

## Paso a paso

1. Abre **Plan y facturación**. La tarjeta de estado dice en qué situación estás: **En prueba** con los días que quedan, **Activo** con la fecha del próximo cobro, **Pago pendiente** con el próximo intento o **Cancelado** con la fecha en que termina el acceso.
2. En **Elige tu plan**, compara Conecta, Impulsa y Expande. Debajo de cada precio verás la cuenta `precio × sucursales = total al mes`; Conecta incluye una sola sucursal.
3. Pulsa **Pagar con tarjeta** en el plan que quieres. Se abre la página segura de Recurrente, donde escribes la tarjeta y los datos de facturación (nombre y NIT). PuntosFieles no guarda tu tarjeta.
4. Al terminar, Recurrente te devuelve al panel. Verás **Confirmando tu pago…** durante unos segundos y después **Tu plan Impulsa está activo** (o el plan que elegiste). Si cerraste la página antes de pagar, la tarjeta de estado muestra **Tienes un pago en curso** con el botón **Continuar el pago**.
5. Para subir o bajar de plan más adelante, pulsa **Cambiar a Impulsa** (o el plan que corresponda). El cuadro explica qué pasa: al subir, se cobra hoy solo la diferencia proporcional por los días que faltan del período y el nuevo plan se activa de inmediato; al bajar, sigues con tu plan hasta el final del período pagado y el nuevo precio aplica desde el siguiente cobro. Confirma con el botón del cuadro.
6. Para dejar de pagar, pulsa **Cancelar al final del período**. El cuadro muestra hasta qué fecha sigue activo tu plan; confirma con **Cancelar al final del período**. No hay reembolso por los días ya pagados.
7. En **Cobros y comprobantes**, pulsa **Ver comprobante** junto a cada cobro para abrir el documento fiscal (FEL) que emite Recurrente.

## Qué debe pasar

Cuando el pago se confirma, el panel vuelve a operar con normalidad: el pie de página muestra el nuevo plan, el aviso de prueba desaparece y, si el panel estaba en modo de lectura, se desbloquea con la misma información. El cobro se repite cada mes con la misma tarjeta en la fecha que indica la tarjeta de estado. En el estado de cuenta de tu tarjeta el cargo aparece a nombre de Recurrente, el procesador de pagos, no de PuntosFieles. El comprobante fiscal (FEL) lo emite Recurrente por cada cobro exitoso con el NIT que escribiste en la página de pago; aparece en **Cobros y comprobantes** y puede tardar unos minutos después del pago. Si un cobro mensual es rechazado, la tarjeta de estado pasa a **Pago pendiente**: Recurrente vuelve a intentar con la misma tarjeta durante los días siguientes y el panel sigue operando; si el pago no se completa en 7 días, el panel pasa a modo de lectura (puedes consultar y exportar, no registrar) hasta que el cobro se complete, y las tarjetas de tus clientes siguen visibles. Al cancelar al final del período, no hay más cobros y el acceso continúa hasta la fecha indicada; después el panel pasa a modo de lectura y los datos se conservan 30 días antes de eliminarse.

## Si algo no funciona

**El pago no se completó** o **Pago cancelado:** no se hizo ningún cobro; vuelve a pulsar **Pagar con tarjeta**. **Seguimos esperando la confirmación:** Recurrente aún no avisó del pago; vuelve a cargar la pantalla en unos minutos y, si tu tarjeta ya muestra el cargo, el plan se activa solo. **El pago en línea cubre hasta 9 sucursales:** escríbenos desde **Contactar soporte** para activar un plan mayor. **Tu negocio ya tiene un plan activo:** recarga la página para ver el estado actual. **El pago con tarjeta estará disponible pronto:** el cobro en línea no está activo en este servidor; completa la solicitud con tu **Teléfono o WhatsApp** y pulsa **Enviar solicitud**. **No pudimos consultar el pago:** si ya pagaste, escríbenos con la fecha y el monto y activamos el plan manualmente. Si necesitas corregir el NIT de un comprobante, pide la corrección por soporte: Recurrente puede reemitirlo.

## Continúa con otra tarea

- [Empezar la prueba gratis de 14 días y elegir plan](/ayuda/negocio/prueba-gratis/)
- [Leer el reporte básico y la capacidad del plan](/ayuda/negocio/reportes/)
- [Agregar una sucursal](/ayuda/negocio/sucursales/)
- [Encontrar los ajustes del negocio](/ayuda/negocio/configuracion/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#plan). Revisión del 25 de noviembre de 2026.
