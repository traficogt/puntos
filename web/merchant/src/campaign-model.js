const ruleKeys = new Set([
  "id",
  "name",
  "active",
  "kind",
  "value",
  "max_points",
  "program_type",
  "condition",
]);
const conditionKeys = new Set([
  "weekdays",
  "min_amount_q",
  "min_visits",
  "min_items",
  "start_hour",
  "end_hour",
]);
const absent = (value) => value === "" || value === undefined || value === null;
export function editableRules(rules) {
  if (
    !Array.isArray(rules) ||
    rules.some(
      (rule) =>
        !rule ||
        typeof rule !== "object" ||
        Array.isArray(rule) ||
        typeof rule.name !== "string" ||
        (rule.program_type !== undefined &&
          !["SPEND", "VISIT", "ITEM"].includes(rule.program_type)) ||
        (rule.active !== undefined && typeof rule.active !== "boolean") ||
        (rule.id !== undefined && typeof rule.id !== "string") ||
        (rule.max_points !== undefined && typeof rule.max_points !== "number") ||
        !Number.isFinite(rule.value) ||
        rule.value <= 0 ||
        Object.keys(rule).some((key) => !ruleKeys.has(key)) ||
        !["multiplier", "bonus_points"].includes(rule.kind) ||
        (rule.condition !== undefined &&
          (!rule.condition || typeof rule.condition !== "object" ||
            Array.isArray(rule.condition) ||
            Object.keys(rule.condition).some(
              (key) => !conditionKeys.has(key) || (key === "weekdays" ? !Array.isArray(rule.condition[key]) : typeof rule.condition[key] !== "number"),
            ))),
    )
  ) {
    throw new Error(
      "Hay reglas que requieren la configuración avanzada. No se modificó ninguna campaña.",
    );
  }
  if (validateRules(rules))
    throw new Error(
      "Hay valores que requieren la configuración avanzada. No se modificó ninguna campaña.",
    );
  return structuredClone(rules).map((rule) => ({
    ...rule,
    condition: rule.condition || {},
  }));
}
export function serializeRules(rules) {
  return rules.map((rule) => {
    const out = {
      ...rule,
      name: rule.name.trim(),
      condition: { ...rule.condition },
    };
    for (const key of ["max_points", "program_type"])
      if (absent(out[key])) delete out[key];
    for (const key of Object.keys(out.condition))
      if (absent(out.condition[key])) delete out.condition[key];
    if (!out.condition.weekdays?.length) delete out.condition.weekdays;
    if (!Object.keys(out.condition).length) delete out.condition;
    return out;
  });
}
export function validateRules(rules) {
  if (rules.length > 100) return "Puedes guardar hasta 100 campañas.";
  for (let index = 0; index < rules.length; index++) {
    const r = rules[index],
      prefix = `Campaña ${index + 1}: `;
    if (!r.name?.trim() || r.name.trim().length > 120)
      return prefix + "escribe un nombre de hasta 120 caracteres.";
    if (!Number.isFinite(r.value) || r.value <= 0)
      return prefix + "el beneficio debe ser mayor que cero.";
    if (
      !absent(r.max_points) &&
      (!Number.isFinite(r.max_points) || r.max_points < 0)
    )
      return prefix + "el límite no puede ser negativo.";
    const c = r.condition || {};
    for (const key of ["min_amount_q", "min_visits", "min_items"])
      if (!absent(c[key]) && (!Number.isFinite(c[key]) || c[key] < 0))
        return (
          prefix +
          "revisa los mínimos: deben ser números válidos, sin negativos."
        );
    for (const key of ["start_hour", "end_hour"])
      if (
        !absent(c[key]) &&
        (!Number.isInteger(c[key]) || c[key] < 0 || c[key] > 23)
      )
        return prefix + "usa horas enteras de 0 a 23.";
    if (
      !absent(c.start_hour) &&
      !absent(c.end_hour) &&
      c.start_hour > c.end_hour
    )
      return (
        prefix +
        "la hora final debe ser igual o posterior a la inicial; divide los horarios nocturnos en dos campañas."
      );
    if (
      c.weekdays &&
      (!Array.isArray(c.weekdays) ||
        c.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
    )
      return prefix + "revisa los días seleccionados.";
  }
  return "";
}
export function campaignTemplate(kind) {
  return {
    name:
      kind === "weekend" ? "Doble puntos el fin de semana" : "Bono por compra",
    active: false,
    kind: kind === "weekend" ? "multiplier" : "bonus_points",
    value: kind === "weekend" ? 2 : 10,
    condition:
      kind === "weekend" ? { weekdays: [0, 6] } : { min_amount_q: 100 },
  };
}
