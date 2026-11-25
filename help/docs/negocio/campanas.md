---
title: Preparar y activar una campaña dirigida
description: Define participantes, bono y límites antes de activar una oferta.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/GrowthCampaigns.jsx
- web/merchant/src/CampaignPreflight.jsx
- web/merchant/src/CampaignMeasurementPlan.jsx
- web/merchant/src/OfferCostPreview.jsx
- src/app/services/scale-limits.js
- web/merchant/src/BulkCampaignPreparation.jsx
owner_route: ofertas
---

# Preparar y activar una campaña dirigida

Define participantes, bono y límites antes de activar una oferta. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#ofertas)

## Antes de empezar

Necesitas una lista de recuperación o audiencia guardada. Ten claros la compra mínima, vigencia y presupuesto. Una campaña con comparación necesita al menos diez clientes activos.

## Paso a paso

1. Abre **Campañas dirigidas** (en el menú, **Campañas y ofertas**). Elige **Tipo de oferta**, escribe **Nombre de la campaña** y selecciona **Origen de los participantes**.
2. Con una audiencia, indica el **Máximo de clientes para esta oferta**: de 1 a 200 en una oferta breve; en una campaña, más de 200 se preparan en segundo plano, hasta 5,000, y el botón cambia a **Preparar audiencia en segundo plano**. Tu plan fija además su propio máximo por campaña: 300 clientes en Conecta y 2,000 en Impulsa; Expande llega al tope técnico de 5,000. Completa los puntos extra por cliente, compra mínima y vigencia. Revisa el **Límite total de puntos extra** y, si lo conoces, el costo estimado de cada punto.
3. Para una campaña con comparación, revisa el **Grupo de comparación sin oferta** y guarda los supuestos del **Plan de medición** antes de activar.
4. Pulsa **Guardar borrador** y abre su detalle en **Tus campañas**.
5. Usa **Comprobar antes de activar**. Revisa participantes, compromiso máximo y los términos que vas a fijar; actualiza la comprobación si venció y marca la confirmación de términos y pulsa **Activar campaña** o **Activar oferta breve**, según el tipo.

## Qué debe pasar

La oferta activa puede conceder un bono en una compra elegible. Activar no prepara automáticamente mensajes ni reserva premios físicos. Si coinciden ofertas dirigidas, se aplica una: la que vence primero.

## Si algo no funciona

**No hay lista o audiencia vigente:** créala o actualiza la selección. **El máximo supera tu plan:** PF lo indica al guardar; reduce el máximo de clientes, divide la audiencia en varias campañas o amplía el plan. **La preparación en segundo plano tarda:** sigue su **Progreso de preparación** en la campaña; puedes **Actualizar preparación**, **Reintentar preparación** o **Cancelar preparación**. **No alcanza el límite para otro bono:** la oferta deja de otorgarlo; las devoluciones no reponen puntos consumidos. **Necesitas cambiar términos activos:** no los trates como borrador editable; revisa la opción de pausar y prepara una nueva propuesta.

## Continúa con otra tarea

- [Mensajes de una campaña](/ayuda/negocio/mensajes-campana/)
- [Leer los resultados](/ayuda/negocio/resultados-campana/)
- [Planificar costos](/ayuda/negocio/costos/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#ofertas). Revisión del 25 de noviembre de 2026.
