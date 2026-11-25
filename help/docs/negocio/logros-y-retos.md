---
title: Crear un logro o un reto temporal
description: Premia hábitos con logros automáticos y mueve visitas con retos de tiempo
  limitado, recurrentes o de meta acumulada.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/OwnerGamification.tsx
- src/app/routes/gamification-admin-routes.js
- src/app/routes/gamification-support.js
- src/app/services/staff-award-hooks.js
owner_route: logros-y-retos
---

# Crear un logro o un reto temporal

Premia hábitos con logros automáticos y mueve visitas con retos de tiempo limitado, recurrentes o de meta acumulada. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#logros-y-retos)

## Antes de empezar

Ingresa con la cuenta del dueño; la pantalla requiere que el plan incluya logros y retos. Ten claro qué hábito quieres premiar, con qué cantidad y cuántos puntos extra ofrecerás. Los puntos de un logro o reto se suman al saldo del cliente, así que considera su costo como el de cualquier bono.

## Paso a paso

1. Abre **Logros y retos** en el grupo **Mi programa**.
2. En **Logros**, pulsa **Agregar logro**. Completa **Nombre**, **Descripción (opcional)**, **Icono (emoji, opcional)**, el **Tipo de requisito** (**Visitas**, **Gasto total (moneda del negocio)**, **Puntos acumulados**, **Artículos comprados**, **Referidos** o **Racha de días**), el **Valor requerido** y los **Puntos de recompensa**; 0 otorga el logro sin puntos adicionales. Pulsa **Crear logro**.
3. En la tabla de logros, usa **Desactivar** o **Activar** para pausar o reanudar uno, y **Eliminar** para quitarlo.
4. En **Retos**, pulsa **Agregar reto**. Elige **Tipo de reto** (**Tiempo limitado**, **Recurrente** o **Meta acumulada**), el **Requisito** y la **Cantidad requerida**, los **Puntos de recompensa**, el **Inicio** y, si aplica, el **Fin (opcional)**, la **Recurrencia (para retos recurrentes)** y el **Máximo de cumplimientos por cliente (opcional)**. Pulsa **Crear reto**.
5. Revisa la lista de retos: requisito, recompensa y vigencia. Un reto solo puede eliminarse desde aquí; para cambiar sus condiciones, elimínalo y crea otro.

## Qué debe pasar

Los logros se otorgan automáticamente cuando el cliente cumple el requisito: PF los revisa al registrar una compra con puntos y al inscribirse una persona. Si el logro tiene puntos, se acreditan como una bonificación por logro que el cliente ve en el historial de su tarjeta. Un logro desactivado deja de otorgarse, pero conserva los que ya se concedieron.

La lista de retos muestra solo los vigentes: activos, ya iniciados y sin fecha de fin vencida. Un reto que empieza más adelante aparece cuando llega su inicio; la pantalla lo recuerda al crearlo. Las fechas se escriben en la zona horaria de tu dispositivo, que la pantalla indica junto al campo **Inicio**.

## Si algo no funciona

**Un valor se rechaza:** el nombre admite hasta 100 caracteres, la descripción hasta 500, la cantidad requerida es un entero de 1 o más y los puntos un entero de 0 o más; el fin debe ser posterior al inicio y el máximo de cumplimientos va de 1 a 1000. **Un reto creado no aparece:** todavía no empezó o ya venció; solo se listan los vigentes. **Un cliente no recibió el logro:** el requisito se evalúa con la actividad registrada en PF al momento de la compra o la inscripción; una compra sincronizada después cuenta cuando se registra.

## Continúa con otra tarea

- [Crear niveles de cliente con multiplicador](/ayuda/negocio/niveles/)
- [Registrar costos y leer las estimaciones](/ayuda/negocio/costos/)
- [Consultar puntos disponibles y pendientes](/ayuda/clientes/puntos/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#logros-y-retos). Revisión del 25 de noviembre de 2026.
