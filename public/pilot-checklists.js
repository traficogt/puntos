// Versions are historical contracts. Add a new version rather than changing old requirements.
/** @type {Array<[string,string,boolean,string?]>} */
const original = [
  ["enrollment", "Inscripción del cliente", true],
  ["purchase", "Compra y saldo de puntos", true],
  ["duplicate_receipt", "Una venta repetida no duplica puntos", true],
  ["redemption", "Canje de recompensa", true],
  ["refund", "Devolución y ajuste del saldo", true],
  ["offline_reconnect", "Trabajo sin conexión y sincronización", true],
  ["wallet_installation", "Instalación y actualización de Wallet", false],
  ["message_delivery", "Mensaje recibido con consentimiento", false],
  ["pos_installation", "Venta desde el POS conectado", false],
];
/** @type {Array<[string,string,boolean,string?]>} */
const fulfillment = [
  [
    "fulfillment_recording",
    "Entrega y registro de la recompensa",
    true,
    "Comprueba la entrega y su estado de registro en PF. Si usas POS, enlaza el recibo y la línea correctos sin volver a descontar puntos ni mover inventario.",
  ],
  [
    "manual_recording",
    "Registro manual o entrega sin POS",
    true,
    "Comprueba la referencia de recibo declarada por el equipo o el cierre explícito sin POS. El registro manual no acredita inventario verificado.",
  ],
  [
    "fulfillment_retry",
    "Reintento sin duplicar la entrega",
    true,
    "Repite la misma solicitud de registro: debe conservar un solo resultado y la misma referencia. Comprueba que otro registro no pueda reutilizar la entrega.",
  ],
  [
    "fulfillment_cancellation",
    "Cancelación y revisión del canje",
    true,
    "Comprueba una devolución o cancelación y su revisión. El estado del registro no restaura puntos ni inventario; verifica por separado el procedimiento de recuperación.",
  ],
];
export const currentPilotChecklistVersion = 3;
export const allPilotCapabilities = Object.freeze({
  wallet: true,
  promotional_messaging: true,
  pos: true,
});
/** @type {Record<string, string>} */
const capabilityChecks = {
  wallet_installation: "wallet",
  message_delivery: "promotional_messaging",
  pos_installation: "pos",
};
/** @type {Record<string, string>} */
const capabilityInstructions = {
  wallet_installation:
    "Instala y actualiza la tarjeta en un dispositivo compatible. Registra lo que observaste en el dispositivo; la lista no comprueba esta instalación automáticamente.",
  message_delivery:
    "Comprueba la recepción de un mensaje promocional en una cuenta de prueba con consentimiento promocional vigente. La aceptación del envío por PF o el proveedor no demuestra la recepción. Verificar el teléfono no concede consentimiento promocional.",
  pos_installation:
    "Registra una venta desde el POS y comprueba el resultado en PF con el sistema y las versiones indicados en este piloto.",
};
/**
 * @param {number} version
 * @param {Record<string, boolean> | null} [capabilities] Required from checklist version 3 on.
 */
export function pilotChecksForVersion(version, capabilities = null) {
  if (![1, 2, 3].includes(version)) throw new Error("Versión de pruebas no reconocida.");
  const checks = [...original, ...(version >= 2 ? fulfillment : [])].map(
    ([key, label, required, instruction]) => ({
      key,
      label,
      required,
      ...(instruction ? { instruction } : {}),
    }),
  );
  if (version < 3) return checks;
  if (
    !capabilities ||
    Object.keys(allPilotCapabilities).some((key) => typeof capabilities[key] !== "boolean")
  )
    throw new Error("Falta la configuración de canales del piloto.");
  const selected = checks
    .filter((c) => !capabilityChecks[c.key] || capabilities[capabilityChecks[c.key]])
    .map((c) => ({
      ...c,
      required: true,
      ...(capabilityChecks[c.key] ? { instruction: capabilityInstructions[c.key] } : {}),
      ...(c.key === "message_delivery"
        ? { label: "Mensaje promocional recibido con consentimiento" }
        : {}),
    }));
  selected.splice(1, 0, {
    key: "phone_ownership",
    label: "Titularidad del teléfono del cliente",
    required: true,
    instruction:
      "Completa la verificación del teléfono con una cuenta de prueba y comprueba el rechazo de un código incorrecto o vencido. Esta verificación no concede consentimiento promocional.",
  });
  return selected;
}
/**
 * A stored checklist declaration; older rows name the check through `check_key`.
 * @typedef {{ key?: string | null, check_key?: string | null, status?: string | null }} PilotCheckRecord
 */
/**
 * Counts stored declarations only. It does not verify a device, provider or integration.
 * @param {number} version
 * @param {Record<string, boolean> | null} capabilities
 * @param {PilotCheckRecord[]} records
 */
export function pilotChecklistCompleteness(version, capabilities, records) {
  const definitions = pilotChecksForVersion(version, capabilities);
  /** @param {string} key */
  const passed = (key) =>
    records.some((r) => (r.key ?? r.check_key) === key && r.status === "passed");
  return {
    required_total: definitions.filter((c) => c.required).length,
    required_passed: definitions.filter((c) => c.required && passed(c.key)).length,
    unresolved_checks: definitions
      .filter(
        (c) =>
          !passed(c.key) &&
          !(
            !c.required &&
            records.some((r) => (r.key ?? r.check_key) === c.key && r.status === "not_applicable")
          ),
      )
      .map((c) => c.key),
    complete: definitions.every(
      (c) =>
        passed(c.key) ||
        (!c.required &&
          records.some((r) => (r.key ?? r.check_key) === c.key && r.status === "not_applicable")),
    ),
  };
}
