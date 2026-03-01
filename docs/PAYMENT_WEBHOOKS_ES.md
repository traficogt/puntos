# Integración de webhooks de pago

## Endpoint de entrada (proveedor -> PuntosFieles)

`POST /api/public/payments/webhook/:provider`

Headers:
- `Content-Type: application/json`
- `x-webhook-secret: <secreto>` (opcional; requerido si configuraste secreto para ese proveedor)
- `x-signature: sha256=<firma_hex>` (opcional; requerido si configuraste HMAC para ese proveedor)

Body: payload original del proveedor.

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

## Flujo interno

1. Se normaliza payload a formato canónico.
2. Se registra evento en `payment_webhook_events` (idempotencia por `provider + provider_event_id`).
3. Si el evento no es aprobado -> `IGNORED`.
4. Si falta negocio/cliente -> `PENDING_MAPPING`.
5. Si hay datos suficientes -> se otorgan puntos automáticamente (`APPLIED`).

## Revisión y resolución manual

- Listar pendientes:
  - `GET /api/admin/payment-webhooks?status=PENDING_MAPPING&limit=20`
- Resolver un evento:
  - `POST /api/admin/payment-webhooks/:id/resolve`
  - Body:
    - `{ "customerPhone": "50255551234" }` o
    - `{ "customerId": "<uuid>" }`

## Nota de operación

Para maximizar matching automático, incluye en la orden:
- `businessSlug`
- `customerId` (ideal) o `customerPhone`
- `externalEventId` único por pago
