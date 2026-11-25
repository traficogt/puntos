Recorded-shape Recurrente payloads built from docs.recurrente.com (read 2026-11-25):
the unified `intent.*` envelope (type, event_type, status, id in_..., amount_in_cents,
currency, customer{}, product{}, subscription{id}, checkout{id,status,metadata},
tax_invoice_url, details.fee), the `subscription.*` payloads (id is the subscription id,
items[], cancel_at, cancellation_details), GET /subscriptions/{id}, POST /checkouts,
POST /customers, POST /products and GET /test responses. Business
11111111-1111-4111-8111-111111111111 and checkout 22222222-2222-4222-8222-222222222222
are placeholders the tests substitute. Signatures are computed at test time with
signSvixPayload; nothing here is a credential.
