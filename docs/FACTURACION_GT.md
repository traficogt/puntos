# Facturación local (Guatemala)

Este proyecto incluye exportación CSV para revisión contable con IVA:

- Endpoint: `GET /api/admin/billing/iva.csv`
- Parámetros opcionales:
  - `from=YYYY-MM-DD`
  - `to=YYYY-MM-DD`
- Columnas:
  - `fecha`
  - `transacciones`
  - `monto_bruto_q`
  - `base_sin_iva_q`
  - `iva_12_q`

Notas:

- El cálculo usa IVA 12% (base = bruto / 1.12).
- Es un reporte operativo para control interno; la emisión fiscal oficial
  depende del sistema contable/facturador del negocio.
