---
title: Revisar trabajos en segundo plano y recalcular la analítica
description: Consulta el estado de los trabajos que PuntosFieles ejecuta por ti y pide un
  recálculo de la analítica cuando los indicadores parezcan atrasados.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/OwnerJobs.tsx
- web/merchant/src/owner-operations-model.ts
- src/app/routes/analytics/jobs.js
owner_route: trabajos
---

# Revisar trabajos en segundo plano y recalcular la analítica

Consulta el estado de los trabajos que PuntosFieles ejecuta por ti y pide un recálculo de la analítica cuando los indicadores parezcan atrasados. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#trabajos)

## Antes de empezar

Ingresa con la cuenta del dueño; la pantalla requiere un plan con análisis avanzado. **Trabajos en segundo plano** está en el grupo **Avanzado**; pulsa **Ver todas las herramientas** si el menú no lo muestra. Un trabajo es una tarea que el servidor ejecuta sin que esperes en pantalla: el recálculo de analítica, la importación de ventas y otros procesos del negocio.

## Paso a paso

1. Abre **Trabajos en segundo plano**. La tabla **Trabajos recientes en segundo plano** muestra los últimos trabajos con su tipo (por ejemplo **Recálculo de analítica** o **Importación de ventas**), estado y fechas.
2. Pulsa **Actualizar** para volver a consultar la lista.
3. Si los indicadores de **Inicio** o **Analítica avanzada** no reflejan compras recientes, pulsa **Recalcular analítica**.
4. Lee la confirmación: explica que se encolará un recálculo que puede tardar unos segundos. Aceptar lo pone en cola; cancelar no hace nada.
5. Espera el mensaje **Recálculo en cola. Esperando al trabajo…** y después **Analítica recalculada. Los indicadores ya reflejan los datos actuales.** La pantalla consulta el trabajo hasta que termina.
6. Usa **Ver alertas** para revisar avisos de trabajos fallidos o **Estado de la operación** para el panorama general.

## Qué debe pasar

Recalcular no cambia compras, puntos ni clientes: vuelve a resumir los datos ya registrados para la analítica. Un trabajo pasa de en cola a en proceso y a terminado o fallido; la tabla conserva los más recientes. Pedir varios recálculos seguidos no acelera el resultado.

## Si algo no funciona

**El recálculo no termina:** pulsa **Actualizar**; si el trabajo aparece fallido, revisa **Alertas y pagos pendientes** y vuelve a intentarlo más tarde. **La tabla está vacía:** aún no se ha ejecutado ningún trabajo para este negocio. **Los indicadores siguen distintos a lo esperado:** comprueba el período y la sucursal elegidos en la pantalla de analítica; el recálculo no agrega compras que nunca se registraron en PuntosFieles.

## Continúa con otra tarea

- [Revisar alertas y asignar pagos sin cliente](/ayuda/negocio/alertas/)
- [Leer la analítica avanzada y exportar el CSV de IVA](/ayuda/negocio/analitica/)
- [Revisar pendientes y datos atrasados](/ayuda/negocio/estado-operacion/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#trabajos). Revisión del 25 de noviembre de 2026.
