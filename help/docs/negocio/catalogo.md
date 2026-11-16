---
title: Vincular un artículo a una recompensa
description: Relaciona la recompensa con el producto o servicio que se entregará.
reviewed: '2026-11-16'
kind: task
sources:
- web/merchant/src/RewardsWorkspace.jsx
- web/merchant/src/reward-workspace-model.js
owner_route: recompensas
---

# Vincular un artículo a una recompensa

Relaciona la recompensa con el producto o servicio que se entregará. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#recompensas)

## Antes de empezar

Abre una recompensa en edición. Un artículo manual o importado no requiere tener un POS conectado; las existencias físicas se comprueban por separado.

## Paso a paso

1. En **Artículo que entregarás (opcional)**, usa **Buscar artículo**, **Crear artículo manual** o **Importar CSV**.
2. Para un artículo manual, completa **Nombre del artículo**, **SKU (opcional)** y **Tipo de artículo**, y pulsa **Guardar artículo y elegir** antes de guardar la recompensa.
3. Para CSV, revisa las columnas indicadas: productRef, sku, name, itemKind, active y revision. Pulsa **Revisar importación** y confirma los nombres y revisiones antes de **Importar artículos revisados**.
4. Elige **Sucursal donde se entrega este artículo** y **Cantidad del artículo por canje**.
5. Revisa **Vínculo habilitado para la caja** y, si corresponde, **Comprobar existencias antes de permitir el canje**. Guarda la recompensa.

## Qué debe pasar

PF conserva el vínculo entre recompensa y artículo. Consultar existencias no reserva unidades ni registra por sí mismo una salida física en tu caja.

## Si algo no funciona

**CSV con conflicto de revisión:** conserva la referencia, usa la revisión actual del artículo y vuelve a revisar. **No hay evidencia de existencias:** compruébalas en la caja; no asumas disponibilidad. **Creaste un artículo y cancelaste la recompensa:** el artículo ya guardado permanece en el catálogo.

## Continúa con otra tarea

- [Permitir canjes desde el POS](/ayuda/negocio/canjes-pos/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#recompensas). Revisión del 16 de noviembre de 2026.
