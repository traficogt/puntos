---
title: Cambiar el ritmo y aprobar ofertas del equipo
description: Define límites para la operación y autoriza plantillas que el equipo
  pueda activar.
reviewed: '2026-11-17'
kind: task
sources:
- web/merchant/src/Decisions.jsx
- web/merchant/src/DecisionActions.jsx
- web/merchant/src/OperatingControls.jsx
- web/merchant/src/operating-controls-model.js
owner_route: decisiones
---

# Cambiar el ritmo y aprobar ofertas del equipo

Define límites para la operación y autoriza plantillas que el equipo pueda activar. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#decisiones)

## Antes de empezar

Revisa capacidad real, presupuesto y permisos. Una plantilla requiere una oferta breve preparada y un costo supuesto por punto.

## Paso a paso

1. En **Decisiones**, encuentra **Ritmo del negocio**.
2. Elige **Nuevo ritmo**: tranquilo, normal u ocupado. En **Capacidad para bonos**, escribe el máximo de bonos de ofertas operativas simultáneas, de 1 a 200, o deja el campo vacío para no fijar un límite (**Sin límite**). Pulsa **Guardar ritmo**.
3. En **Ofertas preaprobadas para el equipo**, selecciona un **Borrador de oferta breve**.
4. Define **Activaciones autorizadas** y **Vigencia de la aprobación (días)**. Para aprobar, **Capacidad para bonos** debe tener un valor de 1 a 200: sin límite no se puede aprobar una plantilla. Revisa audiencia, bono y límites antes de **Aprobar límites de la plantilla**.
5. Configura quién puede activar la oferta desde **Equipo y permisos**.

## Qué debe pasar

El ritmo ocupado pausa invitaciones pendientes; las recompensas y ofertas ya emitidas siguen vigentes. El equipo autorizado puede activar la plantilla dentro de sus límites, sin rediseñar sus términos.

## Si algo no funciona

**No hay plantillas:** prepara una oferta breve en Campañas dirigidas. **No se guarda la capacidad:** usa un número entero de 1 a 200 o deja el campo vacío; un campo vacío significa sin límite, no cero. **Aprobar límites de la plantilla está desactivado:** elige un borrador e indica una capacidad de 1 a 200. **Falta costo supuesto por punto:** no se puede aprobar el límite monetario. **Activación no envía mensajes:** los mensajes se preparan por separado. El límite monetario usa un supuesto y no garantiza el costo real de los premios futuros.

## Continúa con otra tarea

- [Permisos por persona y período](/ayuda/negocio/permisos/)
- [Preparar una oferta](/ayuda/negocio/campanas/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#decisiones). Revisión del 17 de noviembre de 2026.
