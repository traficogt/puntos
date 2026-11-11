# Conectar un punto de venta a PuntosFieles

El negocio no necesita modificar el código de su POS. PuntosFieles ofrece un lector nativo de Loyverse, importación de archivos CSV y una API para conectores. Otros sistemas necesitan una API, webhook o exportación accesible; un POS cerrado sin ninguna de esas opciones requiere colaboración del proveedor.

## Configuración del negocio

Como propietario, abre **Administración → Regla de puntos → Conecta tus ventas**. Esta función depende del plan del negocio. Elige un método, habilita la conexión y guarda. Cambiar de método pausa el método anterior. Los clientes deben estar registrados en PuntosFieles con el mismo teléfono que usan en el POS; no se crean clientes automáticamente.

### Loyverse

1. Crea un token de acceso en tu cuenta de Loyverse con lectura de comercio, tiendas, recibos y clientes. Consulta la [documentación oficial](https://developer.loyverse.com/docs/) y confirma que tu cuenta permite acceso a la API.
2. Pega el token en el panel. Puedes limitar la conexión a un ID de tienda; vacío incluye todas las tiendas del comercio. Al guardar verificamos acceso, identidad y moneda GTQ. El token se guarda cifrado y nunca se devuelve al navegador.
3. Haz una compra de prueba con un cliente registrado después de activar la conexión. Usa **Ver vista previa**, comprueba el cliente y el monto, y confirma **Sincronizar ventas**.
4. Activa la opción automática para consultar cada cinco minutos. Cada consulta procesa hasta 100 recibos nuevos; el panel muestra si quedan grupos pendientes y los problemas encontrados.

Solo se importan ventas desde la activación. Desactivar y volver a activar, cambiar de método o cambiar de comercio/tienda inicia un nuevo período: las ventas del período desconectado requieren revisión e importación CSV. Renovar el token de la misma cuenta conserva el progreso. La consulta verifica pagos completos y resuelve teléfonos mediante la API de clientes. Los programas por artículo requieren cantidades enteras; las ventas por peso pueden usarse en programas por gasto o visita. No hay acceso al código fuente del POS.

Los reembolsos y anulaciones no generan puntos y **no revierten automáticamente** puntos de ventas anteriores. Revisa los ajustes en PuntosFieles. No uses simultáneamente otro canal para acreditar las mismas ventas.

Las ventas con problemas conservan su ID y se vuelven a consultar, hasta 25 por sincronización, para recuperar cambios en los teléfonos o clientes registrados posteriormente. El panel muestra el total pendiente. Se conservan hasta 500 IDs pendientes; si se supera ese límite, el grupo de ventas nuevas no avanza hasta resolver los problemas. Cambiar de comercio/tienda o reiniciar la conexión borra esa lista; revisa los pendientes antes de hacerlo.

### CSV: para cualquier sistema que exporte ventas

Exporta un archivo UTF-8 con encabezados, hasta **100 filas y 200 KB**, separado por comas o punto y coma. En el panel, indica un nombre estable para el sistema/tienda, selecciona el archivo y relaciona las columnas de ID de venta, teléfono, monto, estado y cantidad de artículos si corresponde. Los nombres de las columnas pueden ser los que ya exporta el POS.

Selecciona si el monto está en quetzales o centavos. Solo se aceptan estados `paid`, `completed`, `pagado` o `pagada`; si no hay columna de estado debes confirmar expresamente que todas son ventas pagadas y no reembolsos. No uses separadores de miles; los decimales con coma requieren un CSV separado por punto y coma.

La vista previa no cambia saldos. Muestra las filas listas, repetidas, omitidas y con problemas. **Importar ventas y asignar puntos** vuelve a validar y aplica solo las filas listas. Corrige los problemas y vuelve a importar con los mismos IDs y nombre de origen. Cambiar el origen de una venta ya importada puede duplicarla; usa orígenes distintos únicamente para sistemas/tiendas con numeración independiente.

## API para conectores

El propietario elige **API**, guarda la conexión, genera una clave y copia la dirección mostrada. La clave completa solo se muestra una vez. Generar otra invalida la anterior. No requiere editar variables del servidor ni el software del POS: el conector puede ejecutarse en un servidor del negocio, una plataforma de automatización o infraestructura del proveedor.

```http
POST https://app.puntosfieles.com/api/v1/public/pos/SLUG_DEL_NEGOCIO/sales
Content-Type: application/json
Authorization: Bearer CLAVE_DEL_NEGOCIO
```

```json
{
  "saleId": "000123",
  "source": "mi-pos:tienda-1",
  "customerPhone": "50255554444",
  "amountQ": 48.5,
  "currency": "GTQ",
  "status": "paid",
  "items": 2,
  "dryRun": true
}
```

- `saleId` es un identificador de venta estable, conservado como texto. `source` identifica el sistema/tienda (por defecto `api`). Reutiliza ambos y los mismos datos en reintentos.
- `customerPhone` identifica un cliente registrado en ese negocio. Un ID de cliente del proveedor requiere una consulta o correspondencia en el conector.
- `amountQ` es un número en quetzales con hasta dos decimales. La moneda debe ser `GTQ`; no convertimos monedas automáticamente.
- `status` debe ser exactamente `paid` o `completed`. El conector debe verificar el pago real antes de enviarlo. No envíes pagos parciales, cancelaciones, reembolsos ni montos negativos.
- `items` es un entero no negativo; debe ser positivo en programas por artículo. Cada venta cuenta como una visita. Las reglas del negocio calculan los puntos.
- `dryRun: true` devuelve `rows` y `summary` sin asignar puntos. Para aplicar, elimina ese campo o usa `false`.

Como alternativa al encabezado Bearer, envía `x-signature` con el HMAC-SHA256 hexadecimal del cuerpo JSON exacto, usando la misma clave del negocio. Si envías ambos encabezados, ambos deben ser válidos. Guarda las credenciales en el servidor del conector, nunca en código de navegador o URLs.

Una aplicación válida devuelve `{ "ok": true, "result": { "awarded": 1, "duplicates": 0, "errors": 0, "ignored": 0, "issues": [] } }`. **Revisa los contadores y `issues`, incluso con HTTP 200.** Un cliente desconocido o un ID reutilizado con datos diferentes aparece como error sin puntos. Una repetición idéntica aparece en `duplicates`. La suma puede quedar pendiente si el programa tiene un período de retención; la vista previa es orientativa y las reglas se vuelven a aplicar al importar.

Reintenta `429`, fallos de red y errores temporales con espera creciente y los mismos datos. Los `400` requieren corregir entrada; `401`, credenciales; `403`, activación, método o plan; `404`, negocio; `409`, otra operación en curso. Una importación interrumpida puede haber aplicado algunas filas; repetirla con los mismos IDs evita duplicados. No acredites manualmente una venta mientras su reintento está pendiente.

## Qué pedir a otro proveedor de POS

1. Producto, versión, modalidad de hosting, plan, tiendas y contacto de integración.
2. Documentación oficial de API/webhooks/exportación, entorno de pruebas y permisos de acceso. Compartir credenciales por un canal seguro.
3. Ejemplos anónimos de venta pagada, parcial, pendiente, anulada y reembolsada; evento exacto que demuestra el pago completo.
4. ID estable del recibo; monto, impuestos/descuentos/propinas, moneda y unidades; cobertura de efectivo y tarjeta.
5. Teléfono del cliente o API para obtenerlo a partir del ID del proveedor.
6. Verificación de firmas, identificación del comercio/tienda, reintentos, orden de eventos y proceso de devoluciones.

Con eso podemos construir la traducción del lado de PuntosFieles o en un conector, sin pedir que el proveedor cambie su formato. Antes de lanzar, prueba una venta pagada, una repetición, una venta impagada, un cliente desconocido y credenciales incorrectas en un negocio de prueba. Acuerda el proceso de devoluciones y empieza por una tienda.

## Guatemala integration shortlist

Reviewed November 9, 2026. This is an integration-priority shortlist, not a market-share ranking: no reliable public ranking of Guatemala POS installations was found. Loyverse now has the native read-only connector described above; other entries remain candidates requiring adaptation. No merchant account is connected automatically.

| System | Guatemala evidence | Connection to evaluate |
| --- | --- | --- |
| Loyverse | [Named Guatemala businesses](https://loyverse.town/blogs/entry/305-using-loyverse-as-an-ally-in-the-growth-of-a-business-with-the-management-of-reports/) | [Receipt/customer API and webhooks](https://developer.loyverse.com/docs/). OAuth webhooks are signed; personal-token webhooks are unsigned. Resolve the vendor customer ID through its customer API and bind merchant/store to the business. |
| Odoo POS | [Guatemala customer using POS](https://www.odoo.com/lt_LT/customers/punto-naranja-2441591) | [External API](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html) or a custom module/bridge. Confirm version, deployment, and external API entitlement; hosted access requires the Custom plan. Map paid orders and customers, then sign the PuntosFieles request. |
| Vendty | [Guatemala offering](https://vendty.com/gt) | [Documented signed sales webhooks](https://api-pub-docs.vendty.com/). Bind `api_client`/warehouse to the merchant. `sale.created` with `status: valid` means a non-voided recorded sale; confirm how credit sales and partial payments are distinguished before awarding. |
| Soft Restaurant | [Guatemala support](https://www.nationalsoft.com.gt/) | [Licensed ERP/PMS integration module](https://softrestaurant.zohodesk.com/portal/es/kb/articles/m%C3%B3dulo-de-integraci%C3%B3n-erp-y-psm). Its `Ventas[]` batch requires mapping and authenticated middleware; `IdCliente` can be empty. |

Payment gateways need separate assessment from full POS systems. [Cubo's payment-link webhook](https://developers.cubopago.com/endpoints/links-config/webhook) uses cents and does not document an incoming signature; verify payment through its authenticated API and preserve the original order/customer association before forwarding. [QPayPro](https://www.qpaypro.com/gt/webhooks), [BAC](https://ayuda.baccredomatic.com/para_empresas_o_negocios/comercios_afiliados/e-commerce), and [NeoNet](https://neonet.com.gt/e_commerce/cybersource) require the documentation and credentials for the merchant's specific product. Card-payment notifications alone do not establish coverage of cash sales.

## Compatibilidad con integraciones anteriores

`POST /api/v1/public/external/award` y los webhooks de pago existentes conservan sus contratos. El endpoint anterior recibe `businessSlug`, `externalEventId`, `customerPhone` y `amount_q`; usa su secreto HMAC específico configurado por el operador mediante `PAYMENT_WEBHOOK_HMAC_SECRETS_FILE`. Ese secreto es independiente de la clave del nuevo panel. No cambies credenciales o formatos de una integración existente sin coordinar su migración. Consulta [la guía de webhooks de pago](PAYMENT_WEBHOOKS_ES.md).

No envíes la misma venta al endpoint anterior y al nuevo: sus identificadores de idempotencia son diferentes. La protección de repetición aplica dentro de cada identidad estable, no reconoce automáticamente que dos canales representan el mismo recibo.
