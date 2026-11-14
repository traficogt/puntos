import { Router } from 'express';
import { fileURLToPath } from 'node:url';

// Unlisted editorial review, deliberately separate from the published guide catalog.
// This identifier is a discoverability measure, not authentication.
export const EDITORIAL_REVIEW_PATH = '/revision-editorial/7fc4175cd754b74d9ebe8791/';
const contentDirectory = fileURLToPath(new URL('../content/article-review/', import.meta.url));
const files = new Map([
  [EDITORIAL_REVIEW_PATH, 'index.html'],
  [EDITORIAL_REVIEW_PATH + 'article.css', 'article.css'],
  [EDITORIAL_REVIEW_PATH + 'volver-640.webp', 'volver-640.webp'],
  [EDITORIAL_REVIEW_PATH + 'volver-1152.webp', 'volver-1152.webp'],
  [EDITORIAL_REVIEW_PATH + 'progreso-640.webp', 'progreso-640.webp'],
  [EDITORIAL_REVIEW_PATH + 'progreso-1152.webp', 'progreso-1152.webp']
]);

export function createEditorialReview() {
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
    const file = files.get(req.path);
    if (!file) return res.status(404).type('text/plain').send('Vista previa no encontrada');
    return res.sendFile(file, { root: contentDirectory, cacheControl: false, lastModified: false });
  });
  return router;
}
