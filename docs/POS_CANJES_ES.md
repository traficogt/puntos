# Canjes de PF y registro en caja

PF registra puntos y recompensas; el POS registra la venta, entrega y movimientos de inventario. Un canje completado en PF no demuestra que exista un recibo en el POS ni que se hayan actualizado existencias.

## Para cualquier negocio

1. Completa el canje en el escáner PF. Conserva su código.
2. Registra el beneficio con el procedimiento de recompensas de tu caja. Puede ser un producto, servicio, descuento o beneficio sin inventario; respeta las reglas fiscales y operativas de tu POS.
3. En el escáner, registra la referencia del recibo y confirma lo que comprobaste. El propietario también puede hacerlo en **Mi negocio → Canjes y caja** (`/negocio/#canjes`).
4. Si la entrega no corresponde, falta el producto o hubo una devolución, deja una revisión y resuelve el caso. Una anotación no repone puntos ni revierte existencias.

La confirmación manual es una declaración del equipo. PF no la presenta como una verificación automática de inventario. Los registros históricos anteriores al seguimiento quedan **sin evidencia**, sin inventar entregas pendientes.

## Estados

| Estado | Qué demuestra |
| --- | --- |
| Pendiente en caja | Se completó el canje PF; todavía no existe evidencia de caja. |
| Registrado en caja | El equipo declaró un recibo o el conector confirmó su línea. Consulta por separado el estado de inventario. |
| No corresponde | Un gerente o propietario documentó por qué no aplica registrar este beneficio en caja. |
| Requiere revisión | Existe una incidencia, devolución o corrección de puntos que debe revisarse. |
| Revisado | Un gerente o propietario documentó la resolución; se conserva el historial. |
| Histórico sin evidencia | PF no tiene evidencia suficiente del registro en caja de ese canje anterior. |

## Vincular artículos: opcional

No hace falta importar el catálogo completo. En **Mi negocio → Recompensas y catálogo** (`/negocio/#recompensas`), el propietario puede crear artículos manualmente, importar un CSV con vista previa o seleccionar artículos publicados por un conector. El mismo editor reúne puntos, límite de canjes, costo estimado, disponibilidad y vínculo opcional. **Canjes y caja** conserva el seguimiento de recibos y sus vínculos avanzados:

- Recompensa PF y referencia del artículo en el POS.
- Origen exacto de la caja y su sucursal.
- Nombre, tipo de artículo y cantidad por canje.

Solicita estos identificadores al administrador del POS. **Sin sucursal asignada** solo coincide con canjes sin sucursal; no es un permiso para todas las sucursales. Cada cambio crea una nueva versión. Los canjes ya registrados conservan el vínculo usado originalmente.

El límite de canjes no es inventario físico. La comprobación de existencias es opcional y necesita un producto, una sucursal y observaciones recientes de un conector; los artículos manuales y los servicios no simulan existencias. Consulta [catálogo, inventario y canje desde cualquier POS](POS_CATALOGO_CANJE_ES.md) para el contrato independiente del proveedor.

## Canjear directamente desde una caja compatible

Un conector puede consultar opciones, autorizar un canje, recuperar su estado y cancelar un carrito no cobrado mediante la API genérica. El propietario habilita cada origen y sucursal, con un usuario PF responsable. La autorización reserva el débito de puntos y el cupo; el recibo confirma la entrega. Si se cancela antes de entregar, PF registra una restitución única. Una respuesta perdida exige consultar o repetir la misma solicitud, nunca inventar una segunda identidad ni devolver puntos automáticamente.

PF conserva el flujo manual para negocios sin conector. Odoo es una implementación opcional de este contrato; otros sistemas pueden usarlo sin adoptar Odoo.

## Odoo 18.0: módulo PF 18.0.3.0.0

Disponible en **Conectar caja** para Odoo 18.0 en Odoo.sh o servidor propio. Consulta la instalación y pruebas detalladas en [el módulo](../integrations/odoo/pf_pos_connector/README.md) y [su verificación](../integrations/odoo/VERIFICATION.md).

El botón PF en el POS permite identificar la tarjeta, elegir una recompensa y autorizarla antes de agregar su línea gratuita al carrito. El módulo conserva la intención antes de contactar PF, bloquea el cobro si el resultado es incierto y guarda la evidencia del recibo en una cola duradera al cobrar. También conserva el asistente para unir un **canje PF ya completado** con una línea gratuita o totalmente descontada de un pedido completado.

El responsable configura PF, los vínculos y la caché del módulo. Un gerente de POS usa el asistente de vinculación, comprueba el código PF y selecciona la línea elegible. El servidor guarda el vínculo y su evento en una cola duradera. Odoo sigue siendo responsable del movimiento de inventario. El módulo comunica el recibo y, cuando puede observarlo, el estado del movimiento. Las devoluciones generan evidencia de revisión, sin reponer puntos automáticamente.

Limitaciones que debe comprobar el piloto:

- Odoo Online no admite este módulo Python personalizado. No se ofrece compatibilidad probada con Odoo 19.
- Se necesita conexión para la primera autorización o consulta de un canje. La cola reintenta evidencia ya guardada al reconectarse. Esto no autoriza nuevos canjes de puntos sin conexión.
- La moneda, sucursal, producto, cantidad y versión deben coincidir. Una línea no puede satisfacer dos canjes.
- Los artículos gratuitos vinculados se excluyen del cómputo por artículo al capturar la venta; los pedidos totalmente gratuitos no suman una nueva compra. No se reescriben ventas históricas capturadas antes de configurar los vínculos.
- Un recibo editado, una devolución parcial o un movimiento de inventario no observado requieren comprobación. Una confirmación de recibo no equivale a una confirmación de stock.
- El módulo se instala pausado. Completa un piloto en la versión real del negocio antes de activar su envío.

## Criterio para lanzar

Un piloto nuevo conserva la versión del POS y del módulo, junto con comprobaciones de registro, procedimiento manual, reintento y cancelación. Usa datos ficticios para el ensayo y documenta luego la prueba real autorizada. Las pruebas automáticas del proyecto no sustituyen la validación en la caja y dispositivos del negocio.

## Contrato para otros conectores

Los tres endpoints de evidencia son `POST`, bajo `/api/public/pos/:slug/redemptions/`. Para operaciones nuevas requieren la integración POS activa y permisos de plan de integración/canjes. Todos requieren `x-signature` con HMAC SHA-256 del cuerpo JSON exacto usando la clave POS del negocio. Un Bearer solo no basta en estos endpoints. Nunca coloques esa clave en el navegador. La recuperación de una autorización ya existente conserva los controles de identidad y firma aunque el origen se pause o cambie el plan, para poder confirmar o cancelar lo ya autorizado.

| Ruta | Datos principales | Resultado |
| --- | --- | --- |
| `mappings` | `source` | Vínculos activos y moneda del negocio. |
| `lookup` | `source`, `code` | Canje, vínculo y evidencia existente, sin datos de contacto. No autoriza una segunda entrega. |
| `events` | Evento descrito abajo | Confirmación y señal de repetición `replay`. |

Un evento incluye `eventId`, `redemptionId`, `source`, `orderId`, `lineId`, `productRef`, `quantity`, `currency`, `mappingId`, `mappingVersion`, `kind`, `stockStatus` y `lineTotal: 0`. `quantity` es positiva y admite hasta seis decimales.

- `recorded`: vincula toda la línea gratuita con la cantidad y versión vigentes.
- `reversed`: referencia el `originalEventId` registrado y la línea real de devolución. Admite devoluciones parciales acumuladas hasta la cantidad original.
- `stock_updated`: referencia el evento registrado o una devolución concreta, conservando su pedido, línea y cantidad. No rebaja una confirmación final.

Estados de inventario: `unknown`, `pending`, `done` para entrega de productos; `returned` para devolución completada; `not_applicable` para servicios. La confirmación de una devolución no modifica la confirmación histórica de la entrega original.

Conserva evento y cuerpo exactos antes de enviar; repite la misma identidad si se pierde la respuesta. PF acepta repeticiones iguales y rechaza identidades reutilizadas con otros datos. No cambies el identificador para evitar un conflicto. Una misma línea del mismo origen no puede reutilizarse entre entregas o devoluciones. Una respuesta `409` requiere revisar el registro. Los eventos de devolución no restituyen puntos: usa el flujo de atención con autorización y evidencia.
