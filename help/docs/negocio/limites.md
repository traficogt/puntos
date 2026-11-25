---
title: Ajustar límites, alertas, vencimiento y políticas
description: Define topes por transacción, alertas de sospecha, liberación y vencimiento
  de puntos, límites de canje y la política de reembolsos.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/OwnerProgramLimits.tsx
- src/app/routes/admin/program-config-routes.js
- src/app/routes/admin/fraud.js
owner_route: limites
---

# Ajustar límites, alertas, vencimiento y políticas

Define topes por transacción, alertas de sospecha, liberación y vencimiento de puntos, límites de canje y la política de reembolsos. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#limites)

## Antes de empezar

Ingresa con la cuenta del dueño; la pantalla requiere que el plan incluya las reglas del programa. Estas salvaguardas complementan la regla de puntos, que se edita en **Preparar mi programa**. En los campos numéricos, **0** significa sin límite o alerta desactivada, salvo que la descripción del campo indique otra cosa.

## Paso a paso

1. Abre **Límites y políticas** en el grupo **Mi programa**.
2. En **Límites por transacción**, revisa **Monto máximo por transacción**, **Puntos máximos por transacción**, **Visitas máximas por transacción** y **Artículos máximos por transacción**. Protegen contra errores de captura.
3. En **Alertas de sospecha**, define **Marcar si los puntos son al menos** y **Marcar si el monto es al menos**. Las compras que alcancen esos valores se marcan para revisión; no se bloquean ni se revierten.
4. Ajusta **Puntos pendientes y vencimiento** (**Días para liberar puntos** y **Días para vencer puntos**), **Canjes: límites y enfriamiento** (**Canjes máximos por cliente al día**, **Canjes máximos del mismo premio al día** y **Enfriamiento del mismo premio (horas)**) y la **Política de saldo** con la casilla **Permitir saldo negativo al reembolsar compras ya consumidas**. Si tu plan incluye niveles, en **Política de niveles** elige **Acumulado histórico** o **Ventana móvil**, con **Días de la ventana** (al menos 30) y **Días de gracia antes de bajar de nivel**.
5. Lee el **Resumen** al pie del formulario y pulsa **Guardar límites y políticas**. **Descartar cambios** vuelve a lo guardado.

## Qué debe pasar

Aparece **Límites y políticas guardados. Se aplican a las próximas compras y canjes.** Guardar conserva la regla de puntos, las reglas de campaña, las automatizaciones y las integraciones de caja ya configuradas: la pantalla reenvía la configuración completa con tus nuevos valores.

Si tu plan incluye el monitoreo de fraude, la sección **Transacciones marcadas** lista las compras que alcanzaron una alerta, con fecha, sucursal, quién la registró, cliente, puntos, monto y motivos; **Actualizar** vuelve a consultarla. Allí no se revierte nada: revisa el caso con tu equipo y usa Movimientos para explicar o corregir la operación.

## Si algo no funciona

**Un valor se rechaza:** los límites usan números enteros de 0 o más y los montos aceptan los decimales de la moneda; la ventana móvil necesita al menos 30 días. **Guardar está desactivado:** no has cambiado ningún valor. **La política de niveles no aparece:** tu plan no incluye niveles. **Un reembolso quedó bloqueado:** con la casilla de saldo negativo apagada, PF bloquea el reembolso que dejaría al cliente en negativo; decide si activarla antes de repetirlo.

## Continúa con otra tarea

- [Guardar la regla base de puntos](/ayuda/negocio/regla-puntos/)
- [Crear niveles de cliente con multiplicador](/ayuda/negocio/niveles/)
- [Buscar y explicar un movimiento](/ayuda/negocio/movimientos/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#limites). Revisión del 25 de noviembre de 2026.
