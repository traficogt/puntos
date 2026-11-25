---
title: Configurar cumpleaños y recuperación automática
description: Revisa incentivo, consentimiento, presupuesto y horario antes de activar
  una regla automática.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/Automations.jsx
- web/merchant/src/AutomationTemplates.tsx
- src/app/services/automation-controls-service.js
owner_route: automatizaciones
---

# Configurar cumpleaños y recuperación automática

Revisa incentivo, consentimiento, presupuesto y horario antes de activar una regla automática. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#automatizaciones)

## Antes de empezar

Necesitas tener configurada la mensajería y conocer el costo de los puntos que ofrecerás. Solo se consideran clientes que aceptaron promociones y tienen teléfono disponible.

## Paso a paso

1. Abre **Notificaciones automáticas** y busca **Cumpleaños y recuperación**.
2. Si quieres partir de una configuración conocida, en **Plantillas** pulsa **Cargar en el formulario** en **Cafetería básico**, **Reactivación fuerte** o **Solo alertas**. La plantilla solo rellena el formulario; nada se guarda hasta que revises los presupuestos y pulses **Guardar y aplicar**.
3. Revisa **Activar cumpleaños** o **Activar recuperación**. Define los puntos y el presupuesto mensual de cada regla.
4. Para recuperación, configura **Días sin actividad**. Compras y canjes cuentan como actividad; la regla no recupera días anteriores.
5. En **Alerta diaria de compras sospechosas**, decide si quieres **Enviar un resumen diario al dueño** y desde cuántas compras marcadas (**Avisar a partir de**). Este aviso no se envía a clientes.
6. Revisa **Preparar incentivos a partir de** y **Días mínimos entre mensajes**. Pulsa **Guardar y aplicar**.
7. Consulta **Hoy, con la configuración guardada** y **Ejecuciones y mensajes** para entender los candidatos y resultados.

## Qué debe pasar

Las reglas activadas preparan incentivos dentro del presupuesto. Los puntos se abonan al preparar el incentivo, aunque el mensaje falle o no se entregue.

## Presupuesto y horario

El presupuesto se renueva al empezar el mes en la zona del negocio. Reembolsos y bajas no lo reponen. Los envíos respetan la ventana que indica la interfaz; los mensajes de estas reglas vencen a las 48 horas si no se pueden enviar.

## Si algo no funciona

**No se envía:** revisa consentimiento, teléfono, fecha, presupuesto, horario y frecuencia compartida con campañas. **Pausas una regla:** cancela mensajes en cola, pero no retira uno ya aceptado ni revierte puntos abonados. **Resultado incierto:** comprueba el proveedor antes de decidir otro envío.

## Continúa con otra tarea

- [Invitación a la segunda visita](/ayuda/negocio/segunda-visita/)
- [Resumen semanal por correo](/ayuda/negocio/resumen-semanal/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#automatizaciones). Revisión del 25 de noviembre de 2026.
