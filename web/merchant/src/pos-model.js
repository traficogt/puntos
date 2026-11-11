export const connectionModes = [
  { value: "loyverse", label: "Loyverse" },
  { value: "csv", label: "Archivo de ventas (CSV)" },
  { value: "api", label: "Integración por API" },
];

export function recommendConnection(vendor, capability) {
  if (vendor === "loyverse") return {
    mode: "loyverse", title: "Conexión disponible con Loyverse",
    detail: "PF puede leer los recibos de tu cuenta de Loyverse. Primero verifica que la cuenta use la moneda de tu negocio y que sus clientes tengan teléfono; después puedes habilitar la sincronización automática.",
    cashier: "El cajero asocia el cliente a la venta en Loyverse. PF obtiene el importe y busca el mismo teléfono en tu programa.",
  };
  if (capability === "csv") return {
    mode: "csv", title: "Importa ventas por archivo",
    detail: "Si tu caja exporta CSV, puedes seleccionar sus columnas y revisar cada lote antes de importarlo. Se necesitan ID de venta, teléfono, importe en la moneda del negocio y estado de pago.",
    cashier: "El cajero conserva el teléfono en la venta. Una persona encargada importa el lote; no necesita volver a escribir cada importe en PF.",
  };
  if (capability === "api") return {
    mode: "api", title: "Necesitas un adaptador para tu caja",
    detail: "PF recibe ventas con su propio formato por API. Que tu caja tenga API o webhooks no confirma compatibilidad: tu proveedor debe preparar un adaptador que envíe ese formato.",
    cashier: "El adaptador envía el importe y el teléfono tras el pago. El cajero identifica al cliente en la caja, sin registrar la compra otra vez en PF.",
  };
  return {
    mode: null, title: "Confirma primero cómo exporta ventas tu caja",
    detail: "Pregunta al proveedor si puede entregar un CSV o enviar ventas pagadas con ID, teléfono e importe. Si no dispone de estas opciones, puedes seguir registrando compras desde la caja de PF.",
    cashier: "Con el registro manual, el cajero identifica al cliente y registra su compra en PF.",
  };
}

export function connectionValues(integration) {
  if (!integration || !connectionModes.some(m => m.value === integration.mode) || typeof integration.enabled !== "boolean" || typeof integration.automatic !== "boolean")
    throw new Error("La configuración necesita una revisión en administración.");
  return { mode: integration.mode, enabled: integration.enabled, automatic: integration.automatic };
}

export function connectionSnapshot(integration) {
  return JSON.stringify({ ...connectionValues(integration),
    configured: Boolean(integration.loyverse?.configured),
    merchant: integration.loyverse?.merchant_id || null,
    store: integration.loyverse?.store_id || null,
  });
}

export function configurationPayload(values, integration) {
  const next = connectionValues(values);
  if (next.enabled && next.mode === "loyverse" && !integration.loyverse?.configured)
    throw new Error("Conecta y verifica tu cuenta de Loyverse en administración antes de habilitarla.");
  return next;
}

export function receiptFromValues(values, region = {currency:"GTQ",minorUnits:2}) {
  const saleId = values.saleId?.trim(), source = values.source?.trim(), customerPhone = values.customerPhone?.trim();
  if (!saleId || saleId.length > 200 || /[\u0000-\u001f\u007f]/u.test(saleId)) throw new Error("Escribe el ID de la venta, de hasta 200 caracteres.");
  if (!source || !/^[\p{L}\p{N} ._:-]{1,180}$/u.test(source)) throw new Error("Escribe un origen de hasta 180 caracteres con letras, números, espacios, puntos o guiones.");
  if (!customerPhone || customerPhone.length > 40 || !/^[+\d\s().-]+$/.test(customerPhone) || !/^\d{8,15}$/.test(customerPhone.replace(/\D/g, ""))) throw new Error("Escribe el teléfono que aparece en la venta: de 8 a 15 dígitos.");
  if (typeof values.amountQ !== "number" || !Number.isFinite(values.amountQ) || values.amountQ < 0 || values.amountQ > 99999999.99 || Math.abs(values.amountQ * 100 - Math.round(values.amountQ * 100)) > 0.00001) throw new Error("El importe debe estar entre 0 y 99,999,999.99, con hasta dos decimales.");
  if (!Number.isInteger(values.items) || values.items < 0 || values.items > 2147483647) throw new Error("Escribe una cantidad entera de artículos entre 0 y 2,147,483,647.");
  if (!["paid", "completed"].includes(values.status)) throw new Error("La muestra debe corresponder a una venta pagada o completada.");
  if(region.minorUnits===0&&!Number.isInteger(values.amountQ))throw new Error("Esta moneda requiere importes enteros.");
  return { saleId, source, customerPhone, amountQ: values.amountQ, items: values.items, status: values.status, currency: region.currency };
}
