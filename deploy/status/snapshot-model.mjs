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
  const snapshot = { version: 1, generatedAt: now, startedAt: starts[0] || null, components, incidents, incidentsCheckedAt: incidentFeedAvailable ? now : null };
  // Keep the complete list of selected incident references while shedding
  // older detail before reaching the public client's 200k-character limit.
  for (let index = incidents.length - 1; index >= 0 && JSON.stringify(snapshot, null, 2).length > 180000; index--) {
    incidents[index].body = ''; incidents[index].updates = []; snapshot.incidentsCheckedAt = null;
  }
  return snapshot;
}

const incident = item => item && !item.pull_request && trusted(item) && publicUrl(item.html_url)
  && Number.isSafeInteger(item.number) && item.number > 0
  && item.labels?.some(label => ['status', 'maintenance'].includes(label.name));

// Never follow arbitrary Link URLs. Only extract bounded page numbers for the
// exact GitHub endpoint already requested; credentials stay on that endpoint.
function pagination(link, endpoint) {
  /** @type {{next?: number, last?: number}} */
  const pages = {};
  for (const match of String(link || '').matchAll(/<([^>]+)>;\s*rel="(next|last)"/g)) {
    const url = new URL(match[1]);
    if (url.origin !== 'https://api.github.com' || url.pathname !== `/repos/traficogt/puntos-estado/${endpoint}`) throw new Error('Unexpected pagination endpoint');
    const page = Number(url.searchParams.get('page'));
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) throw new Error('Invalid pagination page');
    pages[match[2]] = page;
  }
  return pages;
}

/** Read bounded incident history without allowing unrelated issues to hide open incidents. */
export async function fetchIncidentFeed(request, { maxOpenPages = 5, displayLimit = 50, maxCommentPages = 3, maxCommentRequests = 40 } = {}) {
  let complete = true;
  const records = new Map();
  const comments = {};
  async function page(path) {
    const response = await request(path);
    if (!response.ok) throw new Error('Incident registry unavailable');
    const items = await response.json();
    if (!Array.isArray(items) || items.length > 100) throw new Error('Invalid incident page');
    return { items, ...pagination(response.headers.get('link'), path.split('?')[0]) };
  }
  // Two labels are separate OR queries, never a comma-separated AND filter.
  // Every open incident is considered before any closed historical record.
  for (const state of ['open', 'closed']) {
    for (const label of ['status', 'maintenance']) {
      let next = 1;
      const limit = state === 'open' ? maxOpenPages : 1;
      try {
        for (let count = 0; count < limit && next; count++) {
          const current = next;
          const result = await page(`issues?state=${state}&labels=${label}&sort=updated&direction=desc&per_page=100&page=${current}`);
          for (const item of result.items.filter(incident)) records.set(item.number, item);
          next = result.next || 0;
          if (next && next <= current) throw new Error('Pagination did not advance');
        }
        if (next) complete = false;
      } catch { complete = false; }
    }
  }
  const ordered = [...records.values()].sort((a, b) => {
    const openOrder = Number(a.state === 'closed') - Number(b.state === 'closed');
    return openOrder || (Date.parse(b.updated_at || b.created_at) || 0) - (Date.parse(a.updated_at || a.created_at) || 0);
  });
  if (ordered.length > displayLimit) complete = false;
  const issues = ordered.slice(0, displayLimit);
  let commentRequests = 0;
  for (const issue of issues) {
    if (!(issue.comments > 0)) continue;
    if (!Number.isSafeInteger(issue.comments) || issue.comments > 100000000) { complete = false; continue; }
    try {
      let current = Math.max(1, Math.ceil(issue.comments / 100));
      let recent = [];
      let read = 0;
      let latestPage = null;
      while (current > 0 && recent.length < 5) {
        if (read >= maxCommentPages || commentRequests >= maxCommentRequests) { complete = false; break; }
        read++; commentRequests++;
        const result = await page(`issues/${issue.number}/comments?per_page=100&page=${current}`);
        // The issue count can change between list and comment requests. Honor
        // the live last-page link before retaining any potentially older page.
        if (latestPage === null) {
          if (result.last && result.last !== current && (result.last > current || result.items.length === 0)) { current = result.last; continue; }
          if (result.next) { complete = false; break; }
          latestPage = current;
        } else if (result.last && result.last > latestPage) { complete = false; break; }
        recent = [...result.items.filter(trusted), ...recent];
        current--;
      }
      comments[issue.number] = recent.slice(-5);
    } catch {
      complete = false;
      // An outage or exhausted API quota should not cause dozens of serial
      // timeouts. Retain the bounded incident list and disclose incomplete data.
      break;
    }
  }
  return { issues, comments, incidentFeedAvailable: complete };
}
