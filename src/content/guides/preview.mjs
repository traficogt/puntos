import express from 'express';
import { fileURLToPath } from 'node:url';
import { guideCatalog, parseGuideCatalog } from './catalog.js';
import { createGuides } from '../../middleware/guides.js';
import { createSearchVisibility } from '../../middleware/search-visibility.js';

// Development-only preview, bound to loopback; it never changes the saved catalog.
const slug = process.argv[2];
if (slug && !guideCatalog.articles.some(article => article.slug === slug)) {
  throw new Error('No existe una guía con ese slug en el catálogo.');
}
const guides = parseGuideCatalog({ ...guideCatalog, articles: guideCatalog.articles.map(article => article.slug === slug ? { ...article, status: 'published' } : article) });
const port = Number(process.env.GUIDES_PREVIEW_PORT || 4280);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('GUIDES_PREVIEW_PORT debe estar entre 1024 y 65535.');
const origin = `http://127.0.0.1:${port}`;
const app = express();
app.use((_req, res, next) => { res.set('X-Robots-Tag', 'noindex, follow, noarchive'); next(); });
app.use(createSearchVisibility({ marketingOrigin: origin, appOrigin: origin, guides }));
app.use(createGuides({ marketingOrigin: origin, guides }));
app.use(express.static(fileURLToPath(new URL('../../../public', import.meta.url))));
app.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Vista previa local: ${origin}/guias/${slug || ''}\n`);
});
