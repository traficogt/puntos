---
title: El QR no se puede leer
description: Distingue un problema de cámara, un QR vencido y un enlace de inscripción
  equivocado.
reviewed: '2026-11-17'
kind: task
sources:
- public/staff.html
- public/staff/index.js
- public/customer/qr.js
- web/merchant/src/BrandedQr.jsx
---

# El QR no se puede leer

Distingue un problema de cámara, un QR vencido y un enlace de inscripción equivocado. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/equipo/escaner/)

## Antes de empezar

Comprueba qué intenta hacer la persona: inscribirse, registrar una compra o canjear. El cartel del negocio y el QR de una tarjeta cumplen funciones distintas.

## Paso a paso

1. Si es una compra o canje, abre **Mi tarjeta** y usa **Generar QR** con conexión.
2. Muestra el código completo con buen brillo y sin reflejos. El personal debe abrir **Seleccionar cliente** y permitir la cámara.
3. Si el código venció, genera uno nuevo; una foto antigua puede no servir.
4. Si la cámara está bloqueada, revisa su permiso en el navegador. El personal puede usar **Token QR (manual)** cuando disponga del token correcto.
5. Si es un cartel de inscripción, prueba su enlace y revisa que conserve márgenes y contraste.

## Qué debe pasar

El personal debe ver el cliente correcto antes de operar. Leer un código no registra automáticamente puntos ni un canje.

## Si algo no funciona

**Muestra otro negocio o cliente:** detente y vuelve a abrir la tarjeta correcta. **Persiste el error con un QR nuevo:** registra el texto del error y pide ayuda. No envíes el token o QR vigente a un canal público.

## Continúa con otra tarea

- [Seleccionar cliente en caja](/ayuda/caja/seleccionar-cliente/)
- [QR del cartel](/ayuda/negocio/marca-qr/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/equipo/escaner/). Revisión del 17 de noviembre de 2026.
