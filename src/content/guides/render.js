const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';

export function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function formatDate(value) {
  return new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function shell({ title, description, canonical, content, indexable, articleSchema = null, hub = false }) {
  const robots = indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow, noarchive';
  const image = new URL('/images/coffee-gathering.webp', canonical).href;
  const structured = articleSchema ? `<script type="application/ld+json">${JSON.stringify(articleSchema).replaceAll('<', '\\u003c')}</script>` : '';
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)} | PuntosFieles</title>
  <meta name="description" content="${escapeHtml(description)}"/>
  <meta name="robots" content="${robots}"/>
  <link rel="canonical" href="${escapeHtml(canonical)}"/>
  <meta property="og:type" content="${articleSchema ? 'article' : 'website'}"/>
  <meta property="og:site_name" content="PuntosFieles"/>
  <meta property="og:locale" content="es_GT"/>
  <meta property="og:title" content="${escapeHtml(title)} | PuntosFieles"/>
  <meta property="og:description" content="${escapeHtml(description)}"/>
  <meta property="og:url" content="${escapeHtml(canonical)}"/>
  <meta property="og:image" content="${escapeHtml(image)}"/>
  <meta property="og:image:alt" content="Tres personas comparten un café alrededor de una mesa."/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${escapeHtml(title)} | PuntosFieles"/>
  <meta name="twitter:description" content="${escapeHtml(description)}"/>
  <meta name="twitter:image" content="${escapeHtml(image)}"/>
  <meta name="theme-color" content="#f7f5ef"/>
  <link rel="icon" href="/icon.svg?v=4" type="image/svg+xml"/>
  <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=4"/>
  <link rel="stylesheet" href="/styles/fonts.css?v=1"/>
  <link rel="stylesheet" href="/styles/marketing.css?v=4"/>
  <link rel="stylesheet" href="/guides/guides.css?v=1"/>
  ${structured}
</head>
<body class="page-marketing page-guides">
  <a class="skip-link" href="#contenido">Saltar al contenido</a>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="/" aria-label="PuntosFieles, inicio"><img src="/icon.svg?v=4" alt="" width="36" height="36"/><span>PuntosFieles<span class="brand-period">.</span></span></a>
      <nav class="guides-nav" aria-label="Navegación principal"><a href="/guias/"${hub ? ' aria-current="page"' : ''}>Guías</a><a href="/#contacto">Solicitar demo ${arrow}</a></nav>
    </div>
  </header>
  <main id="contenido" tabindex="-1">${content}</main>
  <footer class="site-footer guides-footer">
    <div class="container footer-top"><a href="/" class="brand" aria-label="PuntosFieles, inicio"><img src="/icon.svg?v=4" alt="" width="32" height="32"/><span>PuntosFieles<span class="brand-period">.</span></span></a><p>Lealtad que sí se siente.</p><a class="back-top" href="#contenido">Volver arriba <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></a></div>
    <div class="container footer-bottom"><span>Creado por <a href="https://viasolvia.com" target="_blank" rel="noopener noreferrer">Viasolvia</a></span><nav aria-label="Información y ayuda"><a href="/guias/"${hub ? ' aria-current="page"' : ''}>Guías</a><a href="/soporte">Soporte</a><a href="/privacidad">Privacidad</a><a href="/terminos">Términos</a></nav></div>
  </footer>
</body>
</html>`;
}

export function renderGuidesHub({ origin, articles }) {
  const intro = `<div class="guides-intro"><h1>Guías para<br/><span>tu negocio.</span></h1><p>Un espacio para entender la lealtad, diseñar recompensas y cuidar la relación con tus clientes.</p></div>`;
  const empty = `<section class="guides-empty" aria-labelledby="guides-empty-title"><h2 id="guides-empty-title">Las primeras guías<br/> están en camino.</h2><p>Todavía no hay artículos publicados. Mientras tanto, conoce cómo funciona PuntosFieles o conversemos sobre tu negocio.</p><div class="guides-actions"><a class="button" href="/#como-funciona">Conocer PuntosFieles ${arrow}</a><a class="text-link" href="/#contacto">Solicitar una demo</a></div></section>`;
  const listing = `<section class="guides-library" aria-labelledby="guides-library-title"><h2 id="guides-library-title">Para leer y poner en práctica.</h2><ul class="guides-list">${articles.map(article => `<li><article><h3><a href="/guias/${escapeHtml(article.slug)}">${escapeHtml(article.title)} ${arrow}</a></h3><p>${escapeHtml(article.description)}</p>${article.datePublished ? `<time datetime="${article.datePublished}">${formatDate(article.datePublished)}</time>` : ''}</article></li>`).join('')}</ul></section>`;
  return shell({ title: 'Guías de lealtad y recompensas para negocios', description: 'Guías de PuntosFieles sobre programas de lealtad, puntos y recompensas para negocios. Consulta las publicaciones disponibles y conoce nuestra plataforma.', canonical: new URL('/guias/', origin).href, indexable: articles.length > 0, hub: true, content: `<div class="container guides-hub">${intro}${articles.length ? listing : empty}</div>` });
}

function renderBlocks(body) {
  return body.map((block, index) => {
    if (block.type === 'heading') return `<h2 id="seccion-${index + 1}">${escapeHtml(block.text)}</h2>`;
    if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${block.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`;
    }
    if (block.type === 'link') return `<p><a href="${escapeHtml(block.href)}">${escapeHtml(block.text)}</a></p>`;
    return `<p>${escapeHtml(block.text)}</p>`;
  }).join('\n');
}

export function renderGuideArticle({ origin, article }) {
  const canonical = new URL(`/guias/${article.slug}`, origin).href;
  const schema = {
    '@context': 'https://schema.org', '@type': 'Article', headline: article.title,
    description: article.description, inLanguage: 'es', mainEntityOfPage: canonical, url: canonical,
    publisher: { '@type': 'Organization', name: 'PuntosFieles', url: new URL('/', origin).href }
  };
  if (article.author) schema.author = { '@type': article.author.type, name: article.author.name, ...(article.author.url ? { url: article.author.url } : {}) };
  if (article.datePublished) schema.datePublished = article.datePublished;
  if (article.dateModified) schema.dateModified = article.dateModified;
  const author = article.author ? `<span>Por ${article.author.url ? `<a href="${escapeHtml(article.author.url)}">${escapeHtml(article.author.name)}</a>` : escapeHtml(article.author.name)}</span>` : '';
  const published = article.datePublished ? `<span>Publicado el <time datetime="${article.datePublished}">${formatDate(article.datePublished)}</time></span>` : '';
  const updated = article.dateModified ? `<span>Actualizado el <time datetime="${article.dateModified}">${formatDate(article.dateModified)}</time></span>` : '';
  const content = `<article class="container guide-article"><nav class="guides-breadcrumb" aria-label="Ruta de navegación"><a href="/">Inicio</a><span aria-hidden="true">/</span><a href="/guias/">Guías</a></nav><header class="guide-heading"><h1>${escapeHtml(article.title)}</h1><p class="guide-description">${escapeHtml(article.description)}</p>${author || published || updated ? `<div class="guide-meta">${author}${published}${updated}</div>` : ''}</header><div class="guide-body">${renderBlocks(article.body)}</div><footer class="guide-end"><a class="text-link" href="/guias/">Ver todas las guías ${arrow}</a><p>¿Quieres poner tu programa de lealtad en marcha? <a href="/#contacto">Conversemos sobre tu negocio.</a></p></footer></article>`;
  return shell({ title: article.title, description: article.description, canonical, content, indexable: true, articleSchema: schema });
}

export function renderGuideNotFound({ origin }) {
  return shell({ title: 'Guía no disponible', description: 'Esta guía no está disponible. Consulta las guías publicadas de PuntosFieles o vuelve al inicio.', canonical: new URL('/guias/', origin).href, indexable: false, content: `<div class="container guides-unavailable"><h1>Esta guía no<br/><span>está disponible.</span></h1><p>Puede que el enlace haya cambiado. Puedes volver a la sección de guías para consultar las publicaciones disponibles.</p><a class="button" href="/guias/">Volver a las guías ${arrow}</a></div>` });
}
