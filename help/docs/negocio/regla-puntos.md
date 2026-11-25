---
title: Guardar la regla base de puntos
description: Define si una compra suma puntos por importe, por visita o por artículo.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/Launch.jsx
- web/merchant/src/LaunchProgramEditor.jsx
- web/merchant/src/launch-model.js
- src/app/services/transaction-rule-evidence.js
owner_route: preparar
---

# Guardar la regla base de puntos

Define si una compra suma puntos por importe, por visita o por artículo. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#preparar)

## Antes de empezar

Ingresa como dueño y revisa primero la moneda del negocio. Ten claro qué dato registrará el equipo en cada compra.

## Paso a paso

1. En **Preparar mi programa**, abre **1. Puntos**.
2. En **Cómo funciona tu programa**, elige **Puntos por importe de compra**, **Puntos por visita** o **Puntos por artículo**. La misma lista ofrece programas sin puntos (descuento fijo para miembros, cashback, tarjeta de regalo o monedero recargable y tarjeta de sellos); esta guía cubre los programas de puntos.
3. Escribe **Puntos por** la unidad elegida: un valor mayor que cero y hasta 10,000. Para importe puedes usar hasta cuatro decimales; visitas y artículos usan puntos enteros.
4. Si eliges importe, revisa **Redondeo de puntos**. Prueba una **Compra de ejemplo**, **Visitas de ejemplo** o **Artículos de ejemplo**.
5. Pulsa **Guardar regla de puntos**. Espera **Regla guardada** y comunica el cambio al equipo.

## Qué debe pasar

La regla guardada se usa para compras futuras, respetando los ciclos protegidos aplicables. El ejemplo muestra puntos base; bonos, límites y liberación pueden cambiar el resultado final.

PF no asume una tasa por defecto. Hasta que guardes la regla, el escáner rechaza registrar compras con el aviso **Configura la regla de puntos de tu programa antes de registrar compras.** Si eliges otro tipo de programa, el botón cambia a **Guardar descuento**, **Guardar cashback**, **Guardar tarjeta de regalo** o **Guardar tarjeta de sellos** y guarda esa configuración en lugar de una tasa de puntos.

## Si algo no funciona

**Guardar está desactivado:** comprueba que hayas cambiado un valor válido. **Otra sesión cambió la regla:** usa **Recargar configuración** y revisa la versión actual. **Quieres límites o liberación:** abre **Límites y configuración avanzada** o la pantalla [Límites y políticas](/ayuda/negocio/limites/); no interpretes la vista previa como saldo inmediatamente disponible.

## Continúa con otra tarea

- [Reglas adicionales de puntos](/ayuda/negocio/reglas-adicionales/)
- [Proteger condiciones anteriores](/ayuda/negocio/promesas/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#preparar). Revisión del 25 de noviembre de 2026.
