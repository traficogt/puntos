import express from 'express';
import { fileURLToPath } from 'node:url';
import { guideCatalog, parseGuideCatalog } from './catalog.js';
import { createGuides } from '../../middleware/guides.js';
import { createSearchVisibility } from '../../middleware/search-visibility.js';

// Development-only preview, bound to loopback; it never changes the saved catalog.
const slug = process.argv[2];
const selected = guideCatalog.articles.find(article => article.slug === slug);
if (slug && !selected) {
  throw new Error('No existe una guía con ese slug en el catálogo.');
}
const guides = parseGuideCatalog({ ...guideCatalog, articles: guideCatalog.articles.map(article => article.slug === slug ? { ...article, status: 'published' } : article) });
// A selected future article is previewed at its release time without changing saved dates.
const previewInstant = Math.max(Date.now(), selected?.publishAt ? Date.parse(selected.publishAt) : selected?.datePublished ? Date.parse(`${selected.datePublished}T12:00:00-06:00`) : 0);
const now = selected ? () => previewInstant : Date.now;
const port = Number(process.env.GUIDES_PREVIEW_PORT || 4280);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('GUIDES_PREVIEW_PORT debe estar entre 1024 y 65535.');
const origin = `http://127.0.0.1:${port}`;
const app = express();
app.use((_req, res, next) => { res.set('X-Robots-Tag', 'noindex, follow, noarchive'); next(); });
app.use(createSearchVisibility({ marketingOrigin: origin, appOrigin: origin, guides, now }));
app.use(createGuides({ marketingOrigin: origin, guides, now }));
app.use(express.static(fileURLToPath(new URL('../../../public', import.meta.url))));
app.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Vista previa local: ${origin}/guias/${slug || ''}\n`);
});
