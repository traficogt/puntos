# Audiencias reutilizables

Las audiencias permiten guardar una definición y comprobar quién coincide ahora. Requieren una sesión de propietario con las funciones `analytics` y `campaign_rules`. La definición no autoriza mensajes ni asigna puntos. El almacenamiento nuevo usa `merchant_audiences`; las tablas históricas `customer_segments` y `customer_segment_assignments` de analytics se conservan.

## Reglas y métricas

Una definición contiene `window_days` (30, 90, 180 o 365), un grupo `include` y otro `exclude`. Cada grupo elige `match: "all"` o `"any"`. Se permiten de una a ocho reglas de inclusión y hasta ocho de exclusión. Una exclusión vacía no excluye clientes.

| Campo | Significado | Operadores |
| --- | --- | --- |
| `purchase_count` | Compras registradas en el período | `gte`, `lte`, `eq` |
| `spend_q` | Importe registrado de esas compras, GTQ | `gte`, `lte`, `eq` |
| `has_purchase` | Tiene alguna compra registrada hasta el corte, sin limitar al período | `eq`, booleano |
| `last_purchase_days` | Días completos desde la última compra registrada en todo el historial | `gte`, `lte`, `eq` |
| `joined_days` | Días completos desde la creación del registro en PF | `gte`, `lte`, `eq` |
| `points_balance` | Saldo disponible actual; no incluye puntos pendientes | `gte`, `lte`, `eq` |
| `marketing_opt_in` | Preferencia promocional explícita actual | `eq`, booleano |

Las cantidades numéricas son no negativas, hasta 1,000,000,000; solo `spend_q` admite hasta dos decimales. Los nombres de campo y operadores provienen de una lista fija. Los valores se envían como parámetros SQL; no se aceptan expresiones, consultas, teléfonos ni listas arbitrarias de clientes.

La definición de compra coincide con recuperación y medición de campañas: fuentes `online`, `offline`, `external` u `order`; tipo `PURCHASE` o nulo; estado `POSTED` o `PENDING`; actividad de importe, visitas o artículos; sin vínculos de reversión. No cuenta ajustes ni eventos vacíos. El período usa horas transcurridas: desde corte menos N × 24 horas, inclusive, hasta el corte, inclusive. Las fechas futuras y clientes eliminados se excluyen.

Si nunca hubo compra, `has_purchase` es falso y `last_purchase_days` es nulo. Las comparaciones numéricas de días no coinciden con ese nulo, incluso en exclusiones. `purchase_count = 0` puede incluir tanto clientes nuevos como personas cuya última compra fue antes del período; usar `has_purchase = false` para “nunca compró”. `joined_days` mide antigüedad en PF, no la relación previa de un cliente importado.

## API de propietario

Base: `/api/admin/audiences`. Las respuestas llevan `Cache-Control: no-store`. Los POST y PUT exigen CSRF y mismo origen. La identidad del negocio y la atribución de soporte provienen de la sesión; el cuerpo no puede fijarlas.

- `GET /`: devuelve `{segments, total}`, hasta las 100 definiciones guardadas, incluidas las archivadas.
- `POST /`: `{request_id, name, definition}` crea una definición en versión 1. El mismo request con la misma definición no crea otra, incluso después de editar la existente; devuelve el registro actual. Reutilizar el request con otro contenido produce conflicto.
- `PUT /:id`: `{version, name, definition, archived}` cambia la definición e incrementa su versión. Una versión desactualizada produce conflicto. Archivar no borra campañas anteriores.
- `POST /preview`: `{definition, limit?}` devuelve `{total, contactable_count, customers, generated_at}`. La muestra tiene de 1 a 20 clientes, por defecto 10, ordenados por ID; el total cuenta todos los resultados. Solo devuelve nombre, ID y métricas, sin teléfono o correo.

`contactable_count` significa coincidencia con consentimiento explícito y teléfono de formato válido. No indica que exista un proveedor operativo, que el mensaje se pueda enviar ahora o que se haya entregado. Al enviar, los controles actuales de consentimiento, frecuencia, grupo de control y presupuesto siguen siendo obligatorios.

El negocio puede guardar hasta 100 definiciones, contando las archivadas. La creación y actualización se serializan por negocio y se auditan con ID, versión y estado. Cuando corresponde, el evento incluye la atribución del soporte autenticado. RLS y las consultas limitan los registros al negocio.

## Campañas con una audiencia guardada

El POST existente `/api/admin/growth-campaigns` conserva `recovery_run_id`. Como alternativa excluyente acepta `audience_segment_id`, `audience_segment_version` y `audience_limit` obligatorio de 10 a 200.

La creación verifica versión y estado, evalúa la definición y fija los miembros en ese momento. Si existen más coincidencias que el límite, selecciona por ID ascendente y registra el excedente; esa selección no pretende ser una muestra aleatoria. La asignación aleatoria a tratamiento/control ocurre en la activación existente. Se requieren al menos diez clientes activos para activarla.

`campaign.audience_snapshot` contiene:

```json
{
  "segment_id": "uuid",
  "segment_version": 1,
  "name": "Nombre al crear",
  "definition": {},
  "cutoff": "fecha ISO del servidor",
  "generated_at": "fecha ISO del servidor",
  "total": 240,
  "contactable_count": 180,
  "selected_contactable_count": 150,
  "selected_count": 200,
  "limit": 200,
  "overflow_count": 40,
  "selection_order": "customer_id_asc"
}
```

El ejemplo ilustra la forma, no resultados de un negocio. Una campaña de recuperación conserva `audience_snapshot: null`. El snapshot no almacena datos de contacto ni una segunda lista editable de miembros.

Editar o archivar la definición no actualiza miembros, reglas, versión guardada ni asignaciones de una campaña ya creada. Un reintento del mismo request de campaña se comprueba antes de volver a consultar la definición; no recompone una audiencia diferente. Crear una campaña conserva estado `draft`, sin activar, enviar mensajes o conceder puntos.

## Verificación

Los tests de API comprueban autenticación, propietario, plan, CSRF, aislamiento de negocio, cuerpos estrictos y atribución de soporte. La suite PostgreSQL comprueba inclusión/exclusión, nulos, límites temporales, consentimiento, edición optimista, reintentos, límite de registros, snapshot fijo, excedentes, asignaciones y RLS con un rol sin privilegios.

`audience-upgrade.test.js` aplica `schema.sql` y `schema-extensions.sql`, crea un segmento histórico y su asignación, aplica la migración nueva dos veces y verifica ambos sistemas. Las suites usan bases locales desechables con nombres y hosts comprobados. No requieren producción ni proveedores externos.
