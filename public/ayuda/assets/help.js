(() => {
  'use strict';
  const input = document.querySelector('#help-query');
  const status = document.querySelector('#search-status');
  const results = document.querySelector('#search-results');
  const close = document.querySelector('#close-search');
  let worker, ready = false, pending = '', timer, fallback;
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = value => normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
  function clear() { results.replaceChildren(); results.hidden = true; close.hidden = true; }
  function show(items) {
    if (input.value.trim().length < 2) { clear(); return; }
    const unique = new Map();
    for (const item of items) { const key = item.location.split('#')[0]; if (!unique.has(key)) unique.set(key, item); }
    clear(); results.hidden = false; close.hidden = false;
    const chosen = [...unique.values()].slice(0, 12);
    status.textContent = chosen.length ? `${unique.size} guías encontradas${unique.size > 12 ? '; mostramos las primeras 12' : ''}.` : 'No encontramos esa búsqueda. Prueba con «QR», «canje» o elige tu tarea en el menú.';
    for (const item of chosen) {
      const block = document.createElement('div'); block.className = 'search-result';
      const link = document.createElement('a'); link.href = `/ayuda/${item.location}`; link.textContent = item.title;
      const snippet = document.createElement('p'); snippet.textContent = (item.summary || item.text || '').slice(0, 180) + '…';
      block.append(link, snippet); results.append(block);
    }
  }
  async function simpleSearch() {
    try {
      fallback ||= fetch('/ayuda/search/search_index.json', { credentials: 'omit' }).then(response => { if (!response.ok) throw new Error('index'); return response.json(); });
      const data = await fallback;
      const terms = words(input.value);
      show(data.docs.filter(doc => terms.every(term => normalize(`${doc.title} ${doc.text}`).includes(term))));
    } catch { fallback = undefined; clear(); status.textContent = 'No pudimos cargar la búsqueda. Revisa tu conexión o elige una guía en el menú.'; }
  }
  function search() {
    pending = words(input.value).join(' ');
    if (input.value.trim().length < 2 || !pending) { clear(); status.textContent = 'Escribe al menos dos letras. Puedes buscar QR.'; return; }
    if (worker && ready) worker.postMessage({ query: pending });
    else if (worker) status.textContent = 'Preparando la búsqueda…';
    else void simpleSearch();
  }
  function start() {
    if (worker || fallback) return;
    if (!window.Worker) { void simpleSearch(); return; }
    try {
      worker = new Worker('/ayuda/search/worker.js');
      worker.onmessage = event => { if (event.data.allowSearch) { ready = true; if (input.value.trim()) search(); else status.textContent = 'Búsqueda lista. Escribe al menos dos letras.'; } else if (event.data.results) show(event.data.results); };
      worker.onerror = () => { worker?.terminate(); worker = undefined; void simpleSearch(); };
      worker.postMessage({ init: true });
    } catch { worker = undefined; void simpleSearch(); }
  }
  input.addEventListener('focus', start, { once: true });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { start(); search(); }, 160); });
  input.form.addEventListener('submit', event => { event.preventDefault(); start(); search(); });
  close.addEventListener('click', () => { input.value = ''; clear(); status.textContent = 'Elige otra búsqueda o una guía por tarea.'; input.focus(); });
  input.addEventListener('keydown', event => { if (event.key === 'Escape') close.click(); });
  document.querySelectorAll('.print-page').forEach(button => button.addEventListener('click', () => window.print()));
  const query = new URLSearchParams(location.search).get('q'); if (query) { input.value = query.slice(0, 200); start(); search(); }
  const menu = document.querySelector('.guide-menu'); if (matchMedia('(max-width:899px)').matches) menu.open = false;
})();
