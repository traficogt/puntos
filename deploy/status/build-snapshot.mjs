import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { buildStatusSnapshot, fetchIncidentFeed } from './snapshot-model.mjs';

const histories = {};
for (const id of ['sitio', 'acceso', 'sistema', 'ayuda', 'soporte']) {
  // Fixed component IDs select only the monitor's own local history files.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  try { histories[id] = parse(await readFile(`history/${id}.yml`, 'utf8'), { maxAliasCount: 0 }); } catch { histories[id] = {}; }
}
async function github(path) {
  const response = await fetch(`https://api.github.com/repos/traficogt/puntos-estado/${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PuntosFieles-status', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('Incident registry unavailable');
  return response;
}
const { issues, comments, incidentFeedAvailable } = await fetchIncidentFeed(github);
if (!incidentFeedAvailable) console.error('Incident history is incomplete or could not be refreshed; the public page will disclose this.');
const snapshot = buildStatusSnapshot({ histories, issues, comments, incidentFeedAvailable, monitorSucceeded: process.env.UPPTIME_OUTCOME === 'success' });
await writeFile('status.json', JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Prepared ${snapshot.components.length} public observations and ${snapshot.incidents.length} incident summaries.`);
