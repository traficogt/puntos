---
title: Configurar recomendaciones entre clientes
description: Define el incentivo y revisa qué clientes llegaron con un código de recomendación.
reviewed: '2026-11-17'
kind: task
sources:
- web/merchant/src/Referrals.jsx
- src/app/services/referral-service.js
- src/app/services/gamification/reconciliation-service.js
owner_route: referidos
---

# Configurar recomendaciones entre clientes

Define el incentivo y revisa qué clientes llegaron con un código de recomendación. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#referidos)

## Antes de empezar

Revisa si premiarás al registro o al procesar una compra y qué importe acumulado exigirás. El QR público de inscripción no identifica a la persona que recomienda.

## Paso a paso

1. Abre **Recomendaciones**. En **El incentivo de tu programa**, revisa **Habilitar recomendaciones**.
2. Define **Puntos para quien recomienda**, **Puntos para el nuevo cliente** y **Cuándo se evalúa el premio**.
3. Revisa **Importe acumulado mínimo**: suma las compras confirmadas del cliente recomendado, no necesariamente un solo ticket. No cuentan las compras cuyos puntos siguen pendientes ni las devueltas.
4. Lee **Así se aplicarán tus ajustes** y pulsa **Guardar incentivos**.
5. Usa **Mostrar clientes recomendados** para contrastar registro, primera compra y premio registrado.

## Qué debe pasar

Se guardan las reglas para evaluar incentivos. Un premio al registro puede existir antes de una compra; no todas las columnas representan pasos consecutivos.

Un premio por compra depende de que esa compra se mantenga. Si se devuelve una compra hecha antes del premio y las compras confirmadas que quedan ya no cumplen la condición que se aplicó (el importe mínimo o, sin mínimo, al menos una compra), PF revierte los puntos de ambos clientes y la recomendación vuelve a quedar pendiente; una compra posterior puede completarla de nuevo. Al retirarse la recomendación, quien recomendó también puede perder un logro basado en el número de recomendaciones. Una devolución no revierte un premio que se entregó al registro.

## Si algo no funciona

**No aparece una recomendación:** comprueba si se aplicó un código; el QR general no atribuye una persona. **Desactivaste la función:** PF deja de aceptar códigos y no entrega premios a las recomendaciones pendientes, que siguen pendientes. No revierte premios ya entregados. Si vuelves a habilitarla, las reglas vigentes al evaluar el premio se aplican también a las pendientes. **Una devolución no revirtió el premio:** si el saldo de quien recomendó no alcanza para descontarlo y tu negocio no permite saldos negativos por devolución, PF conserva ambos premios; revisa el caso antes de ajustar puntos a mano. Si los puntos del premio de uno de los dos ya vencieron, PF tampoco revierte el otro y la recomendación se mantiene completada.

## Continúa con otra tarea

- [Medir enlaces de inscripción](/ayuda/negocio/origenes/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#referidos). Revisión del 17 de noviembre de 2026.
