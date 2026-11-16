---
title: Autorizar canjes desde una caja compatible
description: Define qué caja y sucursal pueden iniciar canjes y qué cuenta PF responde
  por ellos.
reviewed: '2026-11-16'
kind: task
sources:
- web/merchant/src/RewardsWorkspace.jsx
owner_route: recompensas
---

# Autorizar canjes desde una caja compatible

Define qué caja y sucursal pueden iniciar canjes y qué cuenta PF responde por ellos. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#recompensas)

## Antes de empezar

Necesitas un conector compatible, artículos vinculados y una cuenta PF elegible asignada a la sucursal. Crear artículos manuales no exige esta conexión.

## Paso a paso

1. En **Recompensas y catálogo**, abre **Canjear desde la caja**.
2. Pulsa **Autorizar una caja** para una nueva autorización o **Configurar caja** para una existente. Selecciona **Caja conectada**, **Sucursal de la caja** y **Cuenta PF responsable**.
3. Revisa **Permitir canjes desde esta caja y sucursal**.
4. Pulsa **Guardar autorización de caja** y comprueba la configuración.
5. Prueba el recorrido completo con el instalador: autorización de puntos, entrega, recibo y movimiento físico en el POS.

## Qué debe pasar

PF autoriza el débito de puntos dentro de la configuración. El conector debe confirmar la entrega y la evidencia de caja; autorizar el origen no certifica toda la integración.

## Si algo no funciona

**No hay caja disponible:** conecta primero un origen compatible. **No hay cuenta elegible:** asigna la cuenta apropiada a esa sucursal. **Respuesta incierta al guardar:** usa **Actualizar configuración** antes de guardar otro cambio.

## Continúa con otra tarea

- [Vincular artículo y recompensa](/ayuda/negocio/catalogo/)
- [Revisar canjes y recibos](/ayuda/negocio/canjes/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#recompensas). Revisión del 16 de noviembre de 2026.
