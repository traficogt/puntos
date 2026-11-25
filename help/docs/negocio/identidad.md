---
title: Definir la identidad del programa que ve el cliente
description: Elige el modo de marca, el nombre, el logotipo, los colores y los textos
  de la página de registro y de la tarjeta del cliente.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/OwnerBranding.tsx
- src/app/routes/admin/branding-routes.js
- src/utils/schemas.js
owner_route: identidad
---

# Definir la identidad del programa que ve el cliente

Elige el modo de marca, el nombre, el logotipo, los colores y los textos de la página de registro y de la tarjeta del cliente. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#identidad)

## Antes de empezar

Ingresa con la cuenta del dueño. Ten a mano el enlace https de tu logotipo y los colores de tu marca en hexadecimal. Esta pantalla ajusta la intensidad de tu marca y los textos visibles; la estructura de la tarjeta y del registro no cambia, y el QR impreso con tu marca se prepara en **Marca y QR**.

## Paso a paso

1. Abre **Identidad del programa** en el grupo **Caja, equipo y ajustes**; pulsa **Ver todas las herramientas** si el menú no lo muestra.
2. Elige el **Modo de marca**: **PuntosFieles visible**, **Tu negocio con «Powered by PuntosFieles»** o **Tu negocio al frente**. La descripción bajo el selector explica cada modo.
3. Escribe el **Nombre del programa** y el **Logotipo del negocio (enlace https)**. Marca **Insertar el logotipo dentro del QR del cliente** solo si tu plan lo permite; la casilla indica cuándo está reservada a otro plan.
4. Define **Color principal** y **Color de acento** con seis dígitos hexadecimales, elige el **Tema neutral** (**Cálido**, **Neutral** o **Frío**), decide si conservar **Mostrar «Powered by PuntosFieles»** y escribe el **Titular de la tarjeta** y el **Titular del registro**.
5. Revisa la **Vista rápida** y pulsa **Guardar identidad**. **Descartar cambios** vuelve a lo guardado.

## Qué debe pasar

Aparece **Identidad guardada.** La identidad solo cambia lo que ve el cliente en el registro y en su tarjeta; no modifica reglas ni saldos. La identidad premium en las pantallas del cliente depende del plan: puedes guardar tu preferencia desde ahora y la pantalla indica si tu plan ya la permite. El logotipo dentro del QR se aplica únicamente en el plan que lo incluye; en otro plan la casilla está desactivada y el servidor rechaza esa opción.

## Si algo no funciona

**El logotipo se rechaza:** debe ser un enlace https. **Un color se rechaza:** usa seis dígitos hexadecimales, por ejemplo #6D3524. **La casilla del QR está desactivada:** tu plan no incluye el logotipo dentro del QR. **No ves los cambios en la tarjeta del cliente:** pide a la persona actualizar su tarjeta con conexión y comprueba el plan indicado en la pantalla.

## Continúa con otra tarea

- [Preparar e imprimir el QR del negocio](/ayuda/negocio/marca-qr/)
- [Revisar moneda, horario y ubicaciones de Wallet](/ayuda/negocio/region/)
- [Crear mi tarjeta del negocio](/ayuda/clientes/registrarme/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#identidad). Revisión del 25 de noviembre de 2026.
