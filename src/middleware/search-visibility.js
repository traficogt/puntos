import { normalizeHostHeader, isAppRoutePath } from '../utils/app-host-routing.js';
import { guideCatalog, getGuideSearchPaths, parseGuideCatalog } from '../content/guides/catalog.js';

const publicPaths = ['/', '/soporte', '/privacidad', '/terminos', '/precios'];
const aliases = new Map([['/index.html', '/'], ['/soporte.html', '/soporte'], ['/privacidad.html', '/privacidad'], ['/terminos.html', '/terminos']]);
const xmlEscape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function createSearchVisibility({ marketingOrigin, appOrigin, guides = guideCatalog }) {
  const marketing = new URL(marketingOrigin);
  const marketingHost = normalizeHostHeader(marketing.host);
  const appHost = normalizeHostHeader(new URL(appOrigin).host);
  const searchablePaths = [...publicPaths, ...getGuideSearchPaths(parseGuideCatalog(guides))];
  return (req, res, next) => {
    const host = normalizeHostHeader(req.get('host'));
    const publicHost = host === marketingHost;
    const appOnlyHost = host === appHost && appHost !== marketingHost;
    const publicPage = searchablePaths.includes(req.path) || aliases.has(req.path);
    // Static extension fallback also serves /customer, /staff-login and HTML fragments.
    const htmlPage = !/\.[^/]+$/.test(req.path) || /\.html$/i.test(req.path);
    const privatePath = (htmlPage && !publicPage) || isAppRoutePath(req.path) || /^\/(?:api|app-preview)(?:\/|$)/i.test(req.path);
    if (!publicHost || appOnlyHost || privatePath) res.set('X-Robots-Tag', 'noindex, nofollow');
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path === '/robots.txt') {
      // Allow crawling of the login shells so crawlers can actually read noindex.
      res.set('Cache-Control', 'public, max-age=3600');
      return res.type('text/plain').send(`User-agent: *\nAllow: /\n${publicHost && !appOnlyHost ? `\nSitemap: ${marketing.origin}/sitemap.xml\n` : ''}`);
    }
    if (req.path === '/sitemap.xml') {
      if (!publicHost || appOnlyHost) return res.status(404).type('text/plain').send('Not found');
      res.set('Cache-Control', 'public, max-age=3600');
      return res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${searchablePaths.map(path => `  <url><loc>${xmlEscape(new URL(path, marketing).href)}</loc></url>`).join('\n')}\n</urlset>\n`);
    }
    if (publicHost && !appOnlyHost && aliases.has(req.path)) {
      const target = new URL(aliases.get(req.path), marketing);
      target.search = new URL(req.originalUrl, marketing).search;
      return res.redirect(301, target.href);
    }
    next();
  };
}
