---
title: Crear niveles de cliente con multiplicador
description: Define umbrales de puntos, multiplicadores y beneficios por nivel, y revisa
  cuántos clientes hay en cada uno.
reviewed: '2026-11-25'
kind: task
sources:
- web/merchant/src/OwnerTiers.tsx
- web/merchant/src/OwnerProgramLimits.tsx
- src/app/routes/tier-routes.js
- src/app/services/tier-service.js
owner_route: niveles
---

# Crear niveles de cliente con multiplicador

Define umbrales de puntos, multiplicadores y beneficios por nivel, y revisa cuántos clientes hay en cada uno. (PuntosFieles, 2026).

[Abrir la pantalla de esta tarea](/negocio/#niveles)

## Antes de empezar

Ingresa con la cuenta del dueño y comprueba que tu plan incluye niveles; si no, la pantalla indica que la función no está en el plan actual. Decide cuántos niveles necesitas y los puntos mínimos de cada uno. El orden de un nivel no se puede cambiar después de crearlo.

## Paso a paso

1. Abre **Niveles de cliente** en el grupo **Mi programa** y pulsa **Agregar nivel**.
2. En **Nuevo nivel**, escribe **Nombre**, elige el **Orden del nivel** (un número mayor es un nivel más alto; cada orden se usa una sola vez) y los **Puntos mínimos** para alcanzarlo.
3. Define el **Multiplicador de puntos**, de 1 a 20. Si quieres, agrega **Color (hexadecimal, opcional)**, **Icono (emoji o enlace, opcional)** y **Beneficios (uno por línea)**, hasta 30.
4. Pulsa **Crear nivel** y comprueba **Nivel creado.** Para corregir uno, usa **Editar**: el formulario se llena con lo guardado y solo se envían los campos que cambies; termina con **Guardar nivel** y comprueba **Nivel actualizado.**
5. Revisa la tabla: **Puntos mínimos**, **Multiplicador** y **Clientes** por nivel. **Eliminar** solo se habilita para un nivel sin clientes asignados.

## Qué debe pasar

Después de cada compra con puntos registrada, PF revisa el nivel del cliente y lo sube al nivel activo más alto cuyos puntos mínimos ya alcanza su saldo; el cambio queda en su historial de niveles. Con **Acumulado histórico** nadie baja de nivel. Con **Ventana móvil**, que se ajusta en **Límites y políticas**, PF recalcula a diario con los puntos ganados dentro de la ventana, respeta los **Días de gracia antes de bajar de nivel** desde que la persona alcanzó su nivel actual y puede subir o bajar a cada cliente.

El **Multiplicador de puntos** y los **Beneficios** se guardan con el nivel y se muestran en la tabla. En esta revisión, el escáner calcula los puntos de una compra con la regla base y las reglas adicionales, sin aplicar el multiplicador del nivel. Antes de prometer puntos dobles, comprueba en **Movimientos** cómo quedan registrados los puntos de un cliente con nivel.

## Si algo no funciona

**El orden ya existe:** cada orden se usa una sola vez; elige otro número. **Eliminar está desactivado:** el nivel tiene clientes asignados; esta pantalla no permite desactivarlo, así que conserva el nivel o ajusta sus puntos mínimos. **Un cliente no sube de nivel:** la revisión ocurre al registrar una compra con puntos; compara su saldo con los puntos mínimos del nivel. **Un valor se rechaza:** el nombre admite hasta 50 caracteres, el color usa seis dígitos hexadecimales y el multiplicador va de 1 a 20.

## Continúa con otra tarea

- [Ajustar límites, alertas, vencimiento y políticas](/ayuda/negocio/limites/)
- [Buscar y explicar un movimiento](/ayuda/negocio/movimientos/)
- [Crear un logro o un reto temporal](/ayuda/negocio/logros-y-retos/)

## Referencia

PuntosFieles. (2026). *PuntosFieles: aplicación web* [Software]. [Pantalla verificada](/negocio/#niveles). Revisión del 25 de noviembre de 2026.
