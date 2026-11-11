// Versions are historical contracts. Add a new version rather than changing old requirements.
/** @type {Array<[string,string,boolean,string?]>} */
const original = [
 ['enrollment','Inscripción del cliente',true],
 ['purchase','Compra y saldo de puntos',true],
 ['duplicate_receipt','Una venta repetida no duplica puntos',true],
 ['redemption','Canje de recompensa',true],
 ['refund','Devolución y ajuste del saldo',true],
 ['offline_reconnect','Trabajo sin conexión y sincronización',true],
 ['wallet_installation','Instalación y actualización de Wallet',false],
 ['message_delivery','Mensaje recibido con consentimiento',false],
 ['pos_installation','Venta desde el POS conectado',false],
];
/** @type {Array<[string,string,boolean,string?]>} */
const fulfillment = [
 ['fulfillment_recording','Entrega y registro de la recompensa',true,'Comprueba la entrega y su estado de registro en PF. Si usas POS, enlaza el recibo y la línea correctos sin volver a descontar puntos ni mover inventario.'],
 ['manual_recording','Registro manual o entrega sin POS',true,'Comprueba la referencia de recibo declarada por el equipo o el cierre explícito sin POS. El registro manual no acredita inventario verificado.'],
 ['fulfillment_retry','Reintento sin duplicar la entrega',true,'Repite la misma solicitud de registro: debe conservar un solo resultado y la misma referencia. Comprueba que otro registro no pueda reutilizar la entrega.'],
 ['fulfillment_cancellation','Cancelación y revisión del canje',true,'Comprueba una devolución o cancelación y su revisión. El estado del registro no restaura puntos ni inventario; verifica por separado el procedimiento de recuperación.'],
];
export const currentPilotChecklistVersion = 2;
export function pilotChecksForVersion(version) {
  if (version !== 1 && version !== 2) throw new Error('Versión de pruebas no reconocida.');
  return [...original, ...(version === 2 ? fulfillment : [])].map(([key,label,required,instruction])=>({key,label,required,...(instruction?{instruction}:{})}));
}
