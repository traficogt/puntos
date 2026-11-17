---
title: Revisar pendientes y datos atrasados
description: Consulta qué necesita atención en tu negocio y abre la pantalla donde
  puedes resolverlo.
reviewed: '2026-11-17'
kind: task
sources:
- web/merchant/src/Operations.jsx
- web/merchant/src/DataHealth.jsx
owner_route: operacion
---

# Revisar pendientes y datos atrasados

Consulta qué necesita atención en tu negocio y abre la pantalla donde puedes resolverlo. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#operacion)

## Antes de empezar

Ingresa al panel del negocio. Este estado operativo es distinto del estado público del servicio: revisa tus registros, configuraciones y conexiones.

## Paso a paso

1. Abre **Estado de la operación** y pulsa **Actualizar estado**.
2. Revisa **Qué revisar primero** y abre la tarea indicada: devoluciones, importaciones, mensajes, costos o alta de clientes.
3. En cada área, usa **Ver registros** para entender la evidencia y la última actividad.
4. En **¿Los datos están al día?**, abre **Configurar conexiones y plazos** si trabajas con un integrador.
5. Revisa **Nombre de la conexión**, **Código de origen**, **Sucursal** y **Plazo máximo entre ventanas completas (minutos)** con el integrador. Define **Vigilar esta conexión** y pulsa **Guardar seguimiento**.

## Qué debe pasar

Cuando una conexión monitoreada supera su plazo, PF pausa recomendaciones y mensajes que dependen de ausencia de compras. Esto evita interpretar datos atrasados como clientes inactivos.

## Revisar el servicio público

[Consulta el estado del servicio](/estado) si no puedes abrir las pantallas o varias personas tienen el mismo problema.

## Si algo no funciona

**“Configurado” aparece en Wallet o mensajes:** solo confirma configuración o registros locales; no recepción, instalación ni conexión completa. **Confirmación de la integración:** no prueba ventas que nunca llegaron. **Desactivas seguimiento:** retiras esa protección, aunque no borres registros. **No se guarda el seguimiento:** cada plazo debe ser un número entero de 5 a 10080 minutos. Si otra sesión cambió la configuración, tus cambios siguen en el formulario: revísalos y pulsa de nuevo **Guardar seguimiento**. Para una caída general, consulta el estado público.

## Continúa con otra tarea

- [Revisar una integración de caja](/ayuda/negocio/conectar-caja/)
- [Pedir ayuda técnica](/ayuda/problemas/pedir-ayuda/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#operacion). Revisión del 17 de noviembre de 2026.
