import {merchantRegion} from './region.js';
const clean=value=>String(value||'Por confirmar').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,100);
export function buildPosHandoff({vendor,version,deployment,capability,installation},region=merchantRegion()){
 const currency=region.currency;
 return `PuntosFieles · Ficha para conectar un punto de venta

Sistema: ${clean(vendor)}
Versión: ${clean(version)}
Instalación: ${clean(deployment)}
Método disponible: ${clean(capability)}

INFORMACIÓN PARA SOLICITAR AL PROVEEDOR
- Documentación de API/webhooks o CSV de ejemplo con datos ficticios.
- Cuenta de pruebas, permisos mínimos y costo del acceso API.
- Cómo identifica al cliente en cada venta: PF relaciona el teléfono registrado en el negocio.
- ID estable de venta, fecha, importe pagado en ${currency}, estado pagado/completado y cantidad entera de artículos.
- Cómo representa anulaciones, devoluciones totales/parciales y reconexión tras trabajar sin internet.
- Identificador de sucursal, zona horaria y responsable de mantener el adaptador.

CONEXIONES ACTUALES
Loyverse: lectura de recibos con token, moneda ${currency} e identificación del cliente; completar configuración y pruebas en PF.
CSV: seleccionar columnas, revisar e importar cada lote. No es sincronización continua.
API/webhooks: un adaptador debe convertir la venta al contrato PF. Tener una API no garantiza compatibilidad automática.

CONTRATO DE VENTA
POST https://app.puntosfieles.com/api/public/pos/{slug-del-negocio}/sales
Autenticación Bearer o firma HMAC x-signature, preparada por el responsable; no adjuntar claves a esta ficha.
Ejemplo ficticio:
${JSON.stringify({saleId:'ejemplo-venta-001',source:'nombre-del-pos',customerPhone:'telefono-registrado-en-PF',amountQ:75,currency,status:'paid',items:2},null,2)}

CONTRATO DE DEVOLUCIÓN
POST https://app.puntosfieles.com/api/public/pos/{slug-del-negocio}/refunds
Misma autenticación que las ventas. La devolución identifica la venta original por source + originalSaleId; no por teléfono.
${JSON.stringify({refundId:'ejemplo-devolucion-001',originalSaleId:'ejemplo-venta-001',source:'nombre-del-pos',amountQ:75,currency,scope:'full'},null,2)}
scope: full solo cuando se devuelve todo el dinero y todos los artículos, incluidos los gratuitos; partial para una devolución parcial; unknown si no se puede confirmar.
PF concilia automáticamente una devolución completa verificada si la venta original y el saldo lo permiten. Las parciales, las no verificadas y las que requieren revisión quedan pendientes en Conectar caja. No calcula puntos proporcionales ni marca esos casos como resueltos.
Repetir un ID con el mismo contenido no revierte dos veces. Conserva el ID y la relación con la venta original también al trabajar sin conexión.

PRUEBAS DE ACEPTACIÓN
1. Registrar al cliente en PF y asociarlo a la venta.
2. Comprobar una muestra en Conectar caja antes de enviar ventas reales.
3. Confirmar una venta autorizada, su saldo y su registro.
4. Repetir exactamente el mismo ID y contenido: resultado original sin sumar puntos otra vez. Un mismo ID con datos cambiados debe detenerse para revisión.
5. Conservar IDs durante desconexiones; sincronizar solo ventas pagadas, con reintentos limitados y revisión de errores.
6. Probar devolución completa, devolución parcial, venta original aún no sincronizada y reintento del mismo ID. Revisar el estado real en Conectar caja. El endpoint de ventas no recibe devoluciones: usar /refunds. No enviar importes negativos como ventas.
7. Confirmar Wallet y un mensaje con consentimiento en un dispositivo real, si esos canales participan.
8. Registrar fecha, responsable y resultado en Mi piloto. Esta ficha no certifica que la instalación esté terminada.

ENTREGA SEGURA
Comparte sin credenciales ni datos personales. Entrega claves por un canal seguro. No actives campañas reales durante las pruebas sin autorización del negocio.
${installation?.schema === 'pf.pos-installation.v1' ? `
REQUISITOS DE ESTA INSTALACIÓN
${installation.recommendation.title}
${installation.recommendation.detail}
${installation.recommendation.versionNote}
${installation.prerequisites.map(item=>`- ${item}`).join('\n')}

COLA Y RECONEXIÓN
${installation.offline.vendor}
${installation.offline.requirement}
${installation.offline.boundary}

ACEPTACIÓN PARA ESTA VERSIÓN — SIN CERTIFICAR
${installation.acceptance.map(step=>`PENDIENTE · ${step.version} · ${step.ownerRole}: ${step.instruction}`).join('\n')}

FUENTES DEL PROVEEDOR
${installation.sources.map(source=>`${source.title}: ${source.url}`).join('\n')}

La configuración del paquete JSON está pausada. Descargar esta ficha no instala un adaptador, guarda resultados ni confirma una conexión.
` : ''}
`;
}
export function downloadPosHandoff(values){const text=buildPosHandoff(values),url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='ficha-conexion-pos-puntosfieles.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
