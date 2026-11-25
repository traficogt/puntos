---
title: Leer la analítica avanzada y exportar el CSV de IVA
description: Recorre el resumen ejecutivo, los segmentos RFM, la tendencia, las
  sucursales, las cohortes y los clientes en riesgo, y descarga la facturación local para
  tu contador.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/OwnerAnalytics.tsx
- web/merchant/src/owner-analytics-model.ts
- src/app/routes/analytics/dashboard.js
- src/app/routes/analytics/churn.js
- src/app/routes/analytics/cohorts.js
- src/app/routes/admin/insights.js
- src/app/routes/admin/billing.js
owner_route: analitica
---

# Leer la analítica avanzada y exportar el CSV de IVA

Recorre el resumen ejecutivo, los segmentos RFM, la tendencia, las sucursales, las cohortes y los clientes en riesgo, y descarga la facturación local para tu contador. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#analitica)

## Antes de empezar

Ingresa con la cuenta del dueño; la pantalla requiere un plan con análisis avanzado. **Analítica avanzada** está en el grupo **Avanzado** y también en el enlace **Informes detallados** del menú; pulsa **Ver todas las herramientas** si no la ves. Lo que muestra son compras, clientes y canjes registrados en PuntosFieles: no el total de ventas del negocio ni ingresos causados por el programa.

## Paso a paso

1. Abre **Analítica avanzada**. Si tienes varias sucursales, elige **Sucursal** o deja la opción del negocio completo. **Actualizar** vuelve a consultar.
2. Lee **Resumen ejecutivo**: la narrativa de los últimos 30 días, los indicadores (**Clientes activos**, **Compras**, **Ticket promedio**, canjes) y las **Sugerencias** con sus **Acciones**, que abren **Recuperar clientes**, **Notificaciones automáticas** o **Canjes por recompensa**.
3. En **Segmentos RFM**, revisa cuántos clientes hay en **Campeones**, **Leales**, **En riesgo** y **Perdidos** y su **Participación**; la lista debajo repite los datos del gráfico.
4. En **Tendencia de ventas registradas (30 días)**, usa **Ver los datos del gráfico** para la tabla de **Compras, clientes y ventas registradas por fecha**.
5. En **Rendimiento por sucursal (30 días)**, pulsa **Filtrar** en una fila para ver esa sucursal; aparece **Sucursal frente al negocio**, que compara sus días con el total. **Quitar filtro** vuelve al negocio completo.
6. Lee **Cohortes de retención** (un guion marca meses que todavía no empiezan; el mes en curso es parcial) y **Clientes en riesgo de pérdida**, con **Días sin visitar**, **Gasto registrado** y **Puntaje**. **Preparar una lista de regreso** abre **Recuperar clientes**.
7. En el comparativo, elige la **Ventana** de 30, 60 o 90 días para contrastar el periodo con el anterior.
8. En **Facturación local (IVA 12 %)**, elige **Desde** y **Hasta** y pulsa **Descargar CSV IVA**. El archivo trae, por día, transacciones, monto bruto, base sin IVA e IVA al 12 %.
9. Consulta **Qué significan estos números** antes de compartir una cifra.

## Qué debe pasar

Toda la pantalla es de solo lectura; descargar el CSV no modifica nada. La tasa que acompaña a los canjes se expresa como canjes por cada 100 compras: PuntosFieles no calcula rentabilidad ni retorno del programa. El CSV de IVA usa los precios registrados como precios con IVA incluido y separa la base y el impuesto redondeando una vez al centavo, de modo que las tres columnas de cada fila suman exactamente; la fecha se escribe como año-mes-día.

## Si algo no funciona

**No hay datos RFM todavía / No hay actividad reciente para graficar:** el negocio aún no registra compras suficientes en 30 días; la pantalla no inventa valores. **Ningún cliente supera el umbral de riesgo en esta vista:** no hay clientes inactivos según la regla actual. **No pudimos cargar las sucursales:** la analítica muestra todas las sucursales; vuelve a intentarlo. **Las cifras difieren de Reportes:** **Reportes básicos** usa el período que elijas allí; aquí la ventana es de 30 días salvo en el comparativo. Si sospechas que faltan compras recientes, pide un recálculo en **Trabajos en segundo plano**.

## Continúa con otra tarea

- [Leer el reporte básico y la capacidad del plan](/ayuda/negocio/reportes/)
- [Guardar una lista de clientes para seguimiento](/ayuda/negocio/recuperar-clientes/)
- [Revisar trabajos en segundo plano y recalcular la analítica](/ayuda/negocio/trabajos/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#analitica). Revisión del 25 de noviembre de 2026.
