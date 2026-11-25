---
title: Consultar la auditoría del negocio
description: Filtra los eventos de auditoría por fechas e impersonación, abre el detalle
  de un evento y descarga el CSV.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/OwnerAudit.tsx
- web/merchant/src/owner-operations-model.ts
- src/app/routes/admin/audit.js
owner_route: auditoria
---

# Consultar la auditoría del negocio

Filtra los eventos de auditoría por fechas e impersonación, abre el detalle de un evento y descarga el CSV. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#auditoria)

## Antes de empezar

Ingresa con la cuenta del dueño; la pantalla requiere un plan con análisis avanzado. **Auditoría** está en el grupo **Avanzado**; pulsa **Ver todas las herramientas** si el menú no lo muestra. La auditoría registra acciones del equipo y de la plataforma sobre tu negocio: cambios de configuración, correcciones, canjes restituidos, accesos y acciones realizadas por soporte en tu nombre.

## Paso a paso

1. Abre **Auditoría**. La tabla **Eventos de auditoría** muestra los eventos más recientes con fecha, acción y quién la realizó.
2. Acota el periodo con **Desde** y **Hasta**. Marca **Solo acciones en impersonación** para ver únicamente lo que soporte hizo dentro de tu negocio.
3. Pulsa **Actualizar** para aplicar los filtros o volver a consultar.
4. Pulsa **Ver detalle del evento …** en una fila para abrir **Contexto del evento**: los datos que acompañan a esa acción, como identificadores y valores anteriores y nuevos. **Cerrar detalle** vuelve a la lista.
5. Descarga el **CSV** del periodo filtrado para conservarlo o compartirlo con tu contador; incluye hasta 5,000 eventos.
6. Usa **Conciliación del libro de puntos** para seguir una corrección que viste en la auditoría.

## Qué debe pasar

La auditoría es de solo lectura: filtrar, abrir detalles o descargar no cambia nada. Las acciones de la plataforma aparecen como **Plataforma** sin detalle interno; las de tu equipo muestran la cuenta que las realizó. El CSV respeta los filtros aplicados en pantalla.

## Si algo no funciona

**No aparece un evento que esperabas:** revisa **Desde** y **Hasta** y desmarca **Solo acciones en impersonación**; algunos procesos automáticos no generan evento de auditoría. **El CSV tiene menos filas que la tabla sugiere:** el límite es de 5,000 eventos; acota el periodo. **El detalle no carga:** pulsa **Actualizar** y abre el evento de nuevo. La auditoría registra lo que ocurrió en PuntosFieles; no documenta ventas que nunca se registraron.

## Continúa con otra tarea

- [Conciliar el libro de puntos y certificar un periodo](/ayuda/negocio/conciliacion/)
- [Buscar y explicar un movimiento](/ayuda/negocio/movimientos/)
- [Cambiar permisos o desactivar una cuenta](/ayuda/negocio/cambiar-acceso/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#auditoria). Revisión del 25 de noviembre de 2026.
