---
title: Preparar mensajes de una campaña
description: Comprueba quién tiene permiso para recibir promociones y revisa el resultado
  de cada envío.
reviewed: '2026-11-16'
kind: task
sources:
- web/merchant/src/GrowthCampaigns.jsx
- web/merchant/src/BulkCampaignPreparation.jsx
owner_route: ofertas
---

# Preparar mensajes de una campaña

Comprueba quién tiene permiso para recibir promociones y revisa el resultado de cada envío. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#ofertas)

## Antes de empezar

Abre una campaña guardada. Activar el bono y preparar su mensaje son acciones separadas. El canal debe estar configurado y el cliente debe tener consentimiento promocional.

## Paso a paso

1. En **Campañas dirigidas**, abre la campaña correspondiente.
2. Ve a **Mensajes de la campaña** y revisa los destinatarios elegibles y el estado actual.
3. Revisa la vista previa y marca **Confirmo el envío de esta oferta** al número de clientes elegibles indicado. Pulsa **Poner mensajes en cola**; revisa cualquier aviso de envío en espera.
4. Pulsa **Actualizar estados** para consultar el resultado.
5. Antes de reenviar por otra vía, distingue aceptado por proveedor, fallo confirmado y resultado incierto.

## Qué debe pasar

Los mensajes siguen su propio estado. “Aceptado por el proveedor” no acredita recepción ni lectura, y un mensaje fallido no implica que el bono de la campaña haya sido cancelado.

## Si algo no funciona

**No hay destinatarios:** puede faltar consentimiento, teléfono o elegibilidad. **Envío en espera:** revisa horario, frecuencia y estado de los datos. **Resultado incierto:** no se reintenta automáticamente para evitar duplicados; verifica primero lo ocurrido con el proveedor o soporte.

## Continúa con otra tarea

- [Automatizaciones y consentimiento](/ayuda/negocio/automatizaciones/)
- [Estado de la operación](/ayuda/negocio/estado-operacion/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#ofertas). Revisión del 16 de noviembre de 2026.
