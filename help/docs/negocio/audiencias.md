---
title: Crear una audiencia con condiciones
description: Guarda un grupo reutilizable basado en datos de compra, saldo o antigüedad.
reviewed: '2026-11-16'
kind: task
sources:
- web/merchant/src/Audiences.jsx
- web/merchant/src/AudienceRules.jsx
- web/merchant/src/audience-model.js
owner_route: audiencias
---

# Crear una audiencia con condiciones

Guarda un grupo reutilizable basado en datos de compra, saldo o antigüedad. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#audiencias)

## Antes de empezar

Define a quién quieres incluir y quién debe quedar fuera. Revisa la cobertura de registros antes de interpretar inactividad.

## Paso a paso

1. Abre **Audiencias** y pulsa **Nueva audiencia** o usa una propuesta como **Clientes frecuentes**.
2. Escribe **Nombre de la audiencia** y el **Período para sumar compras e importes**.
3. En **Incluir clientes que cumplan**, elige **Dato**, **Comparación** y **Valor**. Usa **Añadir condición de inclusión** si necesitas otra regla.
4. Agrega exclusiones con **Añadir condición de exclusión** cuando correspondan.
5. Pulsa **Ver clientes que coinciden**, revisa el resultado y después **Guardar audiencia**.

## Qué debe pasar

La audiencia queda disponible para preparar ofertas. La lista guardada con una campaña no cambia cuando editas posteriormente la audiencia.

## Si algo no funciona

**Una persona sin compras no aparece como inactiva:** quien nunca compró no tiene días desde la última compra; utiliza una condición adecuada para nuevos sin compra. **Importados aparecen como nuevos:** “Registro en PF” usa la fecha de alta en PF, incluida la importación. El saldo es el actual; las devoluciones parciales pendientes pueden afectar la lectura.

## Continúa con otra tarea

- [Preparar una campaña dirigida](/ayuda/negocio/campanas/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#audiencias). Revisión del 16 de noviembre de 2026.
