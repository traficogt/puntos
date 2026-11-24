---
title: Importar clientes y saldos anteriores
description: Revisa el archivo, duplicados y totales antes de guardar saldos iniciales.
reviewed: '2026-11-16'
kind: task
sources:
- web/merchant/src/CustomerMigration.jsx
- web/merchant/src/migration-model.js
owner_route: importar-clientes
---

# Importar clientes y saldos anteriores

Revisa el archivo, duplicados y totales antes de guardar saldos iniciales. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#importar-clientes)

## Antes de empezar

Ingresa como dueño. Usa un archivo autorizado del programa anterior; importar no suscribe a nadie a promociones ni permite entrar sin verificar el teléfono.

## Paso a paso

1. Abre **Importar clientes** y usa **Descargar plantilla CSV**.
2. Elige **Origen de los saldos**. Si conviertes sellos o progreso, documenta **Registro de origen**, **Evidencia revisada por el dueño** y la equivalencia aprobada.
3. Carga **Archivo de clientes (CSV)** y relaciona las columnas. Decide qué hacer si el teléfono ya existe.
4. Pulsa **Revisar lote**. Corrige errores y revisa clientes nuevos, existentes, omitidos y puntos iniciales.
5. Escribe **Nombre del lote**, confirma que revisaste la información y pulsa **Confirmar importación**.
6. Consulta **Importaciones guardadas** para verificar lo que realmente se creó.

## Qué debe pasar

Los clientes nuevos reciben los saldos iniciales confirmados; cuentan como disponibles y en el acumulado. La importación no registra compras ni visitas ni reemplaza saldos existentes.

## Tamaño del archivo

El flujo normal admite hasta 200 clientes y 200 KB en una sola confirmación. Para un archivo mayor, usa la opción de segundo plano (hasta 5,000 clientes por archivo) y revisa sus límites antes de cargarlo.

## Si algo no funciona

**CSV inválido:** usa encabezados y coma o punto y coma; el teléfono es obligatorio. **Hay duplicados o errores:** corrige el archivo o la opción para existentes y vuelve a revisar antes de confirmar. **No hay columna de saldo:** los clientes comienzan con cero puntos.

## Continúa con otra tarea

- [Importación grande por lotes](/ayuda/negocio/importacion-grande/)
- [Consultar el directorio](/ayuda/negocio/clientes/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#importar-clientes). Revisión del 16 de noviembre de 2026.
