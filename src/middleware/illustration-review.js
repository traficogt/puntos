import { Router } from 'express';
import { fileURLToPath } from 'node:url';

// An unlisted review link, not an authentication mechanism.
export const ILLUSTRATION_REVIEW_PATH = '/revision-ilustraciones/7c851a8fe3c69c68269df647/';
export const GUATEMALA_REVIEW_PATH = '/revision-ilustraciones/aa93b82b2b9f4e6979c8a2b4/';
const collections = [
  {
    route: ILLUSTRATION_REVIEW_PATH,
    directory: 'illustration-review',
    images: ['01-plaza', '02-equilibrio', '03-barberia', '04-raices', '05-relojero', '06-confianza', '07-puente', '08-libreria', '09-tiempo', '10-ensamble']
  },
  {
    route: GUATEMALA_REVIEW_PATH,
    directory: 'guatemala-review',
    images: ['01-parque-central', '02-antigua', '03-atitlan', '04-xela', '05-flores']
  }
];
const files = new Map();
const redirects = new Map();
for (const { route, directory, images } of collections) {
  const root = fileURLToPath(new URL(`../content/${directory}/`, import.meta.url));
  const allowed = ['index.html', 'gallery.css', ...images.flatMap(name => [`${name}.html`, `${name}-768.webp`, `${name}-1536.webp`])];
  for (const file of allowed) files.set(route + (file === 'index.html' ? '' : file), { file, root });
  for (const alias of [route.slice(0, -1), route + 'index.html']) redirects.set(alias, route);
}

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
    const redirect = redirects.get(req.path);
    if (redirect) return res.redirect(307, redirect);
    const asset = files.get(req.path);
    if (!asset) return res.status(404).type('text/plain').send('Vista previa no encontrada');
    return res.sendFile(asset.file, { root: asset.root, cacheControl: false, lastModified: false });
  });
  return router;
}
