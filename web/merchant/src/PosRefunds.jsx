import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Group, Modal, Paper, Select, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { api, isDemo, useResource } from "./api.js";
import { BusinessLink, Failure, Loading, money, number } from "./ui.jsx";

const base = "/api/admin/pos/refunds";
const reviewedReasons = new Set(["partial_refund", "scope_unverified", "amount_mismatch", "ambiguous_original"]);

export default function PosRefunds() {
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState("pending");
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const resource = useResource(`${base}${filter === "all" ? "" : `?status=${filter}`}`, refresh);
  const data = resource.data;

  async function retry() {
    if (!selected || busy) return;
    setBusy(true); setError(""); setNotice(null);
    try {
      const result = await api(`${base}/${encodeURIComponent(selected.id)}/retry`, { method: "POST", body: "{}" });
      if (!alive.current) return;
      if (!result?.refund || !["pending", "reconciled"].includes(result.refund.status)) throw new Error("No se pudo confirmar el resultado de la conciliación.");
      setNotice(result.refund);
      setSelected(null);
      setRefresh(value => value + 1);
    } catch (failure) { if (alive.current && failure.name !== "AbortError") setError(failure.message || "No se pudo completar la comprobación."); }
    finally { if (alive.current) setBusy(false); }
  }

  return <section aria-labelledby="pos-refunds-title"><Stack gap="lg">
    <div><Title order={2} id="pos-refunds-title">Devoluciones y conciliación</Title>
      <Text mt="sm" maw={780}>Comprueba qué devoluciones de tu caja tienen una reversión de puntos en PF y cuáles requieren revisión. Los importes devueltos se procesan en tu caja.</Text></div>
    {isDemo && <Text size="sm" c="dimmed">Recibos ficticios para explorar la conciliación. No representan compras ni devoluciones reales.</Text>}
    <Alert color="gray" title="Las devoluciones parciales requieren revisión"><Text size="sm">PF solo revierte automáticamente una devolución completa comprobada. En Loyverse se contrastan los artículos con el recibo original; otro proveedor debe declarar que devolvió todos los artículos e importes. No basta con que coincidan los totales, ni se calculan puntos proporcionales. Revisa el recibo y el historial; no anules toda la compra para resolver una devolución parcial.</Text></Alert>
    <Group justify="space-between" align="end">
      <Select label="Devoluciones que quieres revisar" value={filter} onChange={value => { setFilter(value || "pending"); setNotice(null); }} allowDeselect={false} disabled={busy} data={[{ value: "pending", label: "Requieren revisión" }, { value: "reconciled", label: "Conciliadas" }, { value: "all", label: "Todas" }]} maw={320} />
      <Button variant="subtle" onClick={() => setRefresh(value => value + 1)} disabled={resource.loading || busy}>Actualizar devoluciones</Button>
    </Group>
    {notice && <Alert color={notice.status === "reconciled" ? "teal" : "yellow"} title={notice.status === "reconciled" ? "Reversión comprobada en el historial." : "La devolución sigue pendiente."} role="status"><Text size="sm">{notice.message}</Text></Alert>}
    {error && !selected && <Alert color="red" role="alert">{error}</Alert>}
    {resource.loading ? <Loading label="Cargando devoluciones recibidas…" /> : resource.error ? <Failure error={resource.error} retry={() => setRefresh(value => value + 1)} /> : !data?.summary || !Array.isArray(data.refunds) ? <Failure error={new Error("Respuesta incompleta")} retry={() => setRefresh(value => value + 1)} /> : <>
      <SimpleGrid cols={{ base: 1, xs: 3 }}>
        {[["Recibos recibidos", data.summary.total], ["Requieren revisión", data.summary.pending], ["Reversiones comprobadas", data.summary.reconciled]].map(([label, value]) => <div key={label}><Text size="sm" c="dimmed">{label}</Text><Text size="xl" fw={600}>{number(value)}</Text></div>)}
      </SimpleGrid>
      <Text size="sm" c="dimmed">Conteos de todos los recibos recibidos en PF. Se muestran hasta {data.limit || 50} recibos recientes del filtro elegido; no verifican las devoluciones que tu caja aún no ha enviado.</Text>
      {!data.refunds.length ? <Paper withBorder p="lg"><Text fw={600}>{data.summary.total === 0 ? "Todavía no se han recibido devoluciones" : "No hay devoluciones en este filtro"}</Text><Text mt="xs" size="sm">Loyverse las incorpora durante la sincronización. Para otra caja, el proveedor debe enviar también el ID de la venta original y el mismo origen usado al registrar la compra.</Text></Paper> : <Stack gap="sm">{data.refunds.map(row => <Paper key={row.id} withBorder p="md" component="article" aria-label={`Devolución ${row.refund_id}`}>
        <Group justify="space-between" align="start"><div><Text fw={600} style={{ overflowWrap: "anywhere" }}>{row.refund_id}</Text><Text size="sm" c="dimmed" style={{ overflowWrap: "anywhere" }}>Venta original: {row.original_sale_id}</Text></div><Group gap="sm"><Text fw={600}>{money(row.amount_q)}</Text><Badge color={row.status === "reconciled" ? "teal" : "yellow"} variant="light">{row.status === "reconciled" ? "Conciliada" : "Requiere revisión"}</Badge></Group></Group>
        <Text size="sm" mt="sm" style={{ overflowWrap: "anywhere" }}>Origen: {row.source}</Text>
        <Text size="sm" mt="xs">{row.message}</Text>
        {row.original_transaction_id && <Text size="xs" c="dimmed" mt="sm" style={{ overflowWrap: "anywhere" }}>Movimiento original: {row.original_transaction_id}</Text>}
        {row.reversal_transaction_id && <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>Reversión comprobada: {row.reversal_transaction_id}</Text>}
        {row.status === "pending" && <Button mt="md" variant="default" disabled={busy || reviewedReasons.has(row.reason)} aria-label={row.reason === "partial_refund" ? "Revisión de devolución parcial" : `Comprobar ${row.refund_id} de nuevo`} onClick={() => { setSelected(row); setError(""); }}>{reviewedReasons.has(row.reason) ? "Revisar recibo e historial" : "Comprobar de nuevo"}</Button>}
      </Paper>)}</Stack>}
    </>}
    <BusinessLink href="/administracion/?seccion=analisis">Abrir historial y auditoría en administración</BusinessLink>
    <Modal opened={!!selected} onClose={() => { if (!busy) { setSelected(null); setError(""); } }} title="Reintentar conciliación" centered closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}>
      <Stack><Text>PF volverá a comprobar la devolución {selected?.refund_id}. Si encuentra una devolución completa válida, revertirá los puntos de la compra y sus beneficios según la política del negocio.</Text><Text size="sm" c="dimmed">Reintentar conserva el recibo recibido. No corrige importes ni convierte una devolución parcial en completa.</Text>{error && <Alert color="red" role="alert">{error}</Alert>}<Group justify="end"><Button variant="subtle" disabled={busy} onClick={() => setSelected(null)}>Cancelar</Button><Button loading={busy} onClick={retry}>Reintentar ahora</Button></Group></Stack>
    </Modal>
  </Stack></section>;
}
