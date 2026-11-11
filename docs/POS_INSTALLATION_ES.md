# Preparar una instalación POS repetible

La pantalla web **Conectar caja** prepara la decisión de método y dos entregables: una ficha de texto y un paquete JSON `pf.pos-installation.v1`. No instala software, no contacta al proveedor y no certifica una conexión. Los ajustes efectivos siguen bajo **Configura la conexión** y los accesos se gestionan en administración.

## Qué contiene el paquete

- Sistema, versión exacta, alojamiento y capacidades declaradas por el responsable.
- Recomendación y requisitos según proveedor; documentación oficial enlazada.
- Plantilla de configuración con `enabled: false` y `automatic: false`. Si falta definir el método, la plantilla es `null`.
- Contratos PF para ventas y devoluciones, identidad estable y ejemplos ficticios de venta, reintento idéntico y devolución.
- Ocho pruebas de aceptación pendientes, cada una con versión y rol responsable: mapeo, vista previa, compra, duplicados, reconexión, devolución, pausa y autorización del inicio.

La exportación selecciona campos conocidos. No consulta ni incorpora claves o clientes del negocio; tampoco incluye el JSON pegado en el comprobador local. Los campos de nombre y versión son texto introducido por el usuario: no deben contener secretos. Descargar no guarda avances en el servidor. Las evidencias reales pueden documentarse en el flujo existente de Mi piloto; esta ficha no agrega un estado de conexión alternativo.

## Diferencias por método

**Loyverse.** PF ya tiene un conector de consulta periódica a API v1.0. Verifica que la moneda y precisión de la cuenta coincidan con la región configurada en PF, además de la tienda. GTQ usa dos decimales; CLP usa importes enteros. No se realizan conversiones. El código PF conserva `receipt_number` como `saleId` y `loyverse:{merchant_id}:{store_id}` como `source`; resuelve `customer_id` a `phone_number` y busca el teléfono dentro del negocio. Valida pagos y cantidades; los artículos fraccionarios no producen puntos por artículo. El token de acceso de Loyverse tiene permisos amplios: el uso lector del conector PF no convierte ese token en uno de solo lectura. [Referencia de API](https://developer.loyverse.com/docs/) y [tokens](https://help.loyverse.com/help/loyverse-api).

Loyverse guarda ventas sin sincronizar en el dispositivo y las envía al Back Office cuando recupera internet. PF las puede leer después. Las limitaciones offline incluyen devoluciones y edición o creación de clientes. La cola del POS es independiente de las funciones offline del navegador PF. [Documentación de trabajo sin conexión](https://help.loyverse.com/help/offline-work-of-pos).

**Odoo.** PF entrega ahora el módulo instalable `pf_pos_connector` **18.0.1.0.0**, únicamente para **Odoo 18.0** con acceso a módulos Python. En Conectar caja, seleccionar Odoo, alojamiento Odoo.sh/servidor propio y versión 18.0 para descargar el ZIP. [Guía de instalación, operación y límites](../integrations/odoo/pf_pos_connector/README.md). La ficha JSON sigue siendo preparación; el ZIP es el módulo real. Ambos permanecen pausados hasta activación explícita.

Se comprobó instalación y pruebas ORM en una base local desechable con la imagen oficial Community `18.0-20261102`. No se ha verificado una instancia del comercio, Odoo.sh ni Enterprise. **Odoo 19/20 y otras versiones no están cubiertas**: requieren adaptar y repetir las pruebas. Odoo Online no permite este módulo Python; Custom permite API externa pero no elimina ese límite. [Odoo Online](https://www.odoo.com/documentation/18.0/administration/maintain/odoo_online.html) y [API Odoo 19](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html).

El administrador configura compañía/caja, dominio HTTPS PF autorizado, slug, moneda esperada y clave POS. Moneda Odoo y PF deben coincidir, con dos decimales y sin FX. El cliente usa teléfono internacional. La instalación y los ajustes no llaman al proveedor. El módulo guarda ventas pagadas y devoluciones en la transacción Odoo y el cron estándar entrega después: `source = odoo:{database_uuid}:{company_id}:{pos_config_id}`; `saleId/refundId = pos.order:{id}`. Congela el JSON para reintentar con HMAC y deduplicar. Cinco registros por lote, diez intentos por ciclo, espera de hasta una hora, diagnósticos sin secretos y revisión explícita al agotarse.

Las ventas offline llegan primero al servidor Odoo; solo entonces existe una fila de esta cola. Pausar entregas continúa capturando tras la primera activación; no hay carga histórica. Las devoluciones completas requieren importe y todas las líneas originales; las parciales se registran en PF para revisión sin reversión proporcional. Las negativas sin vínculo original o ventas mezcladas con devoluciones quedan en revisión Odoo. Clones de base deben neutralizarse antes de arrancar: incluyen secretos y podrían conservar la identidad original.

**API genérica.** El integrador implementa transformación de ventas pagadas, moneda del negocio, teléfono, origen estable por instalación/sucursal, cola persistente y tratamiento de errores. El contrato no supone que un webhook de otro proveedor coincida con PF.

**CSV.** Importación revisada por lote; no sincronización continua. Se deben conservar los IDs al reimportar y coordinar con cualquier registro manual.

## Validación local y límites

El comprobador local acepta una venta ficticia con `saleId`, `source`, `customerPhone`, `amountQ`, `currency`, `status` e `items`. Valida estructura, límites y formato; rechaza campos adicionales. No llama a una API ni verifica cliente, pago, duplicados o conectividad. Después se usa la prueba existente de PF sin asignar puntos y, en un entorno autorizado, las pruebas de extremo a extremo.

Reintentar conserva `source + saleId` y todo el contenido. Las devoluciones usan `/refunds`, `refundId` y la relación con `originalSaleId`; no son ventas negativas. Las parciales o no verificadas requieren revisión. Una prueba de navegador no establece comportamiento de una caja o dispositivo nativo.

## Verificación local

```sh
node --test web/merchant/tests/pos-installation.test.js web/merchant/tests/pos-model.test.js web/merchant/tests/pilot.test.js
node web/merchant/tests/pos-installation-browser.spec.mjs
```

El navegador usa Vite, fixtures y API de demostración aislados. Comprueba opciones de proveedor y plan, versión obligatoria, descarga pausada, validación local, estado de cambios pendientes, pruebas existentes de venta, móvil, accesibilidad y protección de cambios concurrentes. No utiliza una cuenta POS, base de producción ni procesos nativos.


## Verificación y paquete del módulo Odoo

```sh
python3 -m unittest discover -s integrations/odoo/tests -v
python3 integrations/odoo/build_package.py --check
node --test tests/unit/odoo-connector-package.test.js
bash integrations/odoo/test_local.sh
```

`test_local.sh` usa Docker local, PostgreSQL y la imagen oficial de Odoo fijada por digest. Crea y elimina contenedores/base propios; no expone puertos y la red interna impide llamadas externas. La prueba de transporte usa respuestas ficticias y el contrato HMAC se compara con los validadores PF reales. No requiere claves reales. El ZIP reproducible se genera con `python3 integrations/odoo/build_package.py` y se sirve desde `/api/public/integrations/odoo/18/pf_pos_connector.zip`, con SHA-256 en la cabecera `X-Content-SHA256`.
