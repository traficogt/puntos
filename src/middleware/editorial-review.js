import { Router } from 'express';
import { fileURLToPath } from 'node:url';
import { guideCatalog } from '../content/guides/catalog.js';
import { renderGuideArticle, renderGuidesHub } from '../content/guides/render.js';

// Unlisted editorial review, deliberately separate from the published guide catalog.
// This identifier is a discoverability measure, not authentication.
export const EDITORIAL_REVIEW_PATH = '/revision-editorial/7fc4175cd754b74d9ebe8791/';
export const GUIDE_PREVIEW_PATH = '/revision-editorial/a6517680e9c4b4b7afde1ba7/';
// Keep this review limited to the five approved articles, including after publication.
const previewSlugs = Object.freeze([
  'como-disenar-programa-fidelizacion',
  'cuanto-cuesta-una-recompensa',
  'cuantas-visitas-para-una-recompensa',
  'ventaja-empezar-con-sellos',
  'como-mostrar-progreso-recompensas'
]);
const previewArticles = previewSlugs.map(slug => {
  const article = guideCatalog.articles.find(item => item.slug === slug);
  if (!article?.body?.length) throw new Error(`Falta el artículo aprobado para revisión: ${slug}`);
  return article;
});
const contentDirectory = fileURLToPath(new URL('../content/article-review/', import.meta.url));
const files = new Map([
  [EDITORIAL_REVIEW_PATH, 'index.html'],
  [EDITORIAL_REVIEW_PATH + 'article.css', 'article.css'],
  [EDITORIAL_REVIEW_PATH + 'volver-640.webp', 'volver-640.webp'],
  [EDITORIAL_REVIEW_PATH + 'volver-1152.webp', 'volver-1152.webp'],
  [EDITORIAL_REVIEW_PATH + 'progreso-640.webp', 'progreso-640.webp'],
  [EDITORIAL_REVIEW_PATH + 'progreso-1152.webp', 'progreso-1152.webp']
]);

export function createEditorialReview({ marketingOrigin = 'https://puntosfieles.com' } = {}) {
  const origin = new URL(marketingOrigin).origin;
  const router = Router();
  router.use((req, res, next) => {
    if (!/^\/revision-editorial(?:\/|$)/i.test(req.path)) return next();
    res.set({
      'X-Robots-Tag': 'noindex, nofollow, noarchive, noimageindex',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer'
    });
    if (!['GET', 'HEAD'].includes(req.method)) {
      return res.set('Allow', 'GET, HEAD').status(405).type('text/plain').send('Método no permitido');
    }
    if ([EDITORIAL_REVIEW_PATH.slice(0, -1), EDITORIAL_REVIEW_PATH + 'index.html'].includes(req.path)) {
      return res.redirect(307, EDITORIAL_REVIEW_PATH);
    }
    if ([GUIDE_PREVIEW_PATH.slice(0, -1), GUIDE_PREVIEW_PATH + 'index.html'].includes(req.path)) {
      return res.redirect(307, GUIDE_PREVIEW_PATH);
    }
    if (req.path === GUIDE_PREVIEW_PATH) {
      return res.type('html').send(renderGuidesHub({ origin, articles: previewArticles, previewPath: GUIDE_PREVIEW_PATH }));
    }
    const article = previewArticles.find(item => req.path === GUIDE_PREVIEW_PATH + item.slug || req.path === GUIDE_PREVIEW_PATH + item.slug + '/');
    if (article) {
      if (req.path.endsWith('/')) return res.redirect(307, GUIDE_PREVIEW_PATH + article.slug);
      return res.type('html').send(renderGuideArticle({ origin, article, preview: { indexPath: GUIDE_PREVIEW_PATH, articles: previewArticles } }));
    }
    const file = files.get(req.path);
    if (!file) return res.status(404).type('text/plain').send('Vista previa no encontrada');
    return res.sendFile(file, { root: contentDirectory, cacheControl: false, lastModified: false });
  });
  return router;
}
