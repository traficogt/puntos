---
title: Registrar costos y leer las estimaciones
description: Separa el costo conocido de los premios de los escenarios basados en
  tus supuestos.
reviewed: '2026-11-16'
kind: task
sources:
- web/merchant/src/Economics.jsx
- web/merchant/src/CommitmentScenarios.jsx
owner_route: costos
---

# Registrar costos y leer las estimaciones

Separa el costo conocido de los premios de los escenarios basados en tus supuestos. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#costos)

## Antes de empezar

Ten el costo por unidad entregada, distinto del precio de venta. No registres cero para representar un dato que desconoces.

## Paso a paso

1. Abre **Costos y margen**. Elige **Período de ventas y canjes** y pulsa **Actualizar**.
2. En **Costos para futuros canjes**, usa **Editar costo** por recompensa y guarda el costo unitario conocido.
3. Revisa **Cobertura de costos**: cuántos canjes tienen costo registrado al completarse.
4. Para escenarios, usa **Editar supuestos** y revisa margen bruto y costo por punto. Distingue los puntos disponibles de los pendientes.
5. Consulta **Beneficios emitidos pendientes** sin sumar todas las alternativas de un ciclo como premios independientes.

## Qué debe pasar

Los nuevos costos se usan para futuros canjes. Los históricos desconocidos siguen desconocidos; las estimaciones no son utilidad neta, obligación contable ni efecto causado por el programa.

## Explorar antes de configurar

La [calculadora pública de PF](/calculadora) permite revisar un escenario con tus propios datos. Sus resultados son estimaciones, no una promesa comercial ni una medición de ventas adicionales.

## Si algo no funciona

**Faltan costos históricos:** guardar un costo hoy no completa esos canjes. **No aparece margen estimado:** puede faltar el supuesto o cobertura de costos. **Puntos restituidos:** ya forman parte del saldo cuando siguen disponibles; no los sumes otra vez. Los aportes de proveedores se concilian aparte.

## Continúa con otra tarea

- [Aportes de proveedores](/ayuda/negocio/proveedores/)
- [Resultados de una campaña](/ayuda/negocio/resultados-campana/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#costos). Revisión del 16 de noviembre de 2026.
