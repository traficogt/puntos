---
title: Seguir una importación grande por lotes
description: Comprueba el progreso y los conflictos de un archivo procesado en segundo
  plano.
reviewed: '2026-11-16'
kind: task
sources:
- web/merchant/src/CustomerMigration.jsx
- web/merchant/src/ImportJobs.jsx
owner_route: importar-clientes
---

# Seguir una importación grande por lotes

Comprueba el progreso y los conflictos de un archivo procesado en segundo plano. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#importar-clientes)

## Antes de empezar

Prepara el CSV y la revisión de saldos. Este flujo admite hasta 5,000 clientes; cada lote de cien filas se confirma por separado.

## Paso a paso

1. En **Importar clientes**, marca **Procesar un archivo grande en segundo plano (hasta 5,000 clientes)**.
2. Carga y revisa el archivo y la conversión si corresponde. Confirma la importación únicamente después de revisar los totales.
3. Ve a **Importaciones en segundo plano** y pulsa **Actualizar estado**.
4. Revisa el avance, errores y acciones que ofrece el trabajo antes de continuar o cancelar.
5. Consulta los lotes guardados para comprobar cuántos clientes ya quedaron importados.

## Qué debe pasar

El progreso confirmado se conserva. Cancelar o encontrar un conflicto no deshace los lotes que ya se guardaron. El archivo pendiente vence a los siete días y se elimina al finalizar.

## Si algo no funciona

**Trabajo detenido o con conflicto:** revisa su detalle; no cargues el mismo archivo como una importación nueva sin comprobar lo ya guardado. **Cancelaste a mitad:** los clientes importados conservan sus puntos. **Archivo vencido:** prepara una nueva revisión que tenga en cuenta los registros existentes.

## Continúa con otra tarea

- [Preparar una importación](/ayuda/negocio/importar-clientes/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#importar-clientes). Revisión del 16 de noviembre de 2026.
