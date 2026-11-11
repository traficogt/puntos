const day = 86400000;
const now = Date.now();
const customers = [
  "Ana · ejemplo",
  "Luis · ejemplo",
  "María · ejemplo",
  "Carlos · ejemplo",
  "Sofía · ejemplo",
].map((name, i) => ({
  id: `demo-person-${i}`,
  name,
  phone: "Número de ejemplo",
  last_purchase_at: new Date(now - (70 + i * 24) * day).toISOString(),
  recorded_sales_q: 900 - i * 110,
  purchases: 8 - i,
}));
const runs = [
  {
    id: "demo-recovery-prior",
    name: "Clientes de septiembre · ejemplo",
    notes: "Seguimiento de ejemplo. No corresponde a clientes reales.",
    created_at: new Date(now - 20 * day).toISOString(),
    member_count: 3,
    inactive_days: 30,
    members: customers.slice(0, 3).map((c, i) => ({
      ...c,
      customer_id: c.id,
      status: i < 2 ? "contacted" : "pending",
      contacted_at: i < 2 ? new Date(now - 18 * day).toISOString() : null,
      returned_at: i === 0 ? new Date(now - 12 * day).toISOString() : null,
      recorded_sales_after_contact_q: i === 0 ? 75 : 0,
    })),
  },
];
// The saved list keeps its historical snapshot; the current audience includes the later purchase.
customers[0].last_purchase_at = new Date(now - 12 * day).toISOString();
customers[0].recorded_sales_q += 75;
customers[0].purchases += 1;
runs.push({ id: "demo-recovery-growth", name: "Campaña de regreso · 40 clientes de ejemplo", notes: "Lista ficticia para probar campañas dirigidas.", created_at: new Date(now - day).toISOString(), member_count: 40, inactive_days: 30, members: Array.from({ length: 40 }, (_, i) => ({ ...customers[1], id: `demo-growth-person-${i}`, customer_id: `demo-growth-person-${i}`, name: `Cliente de ejemplo ${i + 1}`, status: "pending", contacted_at: null, returned_at: null, recorded_sales_after_contact_q: 0 })) });
const requests = new Map();
const summary = (r) => ({
  ...r,
  members: undefined,
  contacted_count: r.members.filter((m) => m.status === "contacted").length,
  returned_count: r.members.filter((m) => m.returned_at).length,
  recorded_sales_after_contact_q: r.members.reduce(
    (sum, m) => sum + m.recorded_sales_after_contact_q,
    0,
  ),
});
export function demoRecovery(url, options = {}) {
  const method = options.method || "GET",
    suffix = url.pathname.replace("/api/admin/analytics/recovery", "");
  const body = options.body ? JSON.parse(options.body) : {};
  const eligible = (days) =>
    customers.filter(
      (c) =>
        (now - new Date(c.last_purchase_at).getTime()) / day >= Number(days),
    );
  if (suffix === "/audience" && method === "GET") {
    const list = eligible(url.searchParams.get("inactive_days") || 30),
      offset = Number(url.searchParams.get("offset") || 0),
      limit = Number(url.searchParams.get("limit") || 10);
    return {
      total: list.length,
      customers: list.slice(offset, offset + limit),
    };
  }
  if (suffix === "/runs" && method === "GET")
    return { runs: runs.map(summary) };
  if (suffix === "/runs" && method === "POST") {
    const existing = requests.get(body.request_id);
    if (existing) {
      if (existing.payload !== JSON.stringify(body))
        throw new Error("Esta solicitud ya se usó con otros datos.");
      return { run: summary(existing.run) };
    }
    const members = eligible(body.inactive_days)
      .slice(0, body.limit)
      .map((c) => ({
        ...c,
        customer_id: c.id,
        status: "pending",
        contacted_at: null,
        returned_at: null,
        recorded_sales_after_contact_q: 0,
      }));
    if (!members.length)
      throw new Error("No hay clientes que cumplan este criterio.");
    const run = {
      ...body,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      member_count: members.length,
      members,
    };
    runs.unshift(run);
    requests.set(body.request_id, { payload: JSON.stringify(body), run });
    return { run: summary(run) };
  }
  const match = suffix.match(/^\/runs\/([^/]+)(?:\/members\/([^/]+))?$/);
  const run = match && runs.find((r) => r.id === match[1]);
  if (!run) throw new Error("No se encontró la lista de ejemplo.");
  if (!match[2] && method === "GET") {
    const offset = Number(url.searchParams.get("offset") || 0),
      limit = Number(url.searchParams.get("limit") || 25);
    return {
      run: summary(run),
      total: run.members.length,
      members: run.members.slice(offset, offset + limit),
    };
  }
  if (match[2] && method === "PATCH") {
    const m = run.members.find((v) => v.customer_id === match[2]);
    if (!m || !["contacted", "skipped"].includes(body.status))
      throw new Error("Seguimiento de ejemplo inválido.");
    if (body.status === "contacted" && body.contact_confirmed !== true)
      throw new Error("Confirma el contacto autorizado.");
    if (m.status !== "pending" && m.status !== body.status)
      throw new Error("Este seguimiento ya cambió. Actualiza la lista.");
    m.status = body.status;
    if (m.status === "contacted") m.contacted_at ||= new Date().toISOString();
    return { member: m };
  }
  throw new Error("Acción de ejemplo no disponible.");
}
