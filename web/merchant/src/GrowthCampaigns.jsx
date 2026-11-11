import { CampaignResults } from './CampaignResults.jsx';
import { merchantRegion, regionalDate } from "./region.js";
import QuietOfferFields from "./QuietOfferFields.jsx";
import BulkCampaignPreparation from "./BulkCampaignPreparation.jsx";
import CampaignPreflight from "./CampaignPreflight.jsx";
import CampaignAudiencePreview from "./CampaignAudiencePreview.jsx";
import OfferCostPreview from "./OfferCostPreview.jsx";
import { audienceDescription } from "./audience-model.js";
import { useEffect, useRef, useState } from "react";
import { Alert, Anchor, Badge, Button, Checkbox, Group, NumberInput, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { api, isDemo, useResource } from "./api.js";
import { Failure, Loading, Locked, money, number } from "./ui.jsx";
const base = "/api/admin/growth-campaigns";
const labels = { draft: "Borrador", active: "Activa", paused: "Pausada" };
const date = value => value ? regionalDate(value) : "Al activar";
export default function GrowthCampaigns({ features, onDirty }) {
  return features.campaign_rules && features.analytics ? <Workspace onDirty={onDirty} /> : <Locked feature="Campañas dirigidas" />;
}
function Workspace({ onDirty }) {
  const [version, setVersion] = useState(0), [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const alive = useRef(true), request = useRef({ signature: "", id: crypto.randomUUID() });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const form = useForm({ initialValues: { offer_kind: "experiment", duration_minutes: "60", name: "", audience_source: "recovery", audience_segment_id: "", audience_limit: 200, recovery_run_id: "", bonus_points: 50, minimum_purchase_q: 50, duration_days: "14", holdout_percent: "20", estimated_cost_per_point_q: "", points_budget: "" }, validate: {
    name: v => v.trim().length > 0 && v.trim().length <= 100 ? null : "Escribe un nombre de hasta 100 caracteres.",
    recovery_run_id: (v, values) => values.audience_source !== "recovery" || v ? null : "Selecciona una lista guardada.",
    audience_segment_id: (v, values) => values.audience_source !== "segment" || v ? null : "Selecciona una audiencia guardada.",
    audience_limit: (v, values) => values.audience_source !== "segment" || (Number.isInteger(v) && v >= (values.offer_kind === "quiet" ? 1 : 10) && v <= (values.offer_kind === "quiet" ? 200 : 5000)) ? null : "Revisa el límite: hasta 200 clientes en una oferta breve o 5,000 en una campaña.",
    bonus_points: v => Number.isInteger(v) && v >= 1 && v <= 10000 ? null : "Usa entre 1 y 10,000 puntos enteros.",
    points_budget: (v, values) => (v === "" && values.offer_kind !== "quiet") || (Number.isInteger(v) && v >= values.bonus_points && v <= 2000000) ? null : "El límite debe cubrir al menos una bonificación y no superar 2,000,000 de puntos.",
    minimum_purchase_q: v => typeof v === "number" && v >= 0 && v <= 999999.99 ? null : "Escribe un monto válido.",
    estimated_cost_per_point_q: v => v === "" || (typeof v === "number" && v >= 0 && v <= 100) ? null : "Usa un costo entre 0 y 100 en la moneda del negocio."
  }});
  const quiet = form.values.offer_kind === "quiet";
  const [messagePending, setMessagePending] = useState(false);
  const [audienceEstimate, setAudienceEstimate] = useState(null);
  const dirty = form.isDirty() || messagePending;
  useEffect(() => { onDirty(dirty || busy); return () => onDirty(false); }, [dirty, busy, onDirty]);
  const [offset, setOffset] = useState(0);
  const campaigns = useResource(`${base}?limit=20&offset=${offset}`, version);
  const runs = useResource("/api/admin/analytics/recovery/runs", version);
  const audiences = useResource("/api/admin/audiences", version);
  const audience = audiences.data?.segments?.find(s => s.id === form.values.audience_segment_id && !s.archived);
  const runCount = runs.data?.runs?.find(run => run.id === form.values.recovery_run_id)?.member_count;
  const matchedCount = audience && audienceEstimate?.segmentId === audience.id && audienceEstimate.version === audience.version && audienceEstimate.definition === JSON.stringify(audience.definition) ? audienceEstimate.total : null;
  const costAudienceCount = form.values.audience_source === "recovery"
    ? Number.isInteger(runCount) ? Math.min(200, runCount) : null
    : Number.isInteger(matchedCount) && Number.isInteger(form.values.audience_limit) ? Math.min(matchedCount, form.values.audience_limit) : null;
  const detail = useResource(selected ? `${base}/${selected}` : null, version);
  async function save(values) {
    if (busy) return;
    const payload = { ...values, points_budget: values.points_budget === "" ? null : values.points_budget, name: values.name.trim(), duration_days: Number(values.duration_days), holdout_percent: Number(values.holdout_percent), estimated_cost_per_point_q: values.estimated_cost_per_point_q === "" ? null : values.estimated_cost_per_point_q };
    delete payload.audience_source; delete payload.offer_kind; delete payload.duration_minutes;
    if (quiet) { delete payload.duration_days; delete payload.holdout_percent; payload.duration_minutes = Number(values.duration_minutes); }
    if (values.audience_source === "segment") {
      if (!audience) { setError("La audiencia ya no está disponible. Actualiza la lista."); return; }
      delete payload.recovery_run_id; payload.audience_segment_version = audience.version;
    } else { delete payload.audience_segment_id; delete payload.audience_limit; }
    const signature = JSON.stringify(payload);
    if (request.current.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    const endpoint = quiet ? `${base}/quiet` : values.audience_source === "segment" && values.audience_limit > 200 ? `${base}/prepare` : base;
    await mutate(endpoint, { ...payload, request_id: request.current.id }, out => {
      setSelected(out.campaign.id); setOffset(0); form.reset(); request.current = { signature: "", id: crypto.randomUUID() };
      setNotice(out.campaign.preparation_status === "queued" ? "Preparación en cola. Puedes consultar su progreso abajo." : "Borrador guardado. Revisa la comprobación previa antes de activarlo.");
    });
  }
  async function mutate(path, body, done) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { const out = await api(path, { method: "POST", body: JSON.stringify(body) }); if (!alive.current) return; done(out); setVersion(v => v + 1); }
    catch (e) { if (alive.current && e.name !== "AbortError") setError(e.message || "No se pudo guardar. Intenta de nuevo."); }
    finally { if (alive.current) setBusy(false); }
  }
  const campaign = detail.data?.campaign;
  return <Stack gap="xl">
    <div><Title order={1}>Campañas dirigidas</Title><Text c="dimmed" mt="sm" maw={720}>Prepara una invitación para un momento tranquilo o una campaña con grupo de comparación. Cada oferta concede un bono en una sola compra, dentro de los límites que apruebes.</Text></div>
    {error && <Alert color="red" title="No se pudo completar la acción" role="alert">{error}</Alert>}
    {notice && <Alert color="green" role="status">{notice}</Alert>}
    <section aria-labelledby="growth-create"><Title order={2} id="growth-create" mb="md">Preparar una oferta</Title>
      <form onSubmit={form.onSubmit(save)}>
        <Stack gap="md"><Select label="Tipo de oferta" allowDeselect={false} disabled={busy} data={[{value:"experiment",label:"Campaña con grupo de comparación"},{value:"quiet",label:"Oferta para horas tranquilas"}]} {...form.getInputProps("offer_kind")} onChange={value=>{form.setFieldValue("offer_kind",value); if(value==="quiet"){form.setFieldValue("audience_source","segment");form.setFieldValue("audience_limit",Math.min(200,form.values.audience_limit)); if(form.values.points_budget==="")form.setFieldValue("points_budget",1000);}}} />
        {quiet && <QuietOfferFields form={form} disabled={busy} />}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Nombre de la campaña" maxLength={100} required disabled={busy} {...form.getInputProps("name")} />
          <Select label="Origen de los participantes" allowDeselect={false} disabled={busy || quiet} data={[{value:"recovery",label:"Lista de recuperación"},{value:"segment",label:"Audiencia con condiciones"}]} {...form.getInputProps("audience_source")} />
          {form.values.audience_source === "recovery" ? <Select label="Lista de recuperación" placeholder="Selecciona una lista" required disabled={busy || runs.loading || Boolean(runs.error)} data={(runs.data?.runs || []).map(r => ({ value: r.id, label: `${r.name} · ${number(r.member_count)} clientes` }))} {...form.getInputProps("recovery_run_id")} /> : <>
          <Select label="Audiencia guardada" placeholder="Selecciona una audiencia" required disabled={busy || audiences.loading || Boolean(audiences.error)} data={(audiences.data?.segments || []).filter(s=>!s.archived).map(s=>({value:s.id,label:`${s.name} · Versión ${s.version}`}))} {...form.getInputProps("audience_segment_id")} />
          <NumberInput label="Máximo de clientes para esta oferta" description={quiet ? "De 1 a 200 clientes." : "Más de 200 se preparan en segundo plano, hasta 5,000."} min={quiet ? 1 : 10} max={quiet ? 200 : 5000} allowDecimal={false} required disabled={busy} {...form.getInputProps("audience_limit")} /></>}
          <NumberInput label="Puntos extra por cliente" min={1} max={10000} allowDecimal={false} required disabled={busy} {...form.getInputProps("bonus_points")} />
          <NumberInput label={`Compra mínima (${merchantRegion().currency})`} min={0} max={999999.99} decimalScale={2} required disabled={busy} {...form.getInputProps("minimum_purchase_q")} />
          {!quiet && <Select label="Vigencia desde la activación" allowDeselect={false} data={[7,14,30].map(v => ({ value: String(v), label: `${v} días` }))} disabled={busy} {...form.getInputProps("duration_days")} />}
          {!quiet && <Select label="Grupo de comparación sin oferta" allowDeselect={false} data={[10,20,30].map(v => ({ value: String(v), label: `${v}% de la lista` }))} disabled={busy} {...form.getInputProps("holdout_percent")} />}
          <NumberInput label="Límite total de puntos extra" required={quiet} description={`${quiet ? "Obligatorio para una oferta breve." : "Opcional."} La oferta termina cuando ya no alcanza para otro bono. Las devoluciones no reponen puntos consumidos.`} min={1} max={2000000} allowDecimal={false} disabled={busy} {...form.getInputProps("points_budget")} />
          <NumberInput label={`Costo estimado de cada punto (${merchantRegion().currency})`} description="Opcional. Costo supuesto por punto canjeado; no su valor de venta. Vacío significa desconocido y 0 significa costo cero confirmado." min={0} max={100} decimalScale={6} disabled={busy} {...form.getInputProps("estimated_cost_per_point_q")} />
        </SimpleGrid>{form.values.audience_source === "recovery" && (runs.loading ? <Loading label="Cargando listas de recuperación…" /> : runs.error ? <Failure error={runs.error} retry={()=>setVersion(v=>v+1)} /> : !runs.data?.runs?.length ? <Text>No hay listas de recuperación guardadas. Puedes crear una en Recuperar clientes o elegir una audiencia con condiciones.</Text> : null)}{form.values.audience_source === "segment" && <><Group justify="space-between"><Anchor href="#audiencias">Crear o editar audiencias</Anchor><Button variant="subtle" disabled={busy || audiences.loading} onClick={()=>setVersion(v=>v+1)}>Actualizar audiencias</Button></Group>{audiences.error ? <Failure error={audiences.error} retry={()=>setVersion(v=>v+1)} /> : <CampaignAudiencePreview segment={audience} onCount={setAudienceEstimate} limit={form.values.audience_limit} minimum={quiet ? 1 : 10} maximum={quiet ? 200 : 5000} />}{!audiences.loading && !audiences.error && !audiences.data?.segments?.some(s=>!s.archived) && <Text>No hay audiencias disponibles. Crea una o restaura una audiencia archivada.</Text>}{form.values.audience_segment_id && !audience && !audiences.loading && !audiences.error && <Alert color="yellow">La audiencia seleccionada ya no está disponible. Elige otra audiencia para esta oferta.</Alert>}</>}<OfferCostPreview values={form.values} audienceCount={costAudienceCount} busy={busy} onCostChange={value=>form.setFieldValue("estimated_cost_per_point_q",value)} onBudgetChange={value=>form.setFieldValue("points_budget",value)} /><Text size="sm" c="dimmed">{quiet ? "Una oferta breve necesita al menos un cliente activo de una audiencia guardada." : "Una campaña con comparación necesita al menos 10 clientes activos."} Al activar, los términos quedan fijos. Si coinciden varias ofertas, se aplica una: la que vence primero.</Text>
        <Button type="submit" w="fit-content" loading={busy}>{!quiet && form.values.audience_source === "segment" && form.values.audience_limit > 200 ? "Preparar audiencia en segundo plano" : "Guardar borrador"}</Button></Stack>
      </form>
    </section>
    <section aria-labelledby="growth-list"><Title order={2} id="growth-list" mb="md">Tus campañas</Title>
      {campaigns.loading ? <Loading /> : campaigns.error ? <Failure error={campaigns.error} retry={() => setVersion(v => v + 1)} /> : !campaigns.data?.campaigns?.length ? <Text>Aún no hay campañas dirigidas. Prepara tu primera oferta arriba.</Text> : <Stack gap="xs">{campaigns.data.campaigns.map(c => <Group key={c.id} justify="space-between" className="growth-list-row"><Button variant={selected === c.id ? "light" : "subtle"} onClick={() => setSelected(c.id)} disabled={busy}>{c.name}</Button><Badge color={c.status === "active" ? "green" : "gray"}>{labels[c.status] || c.status}</Badge></Group>)}</Stack>}
      {campaigns.data && <Group mt="md"><Button variant="default" disabled={offset === 0 || busy} onClick={() => setOffset(v => Math.max(0, v - 20))}>Anteriores</Button><Text size="sm">{number(campaigns.data.total)} campañas</Text><Button variant="default" disabled={offset + 20 >= Number(campaigns.data.total) || busy} onClick={() => setOffset(v => v + 20)}>Siguientes</Button></Group>}
    </section>
    {selected && (detail.loading ? <Loading /> : detail.error ? <Failure error={detail.error} retry={() => setVersion(v => v + 1)} /> : campaign && <section aria-labelledby="growth-detail"><Stack gap="lg">
      <div><Title order={2} id="growth-detail">{campaign.name}</Title><Text mt="sm">{number(campaign.bonus_points)} puntos extra al comprar {money(campaign.minimum_purchase_q)} o más. Una vez por cliente. Vigencia: {date(campaign.starts_at)} a {date(campaign.expires_at)}.</Text><Text size="sm" c="dimmed" mt="xs">{number(campaign.member_count)} clientes · {campaign.offer_kind === "quiet" ? "Oferta breve, sin comparación" : `${campaign.holdout_percent}% para comparación`} · Estado: {labels[campaign.status]}</Text></div>
      {campaign.audience_snapshot && <Alert color="blue" title="Audiencia guardada con esta campaña"><Text size="sm">{campaign.audience_snapshot.name} · Versión {campaign.audience_snapshot.segment_version} · {number(campaign.member_count)} participantes de {number(campaign.audience_snapshot.total ?? campaign.audience_snapshot.matched_total)} coincidencias al crearla.</Text><Text size="sm" mt="xs">Corte de datos: {date(campaign.audience_snapshot.cutoff ?? campaign.audience_snapshot.generated_at ?? campaign.audience_snapshot.evaluated_at)}. Límite elegido: {number(campaign.audience_snapshot.limit ?? campaign.audience_snapshot.requested_limit)} clientes.</Text>{campaign.audience_snapshot.definition && <Text size="sm" mt="xs">{audienceDescription(campaign.audience_snapshot.definition)}</Text>}<Text size="sm" mt="xs">Las ediciones posteriores de la audiencia no cambian esta lista. La mensajería vuelve a comprobar el consentimiento.</Text></Alert>}
      <Alert color={campaign.budget_exhausted ? "yellow" : "blue"} title="Presupuesto de puntos">{campaign.points_budget == null ? "Sin límite adicional de puntos. Se mantiene una bonificación por cliente asignado." : <><Text size="sm">{number(campaign.points_committed)} de {number(campaign.points_budget)} puntos comprometidos · {number(campaign.points_remaining)} disponibles.</Text><Text size="sm" mt="xs">{campaign.budget_exhausted ? "El presupuesto ya no alcanza para otro bono. Las compras conservan sus puntos normales." : "La oferta está sujeta a los puntos disponibles al registrar la compra."} Las devoluciones no reponen este límite.</Text></>}</Alert>
      <BulkCampaignPreparation campaign={campaign} busy={busy} onRefresh={()=>setVersion(v=>v+1)} onAction={action=>void mutate(`${base}/${campaign.id}/preparation/${action}`,{},()=>setNotice(action==="cancel"?"Preparación cancelada. El progreso queda guardado.":"Reintento en cola."))} />
      {campaign.status === "draft" && (campaign.preparation_status ?? "ready") === "ready" && <CampaignPreflight key={`${campaign.id}:${version}`} campaign={campaign} busy={busy} onPending={setMessagePending} onActivate={preflightId=>void mutate(`${base}/${campaign.id}/activate`,{preflight_id:preflightId},()=>setNotice("Oferta activada. Los mensajes se preparan por separado."))} />}
      {campaign.status === "active" && <Button variant="outline" w="fit-content" loading={busy} onClick={() => {
        if (confirm("¿Pausar definitivamente esta campaña? Se detendrán las nuevas bonificaciones y los mensajes pendientes. Conservaremos sus resultados.")) void mutate(`${base}/${campaign.id}/pause`, {}, () => setNotice("Campaña pausada. Los puntos ya otorgados se conservan."));
      }}>Pausar campaña</Button>}
      {campaign.status !== "draft" && <><CampaignResults results={detail.data.results} quiet={campaign.offer_kind === "quiet"} /><Messages key={campaign.id} campaign={campaign} version={version} onPending={setMessagePending} /></>}
    </Stack></section>)}
  </Stack>;
}
function Messages({ campaign, version, onPending }) {
  const [refresh, setRefresh] = useState(0), [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const alive = useRef(true), requestId = useRef(crypto.randomUUID());
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { onPending(busy || checked); return () => onPending(false); }, [busy, checked, onPending]);
  const state = useResource(`${base}/${campaign.id}/messages`, `${version}:${refresh}`);
  async function queue() {
    if (busy || !checked) return;
    setBusy(true); setError(""); setNotice("");
    try { const out = await api(`${base}/${campaign.id}/messages/queue`, { method: "POST", body: JSON.stringify({ confirm: true, request_id: requestId.current }) }); if (!alive.current) return; requestId.current = crypto.randomUUID(); setChecked(false); setRefresh(v => v + 1); setNotice(isDemo ? "Cola simulada en esta pestaña. No se envían mensajes." : `${number(out.queued_count)} mensajes puestos en cola. Consulta aquí su estado.`); }
    catch (e) { if (alive.current && e.name !== "AbortError") setError(e.message || "No se pudo preparar la cola. Reintenta con conexión."); }
    finally { if (alive.current) setBusy(false); }
  }
  const data = state.data;
  return <section aria-labelledby="growth-messages"><Group justify="space-between" mb="md"><Title order={3} id="growth-messages">Mensajes de la campaña</Title><Button variant="subtle" onClick={() => setRefresh(v => v + 1)} disabled={busy}>Actualizar estados</Button></Group>
    {state.loading ? <Loading /> : state.error ? <Failure error={state.error} retry={() => setRefresh(v => v + 1)} /> : data && <Stack gap="md">
      <Text size="sm">Solo se incluyen clientes con oferta y consentimiento para promociones. Se vuelve a comprobar su permiso antes del envío.</Text>
      {data.pause_reason&&<Alert color="yellow" title="Envío en espera">{data.pause_reason==='business_busy'?'Hay una pausa temporal de invitaciones. Puedes revisarla en Decisiones.':data.data_readiness?.summary||'Faltan datos recientes para confirmar esta audiencia.'} Las ofertas existentes se conservan.</Alert>}
      {data.provider_ready === false && <Alert color="yellow">{data.provider_note || "Configura un proveedor de mensajes antes de poner esta campaña en cola."}</Alert>}
      <Text className="campaign-message-preview">{data.preview?.body}</Text><Text size="sm" c="dimmed">{data.preview?.delivery_note}</Text>
      <Group gap="sm">{Object.entries({ queued: "En cola", processing: "En proceso", accepted: "Aceptados por proveedor", failed: "Fallidos", uncertain: "Sin confirmación", suppressed: "Omitidos" }).map(([key, label]) => <Badge variant="light" color="gray" key={key}>{label}: {number(data.counts?.[key] || 0)}</Badge>)}</Group>
      <Text size="sm" c="dimmed">Aceptado por el proveedor no confirma entrega al teléfono. Los envíos sin confirmación no se reintentan automáticamente para evitar duplicados.</Text>
      <Checkbox label={`Confirmo el envío de esta oferta a los ${number(data.eligible_count)} clientes elegibles.`} checked={checked} onChange={e => setChecked(e.currentTarget.checked)} disabled={!data.can_queue || busy} />
      <Button w="fit-content" onClick={queue} disabled={!checked || !data.can_queue} loading={busy}>{isDemo ? "Simular cola de mensajes" : "Poner mensajes en cola"}</Button>
    </Stack>}
    {error && <Alert color="red" mt="md" role="alert">{error}</Alert>}{notice && <Alert color="green" mt="md" role="status">{notice}</Alert>}
  </section>;
}
