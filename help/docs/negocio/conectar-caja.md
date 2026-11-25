---
title: Preparar la conexión de tu caja
description: Comprueba cómo identifica clientes y comparte ventas tu POS antes de
  habilitarlo.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/PosConnect.jsx
- web/merchant/src/PosAdvanced.tsx
- web/merchant/src/PosInstallation.jsx
- web/merchant/src/pos-installation-model.js
- src/app/routes/admin/pos-routes.js
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
6. Debajo del formulario están las herramientas del método elegido. Con Loyverse, en **Cuenta de Loyverse** pega el **Token de acceso de Loyverse** (y el **ID de la tienda en Loyverse** si aplica) y pulsa **Guardar y verificar cuenta**; después **Revisar recibos de Loyverse** muestra las ventas listas y **Sincronizar ventas revisadas** asigna sus puntos tras confirmar.
7. Con CSV, en **Archivo de ventas (CSV)** elige el **Archivo CSV de ventas** (hasta 100 ventas, 200 KB), escribe el **Origen de las ventas**, relaciona **ID de la venta**, **Teléfono del cliente** e **Importe pagado** con las columnas del archivo, indica la **Unidad del importe** y, si no hay columna de estado, marca **Todas las ventas del archivo están pagadas**. **Revisar ventas** muestra la vista previa; **Importar ventas revisadas** asigna los puntos tras confirmar.
8. Con API, en **Integración por API** copia la **Dirección para enviar ventas** y pulsa **Generar clave API**. La clave completa se muestra una sola vez; cópiala en ese momento. Generar una nueva desactiva la anterior.

## Qué debe pasar

La muestra comprueba los datos sin asignar puntos. Habilitar y guardar permite al método procesar ventas válidas; no demuestra que el proveedor haya terminado la integración. Las vistas previas de Loyverse y CSV tampoco asignan puntos: solo **Sincronizar ventas revisadas** e **Importar ventas revisadas** lo hacen, y ambos piden confirmación. Esas acciones y **Generar clave API** requieren la conexión habilitada y guardada en el mismo método; con cambios sin guardar quedan desactivadas.

## Si algo no funciona

**Cliente no encontrado:** corrige el teléfono en el origen. **Venta repetida:** conserva origen e ID al reintentar, no crees otro ID para el mismo recibo. **Otra moneda o venta no pagada:** corrige la fuente; no adaptes el importe a mano para forzarla. **Habilita y guarda la conexión en modo…:** las herramientas del método solo funcionan con la conexión guardada en ese modo. **Agrega un token de lectura de Loyverse:** Loyverse requiere el token para verificar la cuenta antes de habilitarla. **No se encontraron encabezados:** el archivo CSV debe traer una fila de títulos. Las claves y los permisos de lectura se gestionan desde la cuenta del dueño; el equipo de caja no necesita verlos.

## Continúa con otra tarea

- [Revisar devoluciones](/ayuda/negocio/devoluciones/)
- [Permitir canjes desde caja](/ayuda/negocio/canjes-pos/)
- [Medir cobertura de datos](/ayuda/negocio/estado-operacion/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#conectar-caja). Revisión del 25 de noviembre de 2026.
