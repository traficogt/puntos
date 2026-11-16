import express from 'express';
import path from 'node:path';

/** Public documents; case data remains behind the authenticated/capability API. */
export function createSelfServiceWeb(publicDir) {
  const router = express.Router({ strict: true });
  router.get(['/calculadora/', '/calculadora.html', '/estado/', '/estado.html'], (req, res) => {
    const target = req.path.startsWith('/calculadora') ? '/calculadora' : '/estado';
    return res.redirect(308, target);
  });
  router.use('/ayuda', express.static(path.join(publicDir, 'ayuda'), { redirect: true, index: 'index.html' }));
  router.use('/ayuda', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.set('X-Robots-Tag', 'noindex, nofollow');
    return res.status(404).sendFile('404.html', { root: path.join(publicDir, 'ayuda') });
  });
  for (const [route, file] of [['/calculadora', 'calculadora.html'], ['/estado', 'estado.html'], ['/super/soporte', 'super-support.html']]) {
    router.get(route, (_req, res) => {
      if (route !== '/calculadora') res.set('Cache-Control', 'no-store');
      return res.sendFile(file, { root: publicDir });
    });
  }
  return router;
}
