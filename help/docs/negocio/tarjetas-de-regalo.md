---
title: Emitir una tarjeta de regalo y revisar sus movimientos
description: Crea una tarjeta con saldo, comparte su código por un medio privado y
  comprueba que el saldo coincida con sus movimientos.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/OwnerGiftCards.tsx
- src/app/routes/gift-card-routes.js
- src/app/services/gift-card-service.js
owner_route: tarjetas-de-regalo
---

# Emitir una tarjeta de regalo y revisar sus movimientos

Crea una tarjeta con saldo, comparte su código por un medio privado y comprueba que el saldo coincida con sus movimientos. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#tarjetas-de-regalo)

## Antes de empezar

Ingresa con la cuenta del dueño; el plan debe incluir tarjetas de regalo. Estas tarjetas tienen saldo en dinero y un código propio; son distintas de los puntos y del programa de tipo tarjeta de regalo, que es el monedero recargable del cliente. El equipo las cobra desde el escáner si tiene el permiso **Permitir administrar tarjetas de regalo** en su cuenta.

## Paso a paso

1. Abre **Tarjetas de regalo** en el grupo **Mi programa** y pulsa **Crear tarjeta**.
2. En **Nueva tarjeta de regalo**, escribe el **Monto inicial** en la moneda del negocio y, si quieres, **Nombre de quien la recibe (opcional)** y **Teléfono de quien la recibe (opcional)**.
3. Pulsa **Crear tarjeta**. Lee el aviso **Tarjeta creada** con el **Código** y el **Token QR**, y compártelos con la persona por un medio privado. Si la conexión falla y repites el envío, PF no crea una segunda tarjeta.
4. Revisa la tabla: **Emitida**, **Código**, **Para**, **Saldo** con el inicial debajo y **Estado**: **Activa**, **Vencida** o **Agotada**.
5. Pulsa **Ver movimientos** para abrir **Movimientos de** la tarjeta: **Saldo guardado**, **Saldo esperado**, **Emitido**, **Usado** y la lista con cada **Emisión** y **Uso** y su saldo después. **Ocultar movimientos** cierra el detalle.

## Qué debe pasar

La tarjeta queda **Activa** con su saldo inicial. El equipo la cobra en el escáner con **Canjear gift card**, usando el código o el token; cada cobro aparece aquí como **Uso**. El detalle compara el saldo guardado con la suma de los movimientos: **Saldo consistente** cuando coinciden y **Revisar saldo** cuando hay una diferencia, con la indicación de revisar con soporte antes de usar la tarjeta.

La lista muestra hasta 100 tarjetas recientes y el detalle, los últimos diez movimientos. Esta pantalla no fija una fecha de vencimiento ni recarga una tarjeta emitida.

## Si algo no funciona

**Monto rechazado:** indica un monto mayor que cero con los decimales de la moneda del negocio. **Crear tarjeta no aparece:** tu plan no incluye tarjetas de regalo o no entraste como dueño. **El equipo no puede cobrarla:** revisa en **Personal** el permiso **Permitir administrar tarjetas de regalo**; el escáner también rechaza tarjetas vencidas, agotadas o con saldo insuficiente. **Revisar saldo:** no uses la tarjeta hasta aclarar la diferencia con soporte.

## Continúa con otra tarea

- [Descontar saldo de una tarjeta de regalo](/ayuda/caja/gift-cards/)
- [Crear una cuenta para el equipo](/ayuda/negocio/personal/)
- [Cambiar permisos o desactivar una cuenta](/ayuda/negocio/cambiar-acceso/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#tarjetas-de-regalo). Revisión del 25 de noviembre de 2026.
