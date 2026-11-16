---
title: Restituir puntos de un canje no entregado
description: Usa el caso relacionado para devolver únicamente el débito comprobado
  del canje.
reviewed: '2026-11-16'
kind: task
sources:
- web/merchant/src/ServiceCases.jsx
- web/merchant/src/RedemptionReturns.jsx
owner_route: casos
---

# Restituir puntos de un canje no entregado

Usa el caso relacionado para devolver únicamente el débito comprobado del canje. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#casos)

## Antes de empezar

Necesitas un canje confirmado, un caso relacionado y autorización suficiente. Confirma con el cliente qué ocurrió y revisa si ya hubo restitución.

## Paso a paso

1. En **Atención al cliente**, abre el caso con **Revisar caso**.
2. Comprueba el canje original y la evidencia de puntos descontados.
3. En **Cómo se resolvió**, selecciona la opción de restituir puntos del canje si está disponible.
4. Escribe el motivo y revisa la explicación del efecto antes de **Guardar resolución**.
5. Comprueba el historial guardado y la restitución; revisa por separado la entrega o devolución del producto en tu caja.

## Qué debe pasar

Se restituye el débito verificado una sola vez por canje. No cambia puntos ganados de por vida ni existencias; guardar programa la actualización de Wallet, sin garantizar cuándo aparece en el dispositivo.

## Si algo no funciona

**Opción no disponible:** puede faltar un canje confirmado, autorización o ya existir restitución. **Se superó el límite:** escala al dueño; no dividas artificialmente la acción. **Producto entregado y luego devuelto:** revisa también la evidencia de devolución de caja. Restituir puntos no prueba recuperar el costo del producto.

## Continúa con otra tarea

- [Revisar devoluciones de caja](/ayuda/negocio/devoluciones/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#casos). Revisión del 16 de noviembre de 2026.
