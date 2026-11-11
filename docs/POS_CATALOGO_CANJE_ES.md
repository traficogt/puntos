# Catálogo, existencias y canjes desde cualquier caja

PF conserva el programa, los puntos y los compromisos con el cliente. El POS conserva las ventas, los impuestos y los movimientos físicos. Odoo 18 es un conector opcional; estos contratos no dependen de sus modelos. Una caja distinta necesita un adaptador que cumpla el mismo protocolo. No basta con indicar su marca para que quede conectada.

## Para el propietario

En **Mi negocio → Recompensas y catálogo** (`/negocio/#recompensas`) puedes crear una recompensa, elegir su costo en puntos, limitar la cantidad de canjes, indicar su costo estimado y seleccionar productos o servicios. Un límite de veinte canjes no significa que haya veinte unidades físicas.

Puedes buscar un artículo sincronizado, agregar uno manualmente o pegar un CSV y revisar la importación. Los registros manuales y CSV sirven para preparar el catálogo sin contratar un POS. No prueban existencias ni automatizan una venta. Importar no elimina artículos omitidos.

La comprobación de existencias se activa expresamente por recompensa, producto conectado y sucursal. Requiere una observación del conector de los últimos cinco minutos. Una cantidad desconocida, una lectura antigua o un producto desactivado bloquean ese canje hasta revisar la caja. Los servicios no requieren existencias. Esta comprobación no reserva mercancía frente a otras ventas.

**Canjear desde la caja** permite autorizar un origen/sucursal y asignarle una cuenta PF activa de esa sucursal. Cada acción incluye además la referencia del operador que comunica el conector. La asignación no crea cuentas ni concede acceso a otras sucursales.

## Transporte común para adaptadores

Base: `POST https://app.puntosfieles.com/api/public/pos/{slug}`. JSON UTF-8; encabezado `x-signature` con HMAC-SHA256 hexadecimal sobre los bytes exactos enviados, usando la clave de conexión del comercio. La clave permanece en el servidor del conector. Catálogo, existencias y canjes requieren firma; no se acepta sustituirla por una clave enviada al navegador.

Cada intento conserva su identificador y su contenido. Reintentar una operación incierta con un identificador nuevo puede representar otra acción; primero consulta o reenvía la solicitud original. Las respuestas no deben almacenarse en cachés compartidas. Origen, referencias de producto y carrito son identificadores opacos; no son URLs que PF vaya a consultar.

### Catálogo y existencias

`/catalog/sync` recibe `source`, `requestId`, `observedAt` (ISO 8601 con zona) e `items`, hasta 200 por solicitud. Cada artículo contiene `productRef`, `sku` opcional/nulo, `name`, `itemKind` (`product` o `service`) y `active`. El origen identifica una conexión de caja de forma estable; usa un origen diferente para cada sucursal cuando los vínculos difieran. Las referencias locales `catalog:manual` y `catalog:csv` están reservadas.

`/inventory/snapshot` recibe los mismos campos de lote, una `branchId` UUID y artículos `{productRef, availableQuantity}`. La cantidad es no negativa o `null` cuando el sistema no puede comprobarla. Las fechas antiguas no sobrescriben observaciones nuevas. El conector debe comunicar disponibilidad de la ubicación correcta y descontar las reservas que su POS conozca; no mezclar el stock de otra empresa o almacén. Una cantidad cero confirma falta de unidades; `null` significa desconocida.

CSV local: `productRef,sku,name,itemKind,active,revision`. La vista previa muestra conflictos de revisión antes de aplicar. `revision=0` crea; una revisión existente debe coincidir para actualizar. Se valida el archivo completo y se guarda en una transacción.

### Canje en el carrito

1. `/checkout/options`: `{source,branchId,customerQrToken}`. Lee una tarjeta PF de navegador o Wallet y devuelve el cliente y las recompensas vinculadas, con costo en puntos y evidencia de disponibilidad. Un número de teléfono no sustituye la tarjeta para gastar puntos.
2. El conector guarda primero un intento duradero local con UUID `requestId`, identificadores `cartId` y `cartLineId`, selección, cliente, operador y contenido exacto. Debe confirmar esa escritura antes de llamar a PF.
3. `/checkout/authorize`: `{source,branchId,requestId,cartId,cartLineId,customerId,customerQrToken,rewardId,mappingId,mappingVersion,operatorRef}`. PF valida la tarjeta, sucursal, reglas ganadas, saldo, límite de canjes y las comprobaciones configuradas. Debita puntos una sola vez y devuelve `status`, `redemption:{id,code,points_cost,balance_after}` y el vínculo congelado `mapping`.
4. Solo una autorización confirmada permite agregar la línea gratuita exacta al carrito. El POS valida producto, cantidad, precio, impuestos, empresa, sesión y existencias locales antes del pago. No combinar esa línea con una venta normal. El producto se procesa mediante las operaciones normales del POS, incluidos sus movimientos de stock cuando corresponda.
5. Al guardar el recibo pagado, el POS guarda en la misma transacción su evento duradero de entrega. Envía `/redemptions/events` con el contrato de `docs/POS_CANJES_ES.md` y `checkoutRequestId`, `cartId`, `cartLineId`. `orderId` y `lineId` identifican el recibo real. PF acepta el vínculo congelado de la autorización aunque el propietario lo haya editado después. La confirmación termina el ciclo de reglas protegidas.

`/checkout/status`: `{source,branchId,requestId}` recupera la respuesta confirmada. Los estados son `authorized`, `recorded` y `cancelled`. Una respuesta perdida, un timeout o la pérdida de conexión no prueban que PF rechazó el débito. Mantén la operación pendiente y usa la misma identidad al recuperarla.

### Cancelación y conciliación

Antes de pedir una devolución de puntos, el POS bloquea el pago duraderamente, comprueba que el pedido sigue en borrador y retira la línea del premio. Después envía `/checkout/cancel` con `{source,branchId,requestId,cancelRequestId,cartId,cartLineId,reason,orderState:"draft",rewardLineRemoved:true}`. `cancelRequestId` es un UUID estable para sus reintentos.

PF registra una reversión de puntos y repone el límite de canjes una sola vez. No modifica inventario físico. Si la cancelación llega antes que la autorización, guarda una cancelación duradera que impide un débito tardío. Si ya existe un recibo o una restitución, exige conciliación; no hace otra devolución automática. No expira autorizaciones devolviendo puntos a ciegas.

Los estados y cancelaciones pueden recuperarse con la firma válida incluso al pausar la conexión o cambiar de plan. Rotar o revocar la clave requiere actualizar el conector. Una entrega real también puede conciliarse con una referencia de recibo y confirmación del equipo en **Canjes y caja**. Un carrito pendiente no se puede cerrar como «no requiere registro».

## Qué pedir a otro proveedor de POS

- Versión/edición, empresa, sucursales y almacenes; acceso a un entorno de pruebas.
- API/webhooks documentados, autenticación, límites y capacidad de guardar una referencia externa por pedido y línea.
- Identificadores estables de artículos, variantes, servicios, cajeros, clientes y recibos.
- Forma admitida de registrar una recompensa gratuita con tratamiento fiscal correcto y sin duplicar movimientos físicos.
- Disponibilidad por sucursal, reservas, productos por lote/serie y momento en que se confirma el movimiento.
- Confirmación transaccional de pedido pagado, devolución parcial y cancelación; cola duradera y recuperación tras desconexión.
- Capacidad de extender la pantalla de caja y escanear QR. Si solo permite exportar CSV, podremos importar datos, pero no prometer canjes automáticos en esa caja.

## Límites que hay que probar en el piloto

La primera autorización requiere conexión con PF; no se ofrece un premio gratis basándose en una solicitud sin confirmar. Una autorización ya confirmada y un recibo pendiente de enviar requieren recuperación duradera del conector. No existe garantía de «cero errores» o inventario reservado entre sistemas independientes. Prueba pérdida de respuesta, recarga, doble pulsación, cancelación, recibo, impuestos, falta de unidades y devolución usando la configuración real del comercio antes de activarlo en caja.

La compatibilidad Odoo se limita a la versión y casos descritos en `integrations/odoo/VERIFICATION.md`. Otras ediciones, módulos, terminales y sistemas necesitan sus propias pruebas. Estas mejoras se distribuyen en web/servidor y en el conector opcional; no publican nuevas apps iOS o Android.
