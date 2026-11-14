import { Router } from 'express';
import { fileURLToPath } from 'node:url';

// An unlisted review link, not an authentication mechanism.
export const ILLUSTRATION_REVIEW_PATH = '/revision-ilustraciones/7c851a8fe3c69c68269df647/';
const contentDirectory = fileURLToPath(new URL('../content/illustration-review/', import.meta.url));
const imageNames = ["01-plaza", "02-equilibrio", "03-barberia", "04-raices", "05-relojero", "06-confianza", "07-puente", "08-libreria", "09-tiempo", "10-ensamble"];
const allowedFiles = ['index.html', 'gallery.css', ...imageNames.flatMap(name => [`${name}.html`, `${name}-768.webp`, `${name}-1536.webp`])];
const files = new Map(allowedFiles.map(file => [ILLUSTRATION_REVIEW_PATH + (file === 'index.html' ? '' : file), file]));

export function createIllustrationReview() {
  const router = Router();
  router.use((req, res, next) => {
    if (!/^\/revision-ilustraciones(?:\/|$)/i.test(req.path)) return next();
    res.set({
      'X-Robots-Tag': 'noindex, nofollow, noarchive, noimageindex',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer'
    });
    if (!['GET', 'HEAD'].includes(req.method)) {
      return res.set('Allow', 'GET, HEAD').status(405).type('text/plain').send('Método no permitido');
    }
    if ([ILLUSTRATION_REVIEW_PATH.slice(0, -1), ILLUSTRATION_REVIEW_PATH + 'index.html'].includes(req.path)) {
      return res.redirect(307, ILLUSTRATION_REVIEW_PATH);
    }
    const file = files.get(req.path);
    if (!file) return res.status(404).type('text/plain').send('Vista previa no encontrada');
    return res.sendFile(file, { root: contentDirectory, cacheControl: false, lastModified: false });
  });
  return router;
}
