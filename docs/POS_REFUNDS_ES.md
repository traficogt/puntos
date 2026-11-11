# Devoluciones POS y conciliación de puntos

La devolución de dinero se realiza en la caja. PF recibe evidencia del recibo y concilia sus puntos contra una compra registrada; no ejecuta devoluciones monetarias en el proveedor.

## Adaptadores API

Envía `POST /api/v1/public/pos/{slug}/refunds` usando la misma clave Bearer o firma HMAC `x-signature` del cuerpo original que utiliza `/sales`. La conexión API y su plan deben estar habilitados. No envíes teléfonos, IDs de cliente ni credenciales dentro del JSON.

```json
{
  "refundId": "DEV-001",
  "originalSaleId": "VENTA-001",
  "source": "caja-1",
  "amountQ": 40,
  "currency": "GTQ",
  "scope": "full"
}
```

`source` e `originalSaleId` deben coincidir exactamente con la venta enviada a PF. `refundId` identifica este recibo de devolución y debe conservarse al reintentar. El importe es positivo o cero, con hasta dos decimales, en GTQ. El origen `loyverse:` está reservado para la conexión nativa.

`scope: "full"` declara que se devolvieron **todos los artículos y todos los importes**, incluidos artículos gratuitos o completamente descontados. El adaptador debe verificarlo con el recibo original. No deduzcas `full` solo porque coinciden los totales. Usa `partial` si queda cualquier artículo, cantidad o importe sin devolver. `unknown`, o la omisión de `scope`, conserva el recibo para revisión sin autorizar una reversión automática.

PF guarda primero el recibo. La respuesta incluye `refund.status`, `refund.reason`, un mensaje y, cuando hay conciliación, los IDs del movimiento original y su reversión. HTTP 200 confirma la recepción; **no implica que se hayan revertido los puntos**. Comprueba `status === "reconciled"`. Repetir los mismos datos no duplica el ajuste. Cambiar datos del mismo recibo produce HTTP 409; no cambies el ID para eludir un conflicto: revisa la evidencia con el propietario.

## Loyverse

El conector utiliza la [referencia oficial de recibos](https://developer.loyverse.com/docs/): `receipt_type=REFUND`, `refund_for`, `receipt_number`, `store_id`, `total_money`, `payments` y `line_items`. Verifica la cuenta y la moneda GTQ, conserva el origen `loyverse:{merchant_id}:{store_id}` y consulta el recibo original mediante GET. Compara las cantidades por artículo y variante, incluidos artículos gratuitos, y los importes. Solo una coincidencia completa permite `scope=full`; originales ausentes, evidencia incompleta o cantidades de precisión no soportada quedan sin verificar. Nunca busca al cliente por teléfono para una devolución.

Las consultas de originales admiten como máximo cinco lecturas simultáneas y una página de cien recibos. Los fallos del proveedor conservan la posición de sincronización. Una vez guardadas, las devoluciones tienen su propia cola durable y las parciales no bloquean la importación de ventas.

## Límites y revisión

- PF aplica la reversión completa existente, incluidas reglas de puntos pendientes, logros, retos y política de saldo negativo. Si cualquier parte falla, el ajuste se revierte y el recibo sigue pendiente.
- Las devoluciones parciales no calculan puntos proporcionales, no se combinan para fingir una devolución completa y no deben resolverse anulando toda la compra. Revisa el recibo y el historial antes de decidir un ajuste manual.
- Un recibo original que aún no se importó, saldo insuficiente, cliente eliminado, importes distintos o alcance desconocido permanece pendiente con su motivo. Reintentar conserva los datos recibidos; no convierte un caso parcial o ambiguo en completo.
- Una reversión manual previa solo se reconoce cuando existe el movimiento de reversión correspondiente en el historial. No hay un botón para marcar éxito sin esa evidencia.
- Las comprobaciones automáticas de originales pendientes y errores temporales son de hasta 25 casos por pasada, con un minuto entre intentos y un máximo de diez intentos. Casos parciales o sin evidencia suficiente requieren revisión. La llegada de la venta original por API vuelve a comprobar sus devoluciones pendientes.

El propietario puede consultar `GET /api/admin/pos/refunds?status=pending&limit=50` y reintentar un caso mediante `POST /api/admin/pos/refunds/{id}/retry` con sesión y CSRF. La pantalla **Conectar caja → Devoluciones y conciliación** presenta conteos de recibos recibidos y movimientos comprobados; no certifica recibos que el proveedor nunca envió. El demo usa solo ejemplos locales.

## Verificación local

La suite `tests/integration/pos-refunds.mjs` exige una base desechable `pos_refund_tests` en `127.0.0.1:55451`, aplica únicamente el esquema base, extensiones, RLS y esta migración, y recrea ese esquema de prueba. No debe ejecutarse contra otra base. Cubre entregas concurrentes, conflictos de huella, puntos pendientes, devoluciones parciales, alcance desconocido, permisos entre negocios, reversión manual previa, logros/retos, política de saldo y rollback atómico.
