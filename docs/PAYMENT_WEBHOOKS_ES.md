# Integración de webhooks de pago

Para conectar cualquier POS mediante un formato común, usa la [guía de integración POS](POS_INTEGRATION_GUIDE.md). El endpoint de premios externos acepta el formato de PuntosFieles sin depender de una marca de POS. Los webhooks nativos de terceros requieren verificar firma, estructura, unidades monetarias y relación comercio/cliente antes de reenviar datos.

## Endpoint de entrada (proveedor -> PuntosFieles)

`POST /api/public/payments/webhook/:provider`

Headers:
- `Content-Type: application/json`
- `x-webhook-secret: <secreto>` (opcional; requerido si configuraste secreto para ese proveedor)
- `x-signature: sha256=<firma_hex>` (opcional; requerido si configuraste HMAC para ese proveedor)

Body: JSON normalizado por una integración confiable. No se debe enviar un payload nativo sin confirmar su compatibilidad y autenticación. Un nombre de proveedor en la URL no constituye un adaptador nativo.

Ejemplo del formato común:

```json
{
  "externalEventId": "sale-12345",
  "status": "PAID",
  "amount_q": 48.5,
  "currency": "GTQ",
  "businessSlug": "cafe-demo",
  "customerPhone": "50255554444"
}
```

Se aceptan los estados exactos `PAID`, `COMPLETED`, `SUCCEEDED`, `SUCCESS` y `APPROVED` (sin distinguir mayúsculas y con espacios externos eliminados). `APPROVED` debe representar un pago final confirmado por la integración, nunca una mera autorización de tarjeta. También se reconocen los eventos exactos `payment.paid`, `payment.completed`, `payment.succeeded`, `payment.success` y `payment.approved`. Si llega `payment.updated`, debe acompañarlo un estado exitoso explícito. Los campos `status`/`payment_status` y `event`/`event_name`/`type`, si se incluyen, deben ser compatibles entre sí. Estados desconocidos, contradictorios, pendientes, fallidos o de devolución no generan puntos; no se buscan coincidencias parciales como `PAID` dentro de `UNPAID`.

La recepción de un evento ignorado no revierte premios previos. El flujo de devoluciones se debe acordar por separado. No reutilices un identificador de evento pendiente ignorado para una notificación posterior de pago. Para una integración nueva, se recomienda enviar solo la venta final al endpoint de premios externos con un ID estable de venta.

## Seguridad

Configura secretos por proveedor con:

```env
PAYMENT_WEBHOOK_SECRETS={"cubo":"sec_xxx","paybi":"sec_yyy","qpaypro":"sec_zzz"}
```

Si hay secreto configurado para el proveedor, el request sin `x-webhook-secret` correcto será rechazado.

Para verificación criptográfica HMAC SHA-256:

```env
PAYMENT_WEBHOOK_HMAC_SECRETS={"cubo":"hmac_sec_xxx","paybi":"hmac_sec_yyy"}
```

Si hay HMAC configurado, la firma en `x-signature` debe coincidir con el hash del cuerpo RAW del webhook.

Con Docker Compose, carga estos mapas desde archivos externos mediante `PAYMENT_WEBHOOK_SECRETS_FILE` y `PAYMENT_WEBHOOK_HMAC_SECRETS_FILE`. Configura `PAYMENT_WEBHOOK_ALLOWED_PROVIDERS` para los identificadores de proveedores habilitados. Mantén `PAYMENT_WEBHOOK_REQUIRE_AUTH=true`. La firma del webhook genérico es HMAC-SHA256 hexadecimal; las firmas nativas de Loyverse, Vendty u otros proveedores no se validan automáticamente con este esquema.

## Flujo interno

1. Se normaliza payload a formato canónico.
2. Se registra evento en `payment_webhook_events`. La idempotencia es por `provider + provider_event_id` dentro de cada negocio: dos negocios pueden recibir el mismo ID de evento. Los eventos sin negocio identificado se agrupan por el `businessSlug` recibido y nunca se asignan después a otro negocio; un reenvío con el negocio correcto crea su propio registro.
3. Si el evento no es aprobado -> `IGNORED`.
4. Si el monto falta o no es un número no negativo con hasta dos decimales (`48.5` o `"48.50"`) -> `FAILED` con motivo `invalid_amount` y respuesta `400`. Nunca se acredita como monto cero. Un reenvío corregido con el mismo ID lo aplica.
5. Si falta negocio/cliente -> `PENDING_MAPPING`.
6. Si hay datos suficientes -> se otorgan puntos automáticamente (`APPLIED`).

## Revisión y resolución manual

- Listar pendientes:
  - `GET /api/admin/payment-webhooks?status=PENDING_MAPPING&limit=20`
- Resolver un evento:
  - `POST /api/admin/payment-webhooks/:id/resolve`
  - Body:
    - `{ "customerPhone": "50255551234" }` o
    - `{ "customerId": "<uuid>" }`
  - Solo se pueden resolver pagos aprobados en `PENDING_MAPPING`, o en `FAILED` con motivo `invalid_amount`. En este último caso agrega el monto corregido: `{ "customerPhone": "50255551234", "amountQ": "48.50" }`. Los eventos ignorados (reembolsos, pagos pendientes o fallidos), ya aplicados u otros fallos responden `409`.

## Nota de operación

Para maximizar matching automático, incluye en la orden:
- `businessSlug`
- `customerId` (ideal) o `customerPhone`
- `externalEventId` único por pago
