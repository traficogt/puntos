---
title: Leer el resumen del negocio
description: Consulta compras, repetición y canjes, y sigue el regreso de quienes
  registraron su primera compra durante una semana.
reviewed: '2026-11-16'
kind: task
sources:
- web/merchant/src/Overview.jsx
- web/merchant/src/FirstPurchaseReturns.jsx
- src/app/services/first-purchase-return-service.js
- src/app/routes/analytics/first-purchase-returns.js
owner_route: resumen
---

# Leer el resumen del negocio

Consulta compras, repetición y canjes, y sigue el regreso de quienes registraron su primera compra durante una semana. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#resumen)

## Antes de empezar

Necesitas operaciones registradas. Las cifras de PF pueden representar solo una parte de las ventas si no registras todas las compras del negocio. El informe **De la primera compra a la segunda** requiere la cuenta del dueño y acceso al análisis según el plan y la configuración.

## Paso a paso

1. Abre **Resumen**, elige **Período** y **Sucursal**, y pulsa **Actualizar**.
2. Comprueba la fecha de consulta, la zona horaria y si el día actual es parcial.
3. Revisa ventas registradas, clientes con compras, clientes que repitieron y recompensas canjeadas. Lee el denominador del porcentaje.
4. En **Actividad del equipo esta semana**, distingue compras, abonos, ajustes y reversiones. Usa **Ver movimientos de esta semana** para investigar.
5. Para **Visitas después de canjear**, separa quienes tienen treinta días completos de quienes siguen en seguimiento.
6. En **De la primera compra a la segunda**, elige **Semana de la primera compra**. Este selector es independiente de **Período**. Revisa cuántos clientes tienen treinta días completos, cuántos regresaron y cuántos siguen en seguimiento. Usa **Actualizar primeras compras** para consultar cambios.

## De la primera compra a la segunda

Cada semana va de lunes a domingo en la zona horaria del negocio. Puedes elegir entre 52 semanas, incluida la actual; al abrir el informe se muestra la semana completa anterior. Las semanas recientes suelen tener seguimiento pendiente.

La primera compra se busca en el historial completo disponible del negocio, antes de seleccionar la semana. No se limita a las 52 semanas del selector. Es la primera **compra registrada**, que puede ser posterior a la primera visita real de esa persona. Se usa la fecha de la compra; en registros antiguos sin ese dato, la fecha de registro. El informe indica cuántos clientes necesitaron esta última fecha.

Para contar un regreso, debe haber otra compra en una fecha local posterior y antes de cumplirse 720 horas desde la primera, equivalentes a treinta días de 24 horas. Dos comprobantes del mismo día no cuentan como regreso. Los bonos, ajustes y saldos iniciales importados no son compras. Una compra completamente revertida queda fuera; que sus puntos sigan pendientes o hayan vencido no borra una compra válida.

El porcentaje incluye a **todos los clientes con treinta días completos**, también a quienes no regresaron. Quienes aún no completan el plazo aparecen aparte, incluso si ya regresaron; no entran todavía en ese porcentaje. Si nadie tiene el plazo completo, todavía no hay un porcentaje que interpretar.

Al elegir **Sucursal**, seleccionas dónde ocurrió la primera compra. Un regreso a cualquier sucursal del mismo negocio cuenta. Las primeras compras sin sucursal asignada solo aparecen al consultar todas. El informe muestra totales, sin identificar clientes, y conserva en esos totales el historial de clientes eliminados.

## Qué debe pasar

Obtienes un resumen de los registros dentro del alcance indicado. Una compra puede incluir un abono; sumar ambas columnas como operaciones distintas duplicaría el conteo.

## Si algo no funciona

**Cifras distintas entre secciones:** algunas usan el período elegido y otras la semana o una ventana propia; revisa el rótulo. **Datos cambian después:** el informe solo incluye compras recibidas al momento de la consulta. Sincronizaciones tardías, devoluciones y correcciones pueden cambiar tanto la primera compra como el regreso. Revisa la fecha de consulta y los avisos de datos atrasados o sin conexión antes de comparar.

**No aparecen primeras compras:** puede haber clientes que compraron durante esa semana, pero ya tenían una compra anterior. Un resultado vacío tampoco demuestra que se registraron todas las ventas. La actividad del personal no mide desempeño ni prueba irregularidades; un regreso observado, tras la primera compra o un canje, no demuestra que el programa lo causó.

## Continúa con otra tarea

- [Revisar movimientos](/ayuda/negocio/movimientos/)
- [Leer costos conocidos y estimados](/ayuda/negocio/costos/)
- [Invitar a una segunda compra](/ayuda/negocio/segunda-visita/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#resumen). Revisión del 16 de noviembre de 2026.
