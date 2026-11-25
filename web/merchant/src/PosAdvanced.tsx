import {useEffect, useRef, useState} from 'react';
import type {ChangeEvent} from 'react';
import {Alert, Button, Checkbox, Code, FileInput, Group, NativeSelect, PasswordInput, SimpleGrid, Stack, Table, Text, TextInput, Title} from '@mantine/core';
import {api, isDemo} from './api.js';
import {money, number} from './ui.jsx';
import {merchantRegion} from './region.js';
import {connectionActive, csvColumns, csvFileIssue, csvMappingReady, csvPreviewPayload, emptyCsvMapping, issueLine, keyStatus, lastSyncSummary, loyversePayload, loyverseStatus, posEndpoint, previewSummary, resultSummary, saleExample, statusLabel} from './pos-advanced-model';
import type {CsvAmountUnit, CsvColumnKey, CsvMapping, PosApplyResult, PosIntegrationStatus, PosPreview} from './pos-advanced-model';

// The connection tools of the retired vanilla dashboard, inside "Conectar caja": Loyverse credentials and
// receipts, CSV column mapping with preview/import, and the API key. Previews never assign points; the
// import, sync and key actions ask first and need the saved connection enabled in the same mode.
const base = '/api/admin/pos';

interface PosAdvancedProps {integration: PosIntegrationStatus; businessSlug: string | null; mode: string; dirty: boolean; disabled: boolean; onIntegration: (next: PosIntegrationStatus) => void}

function errorMessage(error: unknown): string {
  const failure = error as {status?: number; message?: string} | null;
  if (failure?.status === 404 || /HTTP 404|Cannot (GET|POST|PUT)/i.test(failure?.message || '')) return 'La conexión de ventas aún no está disponible. Reintenta más tarde.';
  return failure?.message || 'No se pudo completar la operación. Vuelve a intentarlo.';
}

export default function PosAdvanced({integration, businessSlug, mode, dirty, disabled, onIntegration}: PosAdvancedProps) {
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<PosPreview | null>(null), [result, setResult] = useState<PosApplyResult | null>(null);
  const [file, setFile] = useState<File | null>(null), [csv, setCsv] = useState(''), [headers, setHeaders] = useState<string[]>([]), [mapping, setMapping] = useState<CsvMapping>(emptyCsvMapping);
  const [storeId, setStoreId] = useState(integration.loyverse?.store_id || ''), [token, setToken] = useState(''), [revealedKey, setRevealedKey] = useState('');
  const alive = useRef(true);
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  useEffect(() => {setPreview(null); setResult(null); setError(''); setNotice('');}, [mode]);
  const active = connectionActive(integration, mode, dirty), locked = !!busy || disabled;
  const currency = merchantRegion().currency;

  if (isDemo) return <Text size="sm" c="dimmed">Las credenciales de Loyverse, la importación de archivos y la clave API se gestionan dentro de tu negocio real; esta demostración no las incluye.</Text>;

  async function run(step: string, task: () => Promise<void>) {
    if (busy) return;
    setBusy(step); setError(''); setNotice('');
    try {await task();}
    catch (cause) {if (alive.current && (cause as {name?: string})?.name !== 'AbortError') setError(errorMessage(cause));}
    finally {if (alive.current) setBusy('');}
  }
  async function refresh() {
    const out = await api(base) as {integration: PosIntegrationStatus};
    if (alive.current && out?.integration) onIntegration(out.integration);
  }
  async function copy(value: string, label: string) {
    try {await navigator.clipboard.writeText(value); setNotice(`${label} copiada.`);}
    catch {setError(`No se pudo copiar. Selecciona el texto y cópialo manualmente.`);}
  }

  // Loyverse
  const saveLoyverse = () => run('loyverse-save', async () => {
    const out = await api(base, {method: 'PUT', body: JSON.stringify(loyversePayload(integration, {storeId, token}))}) as {integration: PosIntegrationStatus};
    if (!alive.current) return;
    onIntegration(out.integration); setToken(''); setStoreId(out.integration.loyverse?.store_id || '');
    setNotice(out.integration.loyverse?.merchant_name ? `Cuenta verificada: ${out.integration.loyverse.merchant_name}.` : 'Conexión guardada.');
  });
  const previewLoyverse = () => run('loyverse-preview', async () => {
    const out = await api(`${base}/loyverse/preview`, {method: 'POST', body: '{}'}) as PosPreview;
    if (!alive.current) return;
    setResult(null); setPreview(out);
    setNotice(Number(out.summary?.ready ?? 0) > 0 ? 'Vista previa lista. Puedes sincronizar estas ventas.' : out.has_more ? 'Este grupo no tiene ventas listas. Sincroniza para avanzar al siguiente grupo.' : 'No hay ventas nuevas listas para asignar puntos.');
  });
  const syncLoyverse = () => {
    if (!preview || !window.confirm(`Ventas listas en la revisión: ${number(preview.summary?.ready)}. ¿Sincronizar el siguiente grupo de ventas de Loyverse y asignar sus puntos? Las ventas repetidas se omiten.`)) return;
    void run('loyverse-sync', async () => {
      const out = await api(`${base}/loyverse/sync`, {method: 'POST', body: '{}'}) as {result?: PosApplyResult};
      if (!alive.current) return;
      setPreview(null); setResult(out.result || {}); setNotice('Sincronización terminada. Revisa el resultado de las ventas.');
      try {await refresh();} catch {/* The result stays visible even if the status refresh fails. */}
    });
  };

  // CSV
  const inspectFile = (next: File | null) => {
    setFile(next); setCsv(''); setHeaders([]); setPreview(null); setResult(null); setMapping(current => ({...current, columns: {}, assumePaid: false}));
    if (!next) return;
    const issue = csvFileIssue(next.size);
    if (issue) {setError(issue); return;}
    void run('csv-inspect', async () => {
      const text = await next.text();
      const out = await api(`${base}/csv/preview`, {method: 'POST', body: JSON.stringify({csv: text})}) as PosPreview;
      if (!alive.current) return;
      if (!Array.isArray(out.headers) || !out.headers.length) throw new Error('No se encontraron encabezados. Revisa el archivo CSV y vuelve a seleccionarlo.');
      setCsv(text); setHeaders(out.headers); setNotice(`${next.name} · ${out.headers.length} columnas encontradas. Relaciona las columnas y revisa las ventas.`);
    });
  };
  const setColumn = (key: CsvColumnKey, header: string) => {setPreview(null); setMapping(current => ({...current, columns: {...current.columns, [key]: header}}));};
  const previewCsv = () => run('csv-preview', async () => {
    const out = await api(`${base}/csv/preview`, {method: 'POST', body: JSON.stringify(csvPreviewPayload(csv, mapping))}) as PosPreview;
    if (!alive.current) return;
    setResult(null); setPreview(out);
    setNotice(Number(out.summary?.ready ?? 0) > 0 ? 'Vista previa lista. Comprueba los datos antes de importar.' : 'No hay ventas listas para importar. Revisa los mensajes de cada fila.');
  });
  const importCsv = () => {
    if (!preview || !window.confirm(`Se importarán ${number(preview.summary?.ready)} ventas listas y se asignarán sus puntos. Las repetidas y las filas con error se omiten. ¿Continuar?`)) return;
    void run('csv-import', async () => {
      const out = await api(`${base}/csv/import`, {method: 'POST', body: JSON.stringify(csvPreviewPayload(csv, mapping))}) as {result?: PosApplyResult};
      if (!alive.current) return;
      setPreview(null); setResult(out.result || {}); setNotice('Importación terminada. Revisa el resultado de las ventas.');
    });
  };

  // API key
  const generateKey = () => {
    if (integration.has_api_key && !window.confirm('Generar una nueva clave desactivará la anterior inmediatamente. Tendrás que actualizar cualquier integración que la use. ¿Generar la nueva clave API?')) return;
    void run('key', async () => {
      setRevealedKey('');
      const out = await api(`${base}/key`, {method: 'POST', body: '{}'}) as {integration: PosIntegrationStatus; api_key?: string};
      if (!alive.current) return;
      onIntegration(out.integration); setRevealedKey(out.api_key || ''); setNotice('Clave generada. Cópiala ahora: solo se mostrará una vez.');
    });
  };

  const sync = lastSyncSummary(integration.last_sync, merchantRegion().locale);
  const endpoint = posEndpoint(location.origin, businessSlug);
  const inactiveNote = mode === 'loyverse' ? 'Habilita y guarda la conexión en modo Loyverse para revisar o sincronizar recibos.' : mode === 'csv' ? 'Habilita y guarda la conexión en modo CSV para revisar e importar un archivo.' : 'Habilita y guarda la conexión en modo API para generar la clave.';
  return <Stack gap="lg" mt="lg">
    {mode === 'loyverse' && <section aria-labelledby="pos-loyverse-title"><Stack gap="md">
      <Title order={3} id="pos-loyverse-title">Cuenta de Loyverse</Title>
      <Text size="sm">{loyverseStatus(integration)}</Text>
      <SimpleGrid cols={{base: 1, sm: 2}}>
        <TextInput label="ID de la tienda en Loyverse (opcional)" description="Vacío lee todas las tiendas de la cuenta." maxLength={128} value={storeId} onChange={(event: ChangeEvent<HTMLInputElement>) => setStoreId(event.currentTarget.value)} disabled={locked}/>
        <PasswordInput label="Token de acceso de Loyverse" description={integration.loyverse?.configured ? 'Token guardado. Déjalo vacío para conservarlo o pega uno nuevo para reemplazarlo.' : 'Crea un token de acceso en tu cuenta de Loyverse y pégalo aquí. Se verificará al guardar.'} maxLength={4096} value={token} onChange={(event: ChangeEvent<HTMLInputElement>) => setToken(event.currentTarget.value)} disabled={locked}/>
      </SimpleGrid>
      <Group><Button variant="default" loading={busy === 'loyverse-save'} disabled={locked || dirty} onClick={saveLoyverse}>Guardar y verificar cuenta</Button>{dirty && <Text size="sm" c="dimmed">Guarda primero los ajustes de la conexión.</Text>}</Group>
      <Text size="sm" c={sync.error ? 'red' : undefined}>{sync.text}</Text>
      {!!integration.last_sync?.issues?.length && <ul className="pos-issues">{integration.last_sync.issues.map((issue, index) => <li key={`${issue.saleId || index}`}><Text size="sm" component="span">{issueLine(issue, 'Sincronización')}</Text></li>)}</ul>}
      <Group><Button variant="default" loading={busy === 'loyverse-preview'} disabled={locked || !active || !integration.loyverse?.configured} onClick={previewLoyverse}>Revisar recibos de Loyverse</Button><Button loading={busy === 'loyverse-sync'} disabled={locked || !active || !preview} onClick={syncLoyverse}>Sincronizar ventas revisadas</Button></Group>
    </Stack></section>}
    {mode === 'csv' && <section aria-labelledby="pos-csv-title"><Stack gap="md">
      <Title order={3} id="pos-csv-title">Archivo de ventas (CSV)</Title>
      <FileInput label="Archivo CSV de ventas" description="Exporta como máximo 100 ventas (200 KB). Al elegirlo, PF lee sus columnas sin asignar puntos." accept=".csv,text/csv,text/plain" value={file} onChange={inspectFile} disabled={locked} clearable/>
      {headers.length > 0 && <>
        <TextInput label="Origen de las ventas" description="Para detectar repetidas, usa el mismo origen en cada importación." maxLength={180} value={mapping.source} onChange={(event: ChangeEvent<HTMLInputElement>) => {const source = event.currentTarget.value; setPreview(null); setMapping(current => ({...current, source}));}} disabled={locked}/>
        <SimpleGrid cols={{base: 1, sm: 2}}>{csvColumns.map(column => <NativeSelect key={column.key} label={column.required ? column.label : `${column.label} (opcional)`} data={[{value: '', label: column.required ? 'Elige una columna' : 'Sin columna'}, ...headers.map(header => ({value: header, label: header}))]} value={mapping.columns[column.key] || ''} onChange={event => setColumn(column.key, event.currentTarget.value)} disabled={locked}/>)}</SimpleGrid>
        <NativeSelect label="Unidad del importe" data={[{value: 'major', label: `En ${currency} con decimales (75.00)`}, {value: 'minor', label: 'En centavos (7500)'}]} value={mapping.amountUnit} onChange={event => {const amountUnit = event.currentTarget.value as CsvAmountUnit; setPreview(null); setMapping(current => ({...current, amountUnit}));}} disabled={locked} maw={360}/>
        {!mapping.columns.status && <Checkbox label="Todas las ventas del archivo están pagadas" description="Úsalo solo si el archivo no trae una columna de estado." checked={mapping.assumePaid} onChange={event => {const assumePaid = event.currentTarget.checked; setPreview(null); setMapping(current => ({...current, assumePaid}));}} disabled={locked}/>}
        <Group><Button variant="default" loading={busy === 'csv-preview'} disabled={locked || !active || !csvMappingReady(csv, mapping)} onClick={previewCsv}>Revisar ventas</Button><Button loading={busy === 'csv-import'} disabled={locked || !active || !preview || !(Number(preview.summary?.ready ?? 0) > 0)} onClick={importCsv}>Importar ventas revisadas</Button></Group>
      </>}
    </Stack></section>}
    {mode === 'api' && <section aria-labelledby="pos-api-title"><Stack gap="md">
      <Title order={3} id="pos-api-title">Integración por API</Title>
      <Group align="end"><TextInput label="Dirección para enviar ventas" readOnly value={endpoint} style={{flex: '1 1 320px'}}/><Button variant="default" disabled={!endpoint} onClick={() => void copy(endpoint, 'Dirección')}>Copiar dirección</Button></Group>
      <Text size="sm">{keyStatus(integration)}</Text>
      <Group><Button variant="default" loading={busy === 'key'} disabled={locked || !active} onClick={generateKey}>{integration.has_api_key ? 'Generar nueva clave API' : 'Generar clave API'}</Button></Group>
      {revealedKey && <Alert color="teal" role="status" title="Clave generada"><Stack gap="xs"><Text size="sm">Cópiala ahora: solo se mostrará una vez.</Text><Group align="end"><TextInput aria-label="Clave API" readOnly value={revealedKey} style={{flex: '1 1 320px'}}/><Button variant="default" onClick={() => void copy(revealedKey, 'Clave')}>Copiar clave</Button></Group></Stack></Alert>}
      <Text size="sm" c="dimmed">Ejemplo de venta (dryRun: true no asigna puntos):</Text>
      <Code block>{saleExample(currency)}</Code>
    </Stack></section>}
    {!active && <Text size="sm" c="dimmed">{inactiveNote}</Text>}
    {error && <Alert color="red" role="alert" title="No se pudo completar la operación">{error}</Alert>}
    {notice && !error && <Text size="sm" role="status">{notice}</Text>}
    {preview && <Stack gap="xs">
      <Text size="sm" fw={600}>{previewSummary(preview.summary)}</Text>
      {!!preview.rows?.length && <Table.ScrollContainer minWidth={640} type="native" tabIndex={0} role="region" aria-label="Ventas revisadas"><Table striped><Table.Thead><Table.Tr><Table.Th>Fila</Table.Th><Table.Th>ID</Table.Th><Table.Th>Teléfono</Table.Th><Table.Th>Importe</Table.Th><Table.Th>Puntos</Table.Th><Table.Th>Estado</Table.Th><Table.Th>Mensaje</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{preview.rows.map((row, index) => <Table.Tr key={`${row.saleId}-${index}`}><Table.Td>{row.row ?? '—'}</Table.Td><Table.Td style={{overflowWrap: 'anywhere'}}>{row.saleId}</Table.Td><Table.Td>{row.customerPhone}</Table.Td><Table.Td>{row.amountQ == null ? '—' : money(row.amountQ)}</Table.Td><Table.Td>{number(row.points)}</Table.Td><Table.Td>{statusLabel(row.status)}</Table.Td><Table.Td>{row.message}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
    </Stack>}
    {result && <Alert color="teal" role="status" title="Resultado"><Stack gap="xs"><Text size="sm">{resultSummary(result)}</Text>{!!result.issues?.length && <ul className="pos-issues">{result.issues.map((issue, index) => <li key={`${issue.saleId || issue.row || index}`}><Text size="sm" component="span">{issueLine(issue)}</Text></li>)}</ul>}</Stack></Alert>}
  </Stack>;
}
