import express from 'express';
import path from 'node:path';

// Expo's browser preview uses generated style sheets and inline layout styles.
// Scope that allowance to this preview; the existing PF web UI keeps its CSP.
export function createMobilePreview(publicDirectory) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    if (req.baseUrl === req.originalUrl && (req.method === 'GET' || req.method === 'HEAD')) return res.redirect(302, `${req.baseUrl}/`);
    next();
  });
  const directory = path.join(publicDirectory, 'app-preview');
  router.use(express.static(directory));
  router.get('*', (req, res, next) => {
    if (path.extname(req.path)) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(directory, 'index.html'));
  });
  return router;
}
