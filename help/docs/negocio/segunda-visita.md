---
title: Invitar a una segunda compra
description: Aprueba una propuesta de bono para quien vuelva después de su primera
  compra registrada.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/SecondVisitControls.jsx
- web/merchant/src/second-visit-model.js
owner_route: automatizaciones
---

# Invitar a una segunda compra

Aprueba una propuesta de bono para quien vuelva después de su primera compra registrada. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#automatizaciones)

## Antes de empezar

Revisa regla, recompensa, compra mínima y presupuesto. La propuesta inicial es una sugerencia para revisar, no una recomendación de rentabilidad comprobada.

## Paso a paso

1. En **Notificaciones automáticas**, abre **De la primera a la segunda visita**.
2. Puedes usar **Usar propuesta para revisar** para completar una base y después ajustar los valores.
3. Define **Bono en la segunda compra**, **Compra mínima**, **Días para volver**, **Máximo de ofertas nuevas al mes** y **Presupuesto mensual en puntos**.
4. Marca **Activar invitación a la segunda visita**, pulsa **Revisar antes de activar** y lee el compromiso. Usa **Confirmar y activar segunda visita** para aprobarlo, o **Guardar propuesta sin activar** si solo preparas un borrador.
5. Consulta puntos reservados, ofertas creadas y **Regreso observado** después de la activación.

## Qué debe pasar

La regla puede crear una invitación por cliente. La compra siguiente debe cumplir el mínimo antes de vencer; si coincide otra oferta dirigida, se aplica la que vence primero.

Para seguir a todos los clientes de una semana de primeras compras, consulta **De la primera compra a la segunda** en **Inicio**, dentro de **Ver análisis detallado**. Ese informe tiene un plazo fijo de treinta días y muestra comportamiento registrado; no exige activar esta invitación ni cambia su bono, mínimo o plazo.

## Si algo no funciona

**No alcanza el presupuesto:** cada oferta reserva su bono completo; vencer o devolver una compra no repone ese límite. **Pausas la regla:** se detienen nuevas invitaciones y se conservan bonos ya prometidos. **Hay regresos observados:** no equivalen a ventas adicionales causadas por el bono.

## Continúa con otra tarea

- [Controlar costos](/ayuda/negocio/costos/)
- [Leer el resumen del negocio](/ayuda/negocio/resumen/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#automatizaciones). Revisión del 25 de noviembre de 2026.
