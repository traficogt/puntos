import { normalizeHostHeader } from '../utils/app-host-routing.js';
import { guideCatalog, getPublishedGuides, parseGuideCatalog } from '../content/guides/catalog.js';
import { renderGuidesHub, renderGuideArticle, renderGuideNotFound } from '../content/guides/render.js';

const publicSlashAliases = new Map([['/soporte/', '/soporte'], ['/privacidad/', '/privacidad'], ['/terminos/', '/terminos']]);

/** Mount after search visibility and before host-split/static document handlers. */
export function createGuides({ marketingOrigin, guides = guideCatalog }) {
  const origin = new URL(marketingOrigin).origin;
  const host = normalizeHostHeader(new URL(origin).host);
  const articles = getPublishedGuides(parseGuideCatalog(guides));
  const bySlug = new Map(articles.map(article => [article.slug, article]));
  return (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) || normalizeHostHeader(req.get('host')) !== host) return next();
    const queryIndex = req.originalUrl.indexOf('?');
    const query = queryIndex < 0 ? '' : req.originalUrl.slice(queryIndex);
    const alias = publicSlashAliases.get(req.path);
    if (alias) return res.redirect(308, alias + query);
    if (req.path !== '/guias' && !req.path.startsWith('/guias/')) return next();
    res.set('Cache-Control', 'no-cache');
    if (req.path === '/guias') return res.redirect(308, '/guias/' + query);
    if (req.path === '/guias/') {
      if (articles.length === 0) res.set('X-Robots-Tag', 'noindex, follow, noarchive');
      return res.type('html').send(renderGuidesHub({ origin, articles }));
    }
    const match = req.path.match(/^\/guias\/([a-z0-9]+(?:-[a-z0-9]+)*)(\/?)$/);
    const article = match ? bySlug.get(match[1]) : undefined;
    if (!article) {
      res.set('X-Robots-Tag', 'noindex, follow, noarchive');
      return res.status(404).type('html').send(renderGuideNotFound({ origin }));
    }
    if (match[2]) return res.redirect(308, `/guias/${article.slug}${query}`);
    return res.type('html').send(renderGuideArticle({ origin, article }));
  };
}
