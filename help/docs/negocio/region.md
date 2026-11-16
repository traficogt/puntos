---
title: Revisar moneda, horario y ubicaciones de Wallet
description: Define la región antes de registrar operaciones y revisa las ubicaciones
  públicas de tus sucursales.
reviewed: '2026-11-16'
kind: task
sources:
- web/merchant/src/RegionSettings.jsx
- web/merchant/src/region.js
owner_route: region
---

# Revisar moneda, horario y ubicaciones de Wallet

Define la región antes de registrar operaciones y revisa las ubicaciones públicas de tus sucursales. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#region)

## Antes de empezar

Ingresa como dueño. Decide la moneda real de las operaciones: PF no convierte divisas ni reescribe importes anteriores.

## Paso a paso

1. Abre **Región del negocio**. Revisa **País**, **Moneda de operación** y **Zona horaria**.
2. Confirma la casilla de moneda solo si corresponde a tu negocio y pulsa **Guardar región**.
3. Para una ubicación de Wallet, elige **Sucursal** y escribe su **Latitud** y **Longitud** exactas.
4. Marca **Usar esta ubicación en las tarjetas de Wallet** si deseas compartir esas coordenadas públicas con Apple y Google.
5. Pulsa **Guardar ubicación**. Repite únicamente para sucursales reales que quieras publicar, hasta el límite indicado.

## Qué debe pasar

Las reglas y comunicaciones usan el horario del negocio. Las coordenadas pueden ayudar a mostrar una tarjeta por cercanía, pero Apple y Google deciden cuándo y dependen de permisos del cliente.

## Si algo no funciona

**Moneda protegida:** ya existen movimientos o costos; cambiar el país no convierte el dinero. Pide revisión antes de continuar con importes incorrectos. **Coordenadas rechazadas:** usa latitud de −90 a 90 y longitud de −180 a 180, con hasta seis decimales. PF no recibe la ubicación del cliente por esta función.

## Continúa con otra tarea

- [Conectar una caja](/ayuda/negocio/conectar-caja/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#region). Revisión del 16 de noviembre de 2026.
