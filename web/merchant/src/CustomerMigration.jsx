import ImportJobs from './ImportJobs.jsx';
import {regionalDate,merchantRegion} from './region.js';
import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Checkbox, FileInput, Group, NumberInput, Textarea, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { api, isDemo, useResource } from './api.js';
import { Failure, Loading, number } from './ui.jsx';
import { migrationLimits, migrationPayload, migrationTemplate, suggestMigrationColumns } from './migration-model.js';

const base = '/api/admin/customer-migrations';
const noop = () => {};
const date = regionalDate;
const blankColumns = { phone: '', name: '', points: '' };

export default function CustomerMigration({ onDirty = noop }) {
  const [sourceType,setSourceType]=useState('csv_balance'),[sourceLabel,setSourceLabel]=useState(''),[evidence,setEvidence]=useState(''),[conversion,setConversion]=useState(10),[conversionApproved,setConversionApproved]=useState(false);
  const source=sourceType==='csv_balance'?undefined:{type:sourceType,label:sourceLabel,evidence,evidence_type:'owner_attestation',conversion:{points_per_unit:conversion,approved:conversionApproved}};
  const [queued,setQueued]=useState(false),[queuedMessage,setQueuedMessage]=useState('');
  const previewBase=queued?'/api/admin/customer-import-jobs':base;
  const [file, setFile] = useState(null), [csv, setCsv] = useState(''), [headers, setHeaders] = useState([]);
  const [columns, setColumns] = useState(blankColumns), [existingPolicy, setExistingPolicy] = useState('skip');
  const [label, setLabel] = useState(''), [confirmed, setConfirmed] = useState(false), [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [completed, setCompleted] = useState(null), [version, setVersion] = useState(0);
  const alive = useRef(true), generation = useRef(0), request = useRef({ id: crypto.randomUUID(), signature: '' });
  const history = useResource(base, version);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current += 1; }; }, []);
  useEffect(() => { onDirty(Boolean(csv || file || label || busy)); return () => onDirty(false); }, [csv, file, label, busy, onDirty]);
  function invalidate() { setPreview(null); setConfirmed(false); setError(''); setCompleted(null); }
  async function inspect(nextFile, example = false) {
    if (busy) return;
    const current = ++generation.current;
    invalidate(); setFile(nextFile); setCsv(''); setHeaders([]); setColumns(blankColumns);
    if (!nextFile && !example) return;
    setBusy(true);
    try {
      if (nextFile && nextFile.size > (queued?750*1024:migrationLimits.bytes)) throw new Error(queued?'El archivo admite hasta 750 KB y 5,000 clientes.':'El archivo admite hasta 200 KB y 100 clientes.');
      const text = example ? migrationTemplate : await nextFile.text();
      const out = await api(`${previewBase}/preview`, { method: 'POST', body: JSON.stringify({ csv: text }) });
      if (!alive.current || current !== generation.current) return;
      setCsv(text); setHeaders(out.headers); setColumns(suggestMigrationColumns(out.headers));
      if (!label) setLabel(example ? 'Clientes de ejemplo' : 'Saldo anterior');
    } catch (e) { if (alive.current && e.name !== 'AbortError') setError(e.message || 'No pudimos leer el archivo. Revisa que sea un CSV válido.'); }
    finally { if (alive.current && current === generation.current) setBusy(false); }
  }
  async function review() {
    if (busy) return;
    setBusy(true); setError(''); setPreview(null); setConfirmed(false);
    try {
      const out = await api(`${previewBase}/preview`, { method: 'POST', body: JSON.stringify(migrationPayload({ csv, columns, existingPolicy,source })) });
      if (alive.current) setPreview(out);
    } catch (e) { if (alive.current && e.name !== 'AbortError') setError(e.message || 'No pudimos revisar el lote. Inténtalo de nuevo.'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function commit() {
    if (busy || !preview?.can_commit) return;
    setBusy(true); setError('');
    try {
      const values = { csv, columns, existingPolicy, label, confirmed,source };
      const signature = JSON.stringify(migrationPayload(values, 'pending'));
      if (request.current.signature !== signature) request.current = { id: crypto.randomUUID(), signature };
      const out = await api(queued?previewBase:`${base}/commit`, { method: 'POST', body: JSON.stringify(migrationPayload(values, request.current.id)) });
      if (!alive.current) return;
      if(queued)setQueuedMessage('Archivo encolado. Puedes salir de esta pantalla; el servidor continuará por lotes de 100 filas.');
      setCompleted(out.batch||null); setCsv(''); setFile(null); setHeaders([]); setColumns(blankColumns); setPreview(null); setLabel(''); setConfirmed(false);
      request.current = { id: crypto.randomUUID(), signature: '' }; setVersion(value => value + 1);
    } catch (e) { if (alive.current && e.name !== 'AbortError') setError(`${e.message || 'No pudimos confirmar el resultado.'} Puedes reintentar este mismo lote; no se duplicará el saldo.`); }
    finally { if (alive.current) setBusy(false); }
  }
  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob(['\uFEFF' + migrationTemplate], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'plantilla-clientes-pf.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <Stack gap="xl">
    <div><Title order={1}>Importar clientes</Title><Text c="dimmed" mt="sm" maw={740}>Trae los clientes de tu programa anterior con sus puntos disponibles. Primero revisa el archivo; después confirma el saldo inicial que guardarás en PF.</Text></div>
    {isDemo && <Alert title="Prueba con datos de ejemplo" color="blue">Los lotes de esta demostración solo duran en esta pestaña. Usa la muestra para probar el recorrido sin cargar datos reales.</Alert>}
    {queuedMessage&&<Alert color="green" role="status" title="Importación en cola">{queuedMessage}</Alert>}
    {error && <Alert color="red" title="Revisa la importación" role="alert">{error}</Alert>}
    {completed && <Alert color="green" title={isDemo ? 'Importación de ejemplo guardada' : 'Importación guardada'} role="status">
      <Text>{number(completed.imported_count)} clientes creados con {number(completed.opening_points)} puntos iniciales. {number(completed.skipped_count)} clientes existentes omitidos.</Text>
      <Text size="sm" mt="xs">Lote: {completed.label}. Puedes consultar este resultado en el historial.</Text>
    </Alert>}
    <section aria-labelledby="migration-file-title">
      <Group justify="space-between" mb="md"><Title order={2} id="migration-file-title">Prepara tu archivo</Title><Button variant="outline" onClick={downloadTemplate}>Descargar plantilla CSV</Button></Group>
      <Stack gap="md" mb="lg"><Select label="Origen de los saldos" value={sourceType} allowDeselect={false} disabled={busy||queued} onChange={value=>{setSourceType(value||'csv_balance');invalidate();setConversionApproved(false);}} data={[{value:'csv_balance',label:'Puntos de otro sistema'},{value:'paper_card',label:'Sellos de tarjetas de papel'},{value:'progress',label:'Progreso documentado de otro programa'}]}/>{sourceType!=='csv_balance'&&<><TextInput label="Registro de origen" description="Por ejemplo: tarjetas numeradas verificadas en tienda" maxLength={100} value={sourceLabel} onChange={e=>{setSourceLabel(e.currentTarget.value);invalidate();}}/><Textarea label="Evidencia revisada por el dueño" description="Describe el registro o comprobante contrastado. Una foto por sí sola no prueba saldo ni identidad." maxLength={500} value={evidence} onChange={e=>{setEvidence(e.currentTarget.value);invalidate();}}/><NumberInput label="Puntos por sello o unidad de progreso" min={1} max={100000} allowDecimal={false} value={conversion} onChange={value=>{setConversion(value);setConversionApproved(false);invalidate();}}/><Checkbox label={`Como dueño apruebo convertir cada unidad documentada en ${number(conversion)} puntos, después de verificar su origen.`} checked={conversionApproved} onChange={e=>{setConversionApproved(e.currentTarget.checked);invalidate();}}/><Text size="sm">La columna de saldo contiene sellos o unidades originales. La vista previa muestra los puntos convertidos y los duplicados. Cada lote conserva la regla de conversión y quién la aprobó.</Text></>}</Stack>
      <Checkbox mb="md" label="Procesar un archivo grande en segundo plano (hasta 5,000 clientes)" checked={queued} disabled={busy||Boolean(csv)||sourceType!=='csv_balance'} onChange={e=>{setQueued(e.currentTarget.checked);invalidate();}}/>
      {queued&&<Alert color="blue" mb="md" title="El avance se guarda por lotes">Cada lote de 100 filas se confirma por separado. Si cancelas o aparece un conflicto, los clientes ya importados conservan sus puntos. El archivo pendiente vence a los siete días y se elimina al finalizar.</Alert>}
      <Text mb="md">Hasta {queued?'5,000 clientes y 750 KB':'100 clientes y 200 KB'} por archivo, con encabezados y separador de coma o punto y coma. Reemplaza los datos de ejemplo. El teléfono es obligatorio; sin columna de saldo, cada cliente empieza con 0 puntos.</Text>
      <SimpleGrid cols={{ base: 1, sm: isDemo ? 2 : 1 }} style={{ alignItems: 'end' }}><FileInput label="Archivo de clientes (CSV)" accept=".csv,text/csv" value={file} onChange={next => inspect(next)} disabled={busy} clearable placeholder="Seleccionar archivo" styles={{ placeholder: { color: 'var(--pf-muted)' } }} />
        {isDemo && <Button variant="light" onClick={() => inspect(null, true)} disabled={busy}>Cargar muestra de clientes</Button>}</SimpleGrid>
    </section>
    {headers.length > 0 && <section aria-labelledby="migration-mapping-title">
      <Title order={2} id="migration-mapping-title" mb="md">Relaciona las columnas</Title>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>{[['phone', 'Teléfono'], ['name', 'Nombre (opcional)'], ['points', 'Saldo inicial (opcional)']].map(([key, title]) => <Select key={key} label={title} value={columns[key] || null} data={headers} placeholder={key === 'phone' ? 'Seleccionar columna' : 'Sin columna'} clearable={key !== 'phone'} allowDeselect={key !== 'phone'} disabled={busy} onChange={value => { invalidate(); setColumns(old => ({ ...old, [key]: value || '' })); }} />)}</SimpleGrid>
      <Select mt="md" label="Si el teléfono ya existe en este negocio" value={existingPolicy} allowDeselect={false} data={[{ value: 'skip', label: 'Omitir ese cliente y conservar su saldo' }, { value: 'reject', label: queued?'Detener si aparece un cliente existente':'Rechazar el lote completo' }]} disabled={busy} onChange={value => { invalidate(); setExistingPolicy(value || 'skip'); }} />
      <Text size="sm" c="dimmed" mt="xs">{merchantRegion().country==='GT'?'Los teléfonos locales de 8 dígitos se completan con 502.':'Usa + y el número internacional completo, con código de país.'} Los clientes desactivados también se consideran existentes.</Text>
      <Button mt="lg" onClick={review} loading={busy} disabled={!columns.phone||(sourceType!=='csv_balance'&&(!conversionApproved||!sourceLabel.trim()||!evidence.trim()))}>Revisar lote</Button>
    </section>}
    {preview && <section aria-labelledby="migration-review-title">
      <Title order={2} id="migration-review-title" mb="md">Revisa antes de importar</Title>
      <Group gap="lg" mb="md"><Text><strong>{number(preview.summary.new_customers)}</strong> nuevos</Text><Text><strong>{number(preview.summary.existing_customers)}</strong> existentes</Text><Text><strong>{number(preview.summary.errors)}</strong> con errores</Text><Text><strong>{number(preview.summary.opening_points)}</strong> puntos iniciales</Text></Group>
      {!preview.can_commit && <Alert color="orange" mb="md" title="El lote necesita una corrección">Corrige las filas indicadas y vuelve a cargar el CSV. Si elegiste rechazar clientes existentes, también puedes cambiar esa opción y revisar otra vez. No se ha guardado ningún cambio.</Alert>}
      <Table.ScrollContainer minWidth={600} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': 'Revisión de clientes del archivo' } }}>
        <Table captionSide="bottom"><Table.Caption>Se muestran hasta 100 filas, con errores primero. La validación incluye todas las filas. El negocio y los teléfonos se comprobarán de nuevo al guardar.</Table.Caption>
          <Table.Thead><Table.Tr><Table.Th>Fila</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Teléfono</Table.Th><Table.Th>Saldo inicial</Table.Th><Table.Th>Resultado</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{[...preview.rows].sort((a,b)=>Number(b.issues.length>0)-Number(a.issues.length>0)).slice(0,100).map(row => <Table.Tr key={row.row}><Table.Td>{row.row}</Table.Td><Table.Td maw={220} style={{ overflowWrap: 'anywhere' }}>{row.name || 'Sin nombre'}</Table.Td><Table.Td>{row.phone}</Table.Td><Table.Td>{number(row.points)}{row.source_units!=null&&<Text size="xs">{number(row.source_units)} unidades de origen</Text>}</Table.Td><Table.Td maw={300}><Badge color={row.status === 'error' ? 'red' : row.status === 'existing' ? 'gray' : 'green'} variant="light">{row.status === 'error' ? 'Error' : row.status === 'existing' ? 'Ya existe' : 'Nuevo'}</Badge>{row.issues.map(issue => <Text key={issue.code} size="sm" mt={4}>{issue.message}</Text>)}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Stack gap="md" mt="lg" maw={760}>
        <TextInput label="Nombre del lote" placeholder="Por ejemplo: cierre del programa anterior" maxLength={100} value={label} disabled={busy} onChange={event => { setLabel(event.currentTarget.value); setConfirmed(false); }} />
        <Text size="sm">Los puntos importados quedan disponibles de inmediato y cuentan en el saldo acumulado. No registran compras ni visitas. El cliente debe verificar su teléfono para entrar a su tarjeta; importar no autoriza mensajes de marketing.</Text>
        <Checkbox label={`Revisé el archivo y confirmo importar hasta ${number(preview.summary.new_customers)} clientes con ${number(preview.summary.opening_points)} puntos iniciales. Los saldos existentes se conservarán.`} checked={confirmed} disabled={busy || !preview.can_commit} onChange={event => setConfirmed(event.currentTarget.checked)} />
        <Button w="fit-content" onClick={commit} loading={busy} disabled={!preview.can_commit || !confirmed || !label.trim()}>Confirmar importación</Button>
      </Stack>
    </section>}
    <section aria-labelledby="migration-history-title"><Title order={2} id="migration-history-title" mb="md">Importaciones guardadas</Title>
      {history.loading ? <Loading label="Cargando importaciones…" /> : history.error ? <Failure error={history.error} retry={() => setVersion(value => value + 1)} /> : !history.data?.batches?.length ? <Text c="dimmed">Todavía no hay lotes guardados. Aquí aparecerán sus resultados después de confirmar una importación.</Text> : <Table.ScrollContainer minWidth={580} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': 'Historial de importaciones' } }}><Table captionSide="bottom"><Table.Caption>Últimos 20 lotes. Los totales reflejan lo que realmente se guardó, incluidos los clientes omitidos.</Table.Caption><Table.Thead><Table.Tr><Table.Th>Lote</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Creados</Table.Th><Table.Th>Omitidos</Table.Th><Table.Th>Puntos iniciales</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{history.data.batches.map(batch => <Table.Tr key={batch.id}><Table.Td maw={220} style={{ overflowWrap: 'anywhere' }}>{batch.label}{batch.source_evidence&&<Text size="xs">{batch.source_evidence.label} · {batch.source_evidence.conversion?.points_per_unit||1} puntos por unidad</Text>}</Table.Td><Table.Td>{date(batch.created_at)}</Table.Td><Table.Td>{number(batch.imported_count)}</Table.Td><Table.Td>{number(batch.skipped_count)}</Table.Td><Table.Td>{number(batch.opening_points)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
    </section>
    <ImportJobs revision={version}/>
  </Stack>;
}
