---
title: Preparar la conexión de tu caja
description: Comprueba cómo identifica clientes y comparte ventas tu POS antes de
  habilitarlo.
reviewed: '2026-11-17'
kind: task
sources:
- web/merchant/src/PosConnect.jsx
- web/merchant/src/PosInstallation.jsx
- web/merchant/src/pos-installation-model.js
- public/admin-dashboard/fragments/pos-integration.html
- public/admin-dashboard/modules/pos-integration.js
owner_route: conectar-caja
---

# Preparar la conexión de tu caja

Comprueba cómo identifica clientes y comparte ventas tu POS antes de habilitarlo. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#conectar-caja)

## Antes de empezar

Necesitas saber el sistema de caja, su versión y qué acceso permite el proveedor. Puedes continuar con el escáner mientras preparas la conexión.

## Paso a paso

1. Abre **Conectar caja** y elige **Sistema de caja** y **Cómo comparte ventas**.
2. Lee los requisitos y prepara **Paquete para el instalador** con los datos del sistema.
3. En **Prueba una venta sin asignar puntos**, introduce ID, origen, teléfono, importe, artículos y estado del recibo. Pulsa **Comprobar muestra**.
4. Verifica que el teléfono sea el mismo de la cuenta PF. Nombre, correo, NIT o ID del POS no lo sustituyen.
5. En **Configura la conexión**, revisa el método y **Habilitar esta conexión para recibir o importar ventas**. Actívalo y pulsa **Guardar conexión** solo cuando corresponda comenzar a procesar ventas.

## Qué debe pasar

La muestra comprueba los datos sin asignar puntos. Habilitar y guardar permite al método procesar ventas válidas; no demuestra que el proveedor haya terminado la integración.

## Si algo no funciona

**Cliente no encontrado:** corrige el teléfono en el origen. Con Loyverse, PF vuelve a consultar esas ventas con esperas crecientes durante un máximo de 20 intentos o 7 días. Las que siguen sin resolverse y los recibos con datos inválidos pasan a **Recibos para revisar**, en la sección de Loyverse de administración: ábrela con **Verificar cuenta y revisar recibos de Loyverse**. **Venta sin cliente:** un recibo de Loyverse sin cliente asociado no suma puntos ni se reintenta; no es un error de la conexión. **Venta repetida:** conserva origen e ID al reintentar, no crees otro ID para el mismo recibo. **Otra moneda o venta no pagada:** corrige la fuente; no adaptes el importe a mano para forzarla. Claves e instrucciones del proveedor se gestionan en administración con el dueño.

## Continúa con otra tarea

- [Revisar devoluciones](/ayuda/negocio/devoluciones/)
- [Permitir canjes desde caja](/ayuda/negocio/canjes-pos/)
- [Medir cobertura de datos](/ayuda/negocio/estado-operacion/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#conectar-caja). Revisión del 17 de noviembre de 2026.
