# Evidencia local — 2026-11-11

Módulo `18.0.3.0.0`, rama admitida Odoo 18.0. Imagen oficial Community `18.0-20261102`, digest `sha256:f61d3e36eb699e63557bbcdf4d7bd659e51418c326009e6574565d87e1d9026d`.

- `bash integrations/odoo/test_local.sh`: instalación nueva, **45 casos ORM, 0 fallos y 0 errores**, salida 0. Log: `/tmp/pf-cart-binding-fresh-verified.log`.
- `bash integrations/odoo/test_local.sh --upgrade`: instala el ZIP conservado `18.0.2.0.0` en PostgreSQL 16 desechable, actualiza con `-u pf_pos_connector` y ejecuta **45 casos ORM, 0 fallos y 0 errores**, salida 0. Log: `/tmp/pf-cart-binding-upgrade-verified.log`. El contador estadístico incluye seis pasos de preparación adicionales (51).
- Los diecisiete casos nuevos cubren preparación sin débito remoto, identidad y bytes de reintento, autorización y línea reales, rollback tras acuse, cancelación durable antes del HTTP, bloqueo del pago pendiente, cancelación remota anterior a autorización, protección de línea/cliente/impuestos/sucursal y UUID de carrito, rechazo de un UUID alterado antes de HTTP o pago, permisos, existencias por ubicación y cantidades pendientes, demanda normal del carrito, facturación después del movimiento de stock, publicación de catálogo/inventario y captura automática de evidencia sin HTTP al cobrar.
- Se mantienen los 28 casos anteriores: ventas/devoluciones, exclusión de recompensas de puntos ITEM, enlace manual, stock real o diferido, causalidad de eventos, versión original, acuses, rollback, pausa y revisión.
- `bash integrations/odoo/test_browser.sh`: **1 prueba HTTP/OWL real, 0 fallos y 0 errores**, salida 0, con Chromium y Odoo aislado. El recorrido abre la caja, identifica una tarjeta, selecciona una recompensa, conserva el intento tras respuesta incierta y recarga, reintenta la misma autorización, cobra una línea gratuita real y pierde intencionalmente la respuesta del pago y la primera consulta de estado. Comprueba que no aparece el recibo hasta confirmar el pago guardado. Después cancela otra recompensa en pantalla de 390×844. El servidor comprueba una evidencia/evento y un intento cancelado. Log: `/tmp/pf-cart-binding-browser-final.log`; evidencia: `/tmp/pf-odoo18-browser.cNoP3b/` (`confirmation-pending.png`, `receipt.png`, `cancel-mobile.png`, `odoo.log`). Los errores de conexión del log corresponden a las dos respuestas perdidas deliberadamente.
- `node --test tests/unit/odoo-checkout-flow.test.js tests/unit/odoo-connector-package.test.js`: **10 casos correctos**. Orden de RPCs separados, respuesta perdida, estado de recibo, JSON vacío de Odoo, ZIP fijado/SHA-256, bytes/HMAC Python y esquemas PF reales de autorización, cancelación, catálogo, existencias y eventos.
- `python3 -m unittest discover -s integrations/odoo/tests -v`: **8 casos correctos**, contratos y transporte.
- ESLint de los tres archivos de pruebas Node, sintaxis de los tres módulos OWL, compilación Python, sintaxis Bash y `build_package.py --check`: correctos.

Archivo: `dist/pf_pos_connector-18.0.3.0.0.zip` (58,196 bytes).
SHA-256: `491c272da3b782648b9863ea26bc4a605800846b1441795261ef8c56570aec59`.

Los logs finales y capturas también se conservan en `/var/lib/puntos/releases/reward-workspace-20261111/odoo-evidence/`.

Los ZIP anteriores se conservan como fixtures. La descarga pública ofrece `18.0.3.0.0`. El paquete incluye únicamente el addon; el adaptador de transporte simulado del navegador queda fuera del ZIP.

Los contenedores usan red Docker `--internal`, sin puertos publicados ni llamadas a PF o comercios reales. La aplicación Odoo, PostgreSQL, ORM, OWL y navegador son reales; el transporte hacia PF se simula dentro de la prueba. Los scripts eliminan contenedores, bases, volúmenes y redes al terminar. Los contratos de bytes se contrastan aparte con los normalizadores PF reales.

Límites: esto no certifica lectores físicos, cámara, caja offline, Enterprise, Odoo.sh, módulos de terceros, adquirente ni una instalación de comerciante. Las instantáneas no reservan inventario físico frente a ventas ordinarias; el adaptador vuelve a comprobar existencias locales e incluye el carrito y los intentos PF pendientes. Un recibo pagado no acredita por sí solo inventario terminado; los movimientos agrupados sin vínculo inequívoco conservan estado desconocido. No se restituyen puntos por tiempo de espera: se conserva el intento hasta confirmación o cancelación explícita autorizada. El piloto real requiere su propia aceptación. No se modificaron apps nativas ni se usaron builds de nube.
