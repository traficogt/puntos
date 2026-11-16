const ids = ['sitio', 'acceso', 'sistema', 'ayuda', 'soporte'];
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const trusted = item => ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(item?.author_association) || item?.user?.login === 'github-actions[bot]';
const publicUrl = value => typeof value === 'string' && /^https:\/\/github\.com\/traficogt\/puntos-estado\/issues\/[1-9]\d*$/.test(value) ? value : null;
const text = (value, max) => String(value || '').replace(/<!--[\s\S]*?-->/g, '').trim().slice(0, max);

export function buildStatusSnapshot({ histories = {}, issues = [], comments = {}, now = new Date().toISOString(), monitorSucceeded = false, incidentFeedAvailable = false } = {}) {
  if (!date(now)) throw new TypeError('Invalid snapshot time');
  const components = ids.map(id => {
    const row = Object.hasOwn(histories, id) ? histories[id] : {};
    const checkedAt = date(row?.lastUpdated);
    return { id, state: monitorSucceeded && ['up', 'down', 'degraded'].includes(row?.status) ? row.status : 'unknown', checkedAt };
  });
  const starts = ids.map(id => date(histories[id]?.startTime)).filter(Boolean).sort();
  const incidents = issues.filter(item => !item.pull_request && trusted(item) && publicUrl(item.html_url) && item.labels?.some(label => ['status', 'maintenance'].includes(label.name)))
    .slice(0, 50).map(item => ({
      title: text(item.title, 180), body: text(item.body, 1800), url: publicUrl(item.html_url),
      state: item.state === 'closed' ? 'closed' : 'open',
      maintenance: item.labels.some(label => label.name === 'maintenance'),
      openedAt: date(item.created_at), closedAt: date(item.closed_at),
      updates: (comments[item.number] || []).filter(trusted).slice(-5).map(update => ({ body: text(update.body, 1200), at: date(update.created_at) }))
    }));
  return { version: 1, generatedAt: now, startedAt: starts[0] || null, components, incidents, incidentsCheckedAt: incidentFeedAvailable ? now : null };
}
