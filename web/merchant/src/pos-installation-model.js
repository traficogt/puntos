import { receiptFromValues } from "./pos-model.js";

export const installationVendors = [
  { value: "loyverse", label: "Loyverse" }, { value: "odoo", label: "Odoo" }, { value: "other", label: "Otro sistema / por confirmar" },
];
export const installationDeployments = [
  { value: "unknown", label: "Por confirmar" }, { value: "online", label: "Odoo Online" },
  { value: "odoo_sh", label: "Odoo.sh" }, { value: "self_hosted", label: "Servidor del negocio / autohospedado" },
  { value: "cloud", label: "Otro servicio en la nube" }, { value: "local", label: "Equipo local" },
];
export const installationCapabilities = [
  { value: "unknown", label: "Necesito confirmarlo" }, { value: "api", label: "API o webhooks, con un integrador" },
  { value: "csv", label: "Exportar ventas por CSV" }, { value: "manual", label: "Registro manual en PF" },
];
export const installationPlans = [
  { value: "unknown", label: "Por confirmar" }, { value: "custom", label: "Custom" },
  { value: "standard", label: "Standard" }, { value: "free", label: "One App Free" },
];
const sources = {
  loyverse: [
    { title: "Loyverse: recibos y clientes", url: "https://developer.loyverse.com/docs/" },
    { title: "Loyverse: acceso con tokens", url: "https://help.loyverse.com/help/loyverse-api" },
    { title: "Loyverse: uso sin conexión", url: "https://help.loyverse.com/help/offline-work-of-pos" },
  ],
  odoo: [
    { title: "Odoo 19: API JSON-2 y planes", url: "https://www.odoo.com/documentation/19.0/developer/reference/external_api.html" },
    { title: "Odoo 18: API externa", url: "https://www.odoo.com/documentation/18.0/developer/reference/external_api.html" },
    { title: "Odoo.sh: módulos y límite de Odoo Online", url: "https://www.odoo.com/documentation/19.0/administration/odoo_sh/getting_started/create.html" },
  ],
};

function odooVersionNote(version = "") {
  const value = String(version).trim();
  if (/^19(?:\.|$)/.test(value)) return `Odoo ${value}: revisar JSON-2 y los modelos de la base en /doc. Los campos disponibles dependen de esa instalación.`;
  if (/^18(?:\.|$)/.test(value)) return `Odoo ${value}: revisar la API XML-RPC de la documentación 18.0. No asumir que un adaptador de 19 funciona en esta versión.`;
  return `Odoo ${value || "sin versión confirmada"}: confirmar la API y los modelos en la documentación de esa versión antes de desarrollar el adaptador.`;
}

export function installationPlan(profile = {}) {
  const { vendor = "other", capability = "unknown", deployment = "unknown", plan = "unknown", version = "" } = profile;
  if (vendor === "loyverse") return {
    mode: "loyverse", title: "Usa el conector de Loyverse",
    detail: "PF lee recibos por consulta periódica a Loyverse. Verifica la cuenta y revisa recibos antes de habilitar la sincronización; no requiere un adaptador genérico.",
    cashier: "Asocia el cliente al recibo en Loyverse; su teléfono debe coincidir con el registro de ese cliente en PF.",
    versionNote: `Registra la versión de Loyverse POS${version ? ` (${version})` : ""} y comprueba de nuevo el flujo cuando cambie. El conector usa la API v1.0.`,
    prerequisites: [
      "Cuenta de Loyverse con la moneda y precisión configuradas en PF, tienda correcta y token verificado en administración. El token de Loyverse tiene acceso amplio: no es una credencial de solo lectura.",
      "El recibo aporta customer_id; PF consulta el phone_number de ese cliente. Un nombre, correo o NIT no sustituye al teléfono inscrito en este negocio.",
      "PF conserva receipt_number como saleId y loyverse:{merchant_id}:{store_id} como source. No cambies esta identidad al reintentar.",
      "Comprueba pagos, recibos anulados, artículos por peso y devoluciones en la vista previa; las cantidades fraccionarias no suman puntos por artículo.",
    ],
    offline: "Loyverse guarda los recibos sin sincronizar en el dispositivo y los envía al Back Office al volver internet. PF solo puede leerlos después. Loyverse limita devoluciones y cambios de clientes sin conexión.",
    sources: sources.loyverse,
  };
  const odoo = vendor === "odoo";
  const prerequisites = odoo ? [
    "Confirma versión exacta, edición, alojamiento y responsable técnico. PF no incluye un módulo de Odoo 19 probado; el módulo instalable se limita a Odoo 18.0. Toda instancia del negocio requiere su propio piloto.",
    deployment === "online"
      ? "Odoo Online: el acceso a la API externa requiere el plan Custom; One App Free y Standard no lo incluyen. No presupongas que puedes instalar un módulo Python personalizado."
      : "Odoo.sh o un servidor propio pueden permitir un módulo; su compatibilidad, permisos y mantenimiento se deben comprobar en una instancia de pruebas de la misma versión.",
    "La moneda configurada debe coincidir entre Odoo y PF, con dos decimales y sin conversión. El cliente debe tener teléfono con código de país e inscripción en este negocio de PF.",
  ] : [
    "Pide al proveedor documentación, versión exacta, un ejemplo ficticio de venta pagada y el costo o permiso necesario para exportar datos.",
    "Confirma teléfono de cliente, importe en la moneda del negocio, estado pagado, cantidad entera de artículos y un identificador de venta que no cambie al reintentar.",
  ];
  const common = {
    versionNote: odoo ? odooVersionNote(version) : "Cada actualización del POS o del adaptador requiere repetir las pruebas con esa versión.",
    prerequisites, sources: odoo ? sources.odoo : [],
    offline: "El POS o su adaptador debe conservar una cola duradera y sus IDs, resolver errores y sincronizar al reconectar. Hay que probarlo en la instalación; la capacidad sin conexión del navegador de PF no lo demuestra.",
  };
  if (capability === "csv") return {
    ...common, mode: "csv", title: "Prepara una importación por archivo",
    detail: "Selecciona las columnas y revisa cada lote antes de importarlo. El CSV no sincroniza ventas continuamente y requiere una persona responsable de cada importación.",
    cashier: "Conserva el teléfono del cliente en la venta. El encargado exporta el lote y revisa duplicados antes de confirmarlo en PF.",
  };
  if (capability === "manual") return {
    ...common, mode: null, title: "Continúa con la caja de PF",
    detail: "Puedes identificar al cliente y registrar su compra en PF mientras el proveedor confirma si puede exportar o integrar ventas.",
    cashier: "Registra cada compra una sola vez; acuerda quién hará la carga si más adelante cambias de método.",
  };
  if (odoo && deployment === "online" && plan !== "custom") return {
    ...common, mode: null, title: "Confirma el plan de Odoo Online",
    detail: "La API externa de Odoo Online requiere Custom. Confirma el plan con el proveedor; si puedes exportar las ventas, puedes preparar CSV mientras tanto.",
    cashier: "Mantén el teléfono en la ficha del cliente. La elección de plan aún no confirma que PF esté recibiendo ventas.",
  };
  if (odoo && !["online", "odoo_sh", "self_hosted"].includes(deployment)) return {
    ...common, mode: null, title: "Confirma dónde está instalado Odoo",
    detail: "Odoo Online, Odoo.sh y un servidor propio permiten opciones distintas. Identifica el alojamiento antes de elegir API o un módulo.",
    cashier: "Mientras se confirma, puedes continuar registrando compras en PF.",
  };
  if (odoo && /^18\.0(?:$|[+.-])/.test(String(version).trim()) && ["odoo_sh", "self_hosted"].includes(deployment) && ["api", "unknown"].includes(capability)) return {
    ...common, mode: "api", title: "Instala el conector de Odoo 18.0",
    versionNote: `Odoo ${version}: el módulo se ejecuta en el servidor y no requiere XML-RPC. Compatible solo con la rama 18.0; completa el piloto de tu instalación.`,
    detail: "Descarga el módulo instalable de PF para Odoo 18.0. Guarda ventas pagadas y devoluciones en una cola del servidor y las entrega con firma. Incluye un asistente para vincular un canje PF ya realizado con una línea gratuita de un recibo completado; Odoo registra su inventario. Se instala pausado; tu administrador debe completar el piloto y activar los envíos.",
    cashier: "Selecciona al cliente con teléfono internacional en Odoo y confirma el pago. Revisa los recibos pendientes con el responsable; no vuelvas a registrar la compra manualmente en PF.",
    offline: "Odoo conserva las ventas pendientes en su POS cuando trabaja sin conexión. El módulo crea su cola cuando esas ventas llegan pagadas al servidor Odoo; después reintenta la entrega a PF. Debes probar también la reconexión de la caja.",
    addon: { version: "18.0.2.0.0", odooVersion: "18.0", downloadUrl: "/api/public/integrations/odoo/18/pf_pos_connector.zip", enabled: false },
  };
  if (capability === "api" || (odoo && capability === "unknown")) return {
    ...common, mode: "api", title: "Prepara un adaptador con tu integrador",
    detail: "Necesitas un adaptador o middleware que convierta las ventas al formato de PF. Tener API o webhooks no hace que el POS se conecte automáticamente.",
    cashier: "Identifica al cliente en tu POS. El adaptador debe enviar la venta solo después de confirmar su pago.",
  };
  return {
    ...common, mode: null, title: "Confirma cómo comparte ventas tu caja",
    detail: "Pide a tu proveedor un CSV de ejemplo o documentación de su API. Puedes preparar la ficha sin afirmar todavía que existe compatibilidad.",
    cashier: "Puedes continuar con el registro manual en PF mientras se define el método.",
  };
}

export function installationFixtures(region = {currency:"GTQ"}) {
  const sale = { saleId: "ejemplo-venta-001", source: "pos-ejemplo:sucursal-1", customerPhone: region.currency==="GTQ"?"55554444":"+50255554444", amountQ: 75, currency: region.currency, status: "paid", items: 2 };
  return { fictitious: true, sale, retry: { ...sale }, refund: { refundId: "ejemplo-devolucion-001", originalSaleId: sale.saleId, source: sale.source, amountQ: 75, currency: region.currency, scope: "full" } };
}

export function validateInstallationFixture(text, region = {currency:"GTQ",minorUnits:2}) {
  const fail = message => ({ valid: false, message });
  if (typeof text !== "string" || text.length > 20000) return fail("Usa un solo ejemplo JSON de hasta 20,000 caracteres.");
  let value;
  try { value = JSON.parse(text); } catch { return fail("El JSON no es válido. Revisa comillas, comas y llaves."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("Usa un objeto JSON con una sola venta ficticia.");
  const allowed = ["saleId", "source", "customerPhone", "amountQ", "currency", "status", "items"];
  if (Object.keys(value).some(key => !allowed.includes(key))) return fail("La muestra solo admite saleId, source, customerPhone, amountQ, currency, status e items. Quita otros campos y cualquier credencial.");
  if (value.currency !== region.currency) return fail(`La moneda de la muestra debe ser ${region.currency}.`);
  if(region.minorUnits===0&&!Number.isInteger(value.amountQ))return fail("Esta moneda requiere importes enteros.");
  if (["saleId", "source", "customerPhone"].some(key => typeof value[key] !== "string")) return fail("saleId, source y customerPhone deben ser texto.");
  try { receiptFromValues(value); } catch (error) { return fail(error.message); }
  return { valid: true, message: "Formato válido en este navegador. Esto no confirma al cliente, el pago real, los duplicados ni la conexión con tu POS. Continúa con la muestra en PF y las pruebas de aceptación." };
}

export function buildInstallationPackage(input, region = {currency:"GTQ"}) {
  const text = (value, label, required = false) => {
    if (typeof value !== "string" || value.length > 100 || /[\u0000-\u001f\u007f]/u.test(value) || (required && !value.trim()))
      throw new Error(`${label}: escribe un dato de hasta 100 caracteres, sin saltos de línea ni credenciales.`);
    return value.trim();
  };
  const select = (value, options, label) => {
    if (!options.some(option => option.value === value)) throw new Error(`Selecciona ${label}.`);
    return value;
  };
  const vendor = select(input.vendor, installationVendors, "el sistema POS");
  const profile = {
    vendor,
    name: vendor === "other" ? text(input.name || "", "Nombre del sistema", true) : installationVendors.find(option => option.value === vendor).label,
    version: text(input.version, "Versión del sistema", true),
    deployment: vendor === "loyverse" ? "cloud" : select(input.deployment || "unknown", installationDeployments, "el alojamiento"),
    capability: vendor === "loyverse" ? "api" : select(input.capability || "unknown", installationCapabilities, "cómo comparte ventas"),
    plan: vendor === "odoo" && input.deployment === "online" ? select(input.plan || "unknown", installationPlans, "el plan de Odoo Online") : "unknown",
  };
  const plan = installationPlan(profile);
  const acceptance = [
    ["mapping", "Integrador", "Documentar el campo real de teléfono, moneda del negocio, pago, sucursal e IDs de esta versión. Confirmar un responsable de mantenimiento."],
    ["preview", "Responsable del negocio", "Inscribir un cliente de prueba con autorización y comprobar una muestra en PF sin asignar puntos. Para Loyverse, verificar cuenta y vista previa de recibos; para CSV, revisar el lote."],
    ["purchase", "Integrador y negocio", "En el entorno autorizado, comprobar una venta pagada de extremo a extremo, su saldo y su registro. Conservar evidencia y fecha."],
    ["duplicate", "Integrador", "Reintentar exactamente source + saleId y contenido: no volver a sumar. Cambiar el contenido con el mismo ID debe detenerse para revisión."],
    ["offline", "Integrador", "Desconectar y reconectar el POS de prueba. Verificar cola duradera, mismos IDs, errores visibles y una sola aplicación de la venta."],
    ["refund", "Integrador y negocio", "Probar devolución completa, parcial, original ausente y reintento. Usar /refunds y revisar pendientes; no enviar ventas negativas ni asumir reversión proporcional."],
    ["pause", "Responsable del negocio", "Pausar la conexión, verificar el comportamiento de los envíos y documentar cómo reanudar la cola sin cambiar IDs ni perder ventas."],
    ["release", "Responsable del negocio", "Autorizar el inicio solo después de registrar fecha, responsable, evidencia y resultados del piloto. Repetir tras cambios de POS, adaptador o reglas."],
  ].map(([id, ownerRole, instruction]) => ({ id, ownerRole, instruction, version: profile.version, status: "pending" }));
  return {
    schema: "pf.pos-installation.v1", status: "preparation_only", profile,
    recommendation: { mode: plan.mode, title: plan.title, detail: plan.detail, versionNote: plan.versionNote },
    configurationTemplate: plan.mode ? { mode: plan.mode, enabled: false, automatic: false } : null,
    prerequisites: plan.prerequisites,
    ...(plan.addon ? { addon: plan.addon } : {}),
    contract: {
      saleEndpoint: "/api/public/pos/{slug-del-negocio}/sales", refundEndpoint: "/api/public/pos/{slug-del-negocio}/refunds",
      host: "Usar el dominio de la instalación PF confirmado en administración.",
      authentication: "Bearer o HMAC x-signature; obtener la clave en administración y guardarla fuera de este paquete.",
      identity: "Conservar source + saleId; para una devolución, source + originalSaleId y refundId estable.",
      customer: "El teléfono identifica a un cliente inscrito en ese negocio; customer_id del POS no es el ID del cliente PF.",
      refunds: "full solo al devolver todo el importe y todos los artículos, incluidos los gratuitos. partial y unknown requieren revisión; no hay cálculo proporcional automático.",
    },
    offline: { vendor: plan.offline, requirement: "Conservar source + saleId y contenido en una cola duradera del POS o middleware, con reintentos limitados y revisión de errores.", boundary: "La cola del POS es independiente del navegador sin conexión de PF; una prueba de navegador no certifica el comportamiento del POS." },
    fixtures: installationFixtures(region), acceptance, sources: plan.sources,
    limitations: ["Documento de preparación, no instalador ni credencial. No se ha contactado con el POS.", "Ningún paso está certificado. La descarga no guarda resultados en PF ni habilita una conexión.", "Los ejemplos son ficticios. No enviar a producción sin autorización y sin sustituirlos por datos de prueba controlados."],
  };
}
