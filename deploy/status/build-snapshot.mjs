import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { buildStatusSnapshot } from './snapshot-model.mjs';

const histories = {};
for (const id of ['sitio', 'acceso', 'sistema', 'ayuda', 'soporte']) {
  try { histories[id] = parse(await readFile(`history/${id}.yml`, 'utf8'), { maxAliasCount: 0 }); } catch { histories[id] = {}; }
}
async function github(path) {
  const response = await fetch(`https://api.github.com/repos/traficogt/puntos-estado/${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PuntosFieles-status', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('Incident registry unavailable');
  return response.json();
}
let issues = [], comments = {}, incidentFeedAvailable = false;
try {
  issues = await github('issues?state=all&sort=updated&direction=desc&per_page=50');
  for (const issue of issues.filter(item => item.labels?.some(label => ['status', 'maintenance'].includes(label.name))).slice(0, 15)) {
    if (issue.comments > 0 && Number.isSafeInteger(issue.number)) comments[issue.number] = await github(`issues/${issue.number}/comments?per_page=30`);
  }
  incidentFeedAvailable = true;
} catch { console.error('Incident history could not be refreshed; the public page will disclose this.'); }
const snapshot = buildStatusSnapshot({ histories, issues, comments, incidentFeedAvailable, monitorSucceeded: process.env.UPPTIME_OUTCOME === 'success' });
await writeFile('status.json', JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Prepared ${snapshot.components.length} public observations and ${snapshot.incidents.length} incident summaries.`);
