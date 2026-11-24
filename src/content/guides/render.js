const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';

/** @typedef {(typeof import("./catalog.js").guideCatalog)["articles"][number]} GuideArticle */
/** @typedef {NonNullable<GuideArticle["references"]>[number]} GuideReference */
/** @typedef {NonNullable<GuideArticle["body"]>[number]} GuideBlock */
/** @typedef {{ src: string, srcSmall?: string, alt: string, width: number, height: number }} GuideImage */
/** @typedef {{ label: string, render: (escapedLabel: string) => string }} TextDecoration */

/** @param {unknown} value stringified before escaping */
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** @param {string} value a calendar date, YYYY-MM-DD */
function formatDate(value) {
  return new Intl.DateTimeFormat("es-GT", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

/**
 * @param {{
 *   title: string,
 *   description: string | undefined,
 *   canonical: string,
 *   content: string,
 *   indexable: boolean,
 *   articleSchema?: Record<string, unknown> | null,
 *   hub?: boolean,
 *   hero?: GuideArticle["hero"] | null,
 *   preview?: boolean,
 *   guidesPath?: string,
 * }} options
 */
function shell({
  title,
  description,
  canonical,
  content,
  indexable,
  articleSchema = null,
  hub = false,
  hero = null,
  preview = false,
  guidesPath = "/guias/",
}) {
  const robots = preview
    ? "noindex, nofollow, noarchive, noimageindex"
    : indexable
      ? "index, follow, max-image-preview:large"
      : "noindex, follow, noarchive";
  const image = new URL(hero?.src || "/images/coffee-gathering.webp", canonical).href;
  const imageAlt = hero?.alt || "Tres personas comparten un café alrededor de una mesa.";
  const structured = articleSchema
    ? `<script type="application/ld+json">${JSON.stringify(articleSchema).replaceAll("<", "\\u003c")}</script>`
    : "";
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)} | PuntosFieles</title>
  <meta name="description" content="${escapeHtml(description)}"/>
  <meta name="robots" content="${robots}"/>
  <link rel="canonical" href="${escapeHtml(canonical)}"/>
  <meta property="og:type" content="${articleSchema ? "article" : "website"}"/>
  <meta property="og:site_name" content="PuntosFieles"/>
  <meta property="og:locale" content="es_GT"/>
  <meta property="og:title" content="${escapeHtml(title)} | PuntosFieles"/>
  <meta property="og:description" content="${escapeHtml(description)}"/>
  <meta property="og:url" content="${escapeHtml(canonical)}"/>
  <meta property="og:image" content="${escapeHtml(image)}"/>
  <meta property="og:image:alt" content="${escapeHtml(imageAlt)}"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${escapeHtml(title)} | PuntosFieles"/>
  <meta name="twitter:description" content="${escapeHtml(description)}"/>
  <meta name="twitter:image" content="${escapeHtml(image)}"/>
  <meta name="theme-color" content="#f7f5ef"/>
  <link rel="icon" href="/icon.svg?v=4" type="image/svg+xml"/>
  <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=4"/>
  <link rel="stylesheet" href="/styles/fonts.css?v=1"/>
  <link rel="stylesheet" href="/styles/marketing.css?v=4"/>
  <link rel="stylesheet" href="/guides/guides.css?v=3"/>
  ${structured}
</head>
<body class="page-marketing page-guides">
  <a class="skip-link" href="#contenido">Saltar al contenido</a>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="/" aria-label="PuntosFieles, inicio"><img src="/icon.svg?v=4" alt="" width="36" height="36"/><span>PuntosFieles<span class="brand-period">.</span></span></a>
      <nav class="guides-nav" aria-label="Navegación principal"><a href="${escapeHtml(guidesPath)}"${hub ? ' aria-current="page"' : ""}>${preview ? "Vistas previas" : "Guías"}</a><a href="/#contacto">Solicitar demo ${arrow}</a></nav>
    </div>
  </header>
  <main id="contenido" tabindex="-1">${content}</main>
  <footer class="site-footer guides-footer">
    <div class="container footer-top"><a href="/" class="brand" aria-label="PuntosFieles, inicio"><img src="/icon.svg?v=4" alt="" width="32" height="32"/><span>PuntosFieles<span class="brand-period">.</span></span></a><p>Lealtad que sí se siente.</p><a class="back-top" href="#contenido">Volver arriba <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></a></div>
    <div class="container footer-bottom"><span>Creado por <a href="https://viasolvia.com" target="_blank" rel="noopener noreferrer">Viasolvia</a></span><nav aria-label="Información y ayuda"><a href="${escapeHtml(guidesPath)}"${hub ? ' aria-current="page"' : ""}>${preview ? "Vistas previas" : "Guías"}</a><a href="/soporte">Soporte</a><a href="/privacidad">Privacidad</a><a href="/terminos">Términos</a></nav></div>
  </footer>
</body>
</html>`;
}

/**
 * Escapes `value` and wraps every occurrence of a decoration label with its
 * rendering; the earliest (then longest) label wins at each position.
 * @param {string} value
 * @param {readonly TextDecoration[]} [decorations]
 */
function decoratedText(value, decorations = []) {
  const text = String(value);
  let cursor = 0;
  let output = "";
  while (cursor < text.length) {
    /** @type {(TextDecoration & { index: number }) | undefined} */
    let match;
    for (const decoration of decorations) {
      const index = text.indexOf(decoration.label, cursor);
      if (
        index >= 0 &&
        (!match ||
          index < match.index ||
          (index === match.index && decoration.label.length > match.label.length))
      )
        match = { ...decoration, index };
    }
    if (!match) return output + escapeHtml(text.slice(cursor));
    output += escapeHtml(text.slice(cursor, match.index)) + match.render(escapeHtml(match.label));
    cursor = match.index + match.label.length;
  }
  return output;
}

/**
 * @param {string} value
 * @param {readonly GuideReference[]} [references]
 */
function citationText(value, references = []) {
  return decoratedText(
    value,
    references.map((reference) => ({
      label: reference.citation,
      render: (label) => `<a class="citation" href="#ref-${escapeHtml(reference.id)}">${label}</a>`,
    })),
  );
}

/**
 * @param {GuideImage} image
 * @param {{ eager?: boolean, sizes?: string }} [options]
 */
function imageMarkup(
  image,
  { eager = false, sizes = "(max-width: 680px) calc(100vw - 40px), 580px" } = {},
) {
  /** @param {string} src @param {number} fallback */
  const widthFromPath = (src, fallback) =>
    Number(src.match(/-(\d+)\.(?:webp|png)$/)?.[1]) || fallback;
  const srcset = image.srcSmall
    ? ` srcset="${escapeHtml(image.srcSmall)} ${widthFromPath(image.srcSmall, 640)}w, ${escapeHtml(image.src)} ${widthFromPath(image.src, image.width)}w" sizes="${sizes}"`
    : "";
  return `<img src="${escapeHtml(image.src)}"${srcset} width="${image.width}" height="${image.height}" alt="${escapeHtml(image.alt)}" decoding="async"${eager ? ' fetchpriority="high"' : ' loading="lazy"'}/>`;
}

/**
 * @param {{ origin: string, articles: readonly GuideArticle[], previewPath?: string | null }} options
 */
export function renderGuidesHub({ origin, articles, previewPath = null }) {
  /** @param {string} slug */
  const articlePath = (slug) => `${previewPath || "/guias/"}${slug}`;
  articles = [...articles].sort((a, b) =>
    (b.datePublished || "").localeCompare(a.datePublished || ""),
  );
  const intro = previewPath
    ? '<div class="guides-intro"><h1>Artículos para<br/><span>revisar.</span></h1><p>Vista previa de cinco artículos. Las fechas indican su publicación prevista; el contenido y las ilustraciones se presentan para revisión.</p></div>'
    : `<div class="guides-intro"><h1>Guías para<br/><span>tu negocio.</span></h1><p>Investigación, ejemplos y preguntas útiles para diseñar recompensas y entender por qué tus clientes vuelven.</p></div>`;
  const empty = `<section class="guides-empty" aria-labelledby="guides-empty-title"><h2 id="guides-empty-title">Las primeras guías<br/> están en camino.</h2><p>Todavía no hay artículos publicados. Mientras tanto, conoce cómo funciona PuntosFieles o conversemos sobre tu negocio.</p><div class="guides-actions"><a class="button" href="/#como-funciona">Conocer PuntosFieles ${arrow}</a><a class="text-link" href="/#contacto">Conversar sobre mi negocio ${arrow}</a></div></section>`;
  const listing = `<section class="guides-library" aria-label="${previewPath ? "Artículos para revisar" : "Artículos publicados"}"><ul class="guides-list">${articles.map((article, index) => `<li><article class="guide-listing"><div class="guide-listing-copy"><h2><a href="${escapeHtml(articlePath(article.slug))}">${escapeHtml(article.title)}</a></h2><p>${escapeHtml(article.description)}</p><div class="guide-listing-meta">${article.datePublished ? `${previewPath ? "Publicación prevista: " : ""}<time datetime="${article.datePublished}">${formatDate(article.datePublished)}</time>` : ""}${article.readingMinutes ? `<span>${article.readingMinutes} min de lectura</span>` : ""}</div><a class="text-link" href="${escapeHtml(articlePath(article.slug))}">Leer el artículo ${arrow}<span class="sr-only">: ${escapeHtml(article.title)}</span></a></div>${article.hero ? `<a class="guide-listing-art" href="${escapeHtml(articlePath(article.slug))}" tabindex="-1" aria-hidden="true">${imageMarkup({ ...article.hero, alt: "" }, { eager: index === 0 })}</a>` : ""}</article></li>`).join("")}</ul></section>`;
  return shell({
    title: previewPath ? "Artículos para revisar" : "Guías de lealtad y recompensas para negocios",
    description:
      "Artículos de PuntosFieles sobre programas de fidelización, recompensas y decisiones para tu negocio. Con ejemplos propios, citas y referencias de investigación.",
    canonical: new URL(previewPath || "/guias/", origin).href,
    indexable: !previewPath && articles.length > 0,
    preview: Boolean(previewPath),
    guidesPath: previewPath || "/guias/",
    hub: true,
    hero: articles[0]?.hero,
    content: `<div class="container guides-hub">${intro}${articles.length ? listing : empty}</div>`,
  });
}

/**
 * @param {readonly GuideBlock[]} body
 * @param {readonly GuideReference[] | undefined} references
 */
function renderBlocks(body, references) {
  /** @param {string} value */
  const text = (value) => citationText(value, references);
  return body
    .map((block, index) => {
      if (block.type === "heading")
        return `<h2 id="seccion-${index + 1}">${escapeHtml(block.text)}</h2>`;
      if (block.type === "list") {
        const tag = block.ordered ? "ol" : "ul";
        return `<${tag}>${block.items.map((item) => `<li>${text(item)}</li>`).join("")}</${tag}>`;
      }
      if (block.type === "link")
        return `<p><a href="${escapeHtml(block.href)}">${escapeHtml(block.text)}</a></p>`;
      if (block.type === "figure")
        return `<figure class="guide-figure">${imageMarkup(block, { sizes: "(max-width: 680px) calc(100vw - 40px), 600px" })}${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}</figure>`;
      if (block.type === "callout")
        return `<aside class="guide-example"><p>${text(block.text)}</p>${block.note ? `<p class="guide-example-note">${text(block.note)}</p>` : ""}</aside>`;
      return `<p>${text(block.text)}</p>`;
    })
    .join("\n");
}

/** @param {readonly GuideReference[]} [references] */
function renderReferences(references = []) {
  if (!references.length) return "";
  return `<section class="guide-references" aria-labelledby="referencias"><h2 id="referencias">Referencias</h2><p>Para quien quiera seguir leyendo, estas son las fuentes.</p><ol>${references
    .map(
      (reference) =>
        `<li id="ref-${escapeHtml(reference.id)}">${decoratedText(
          reference.apa,
          (reference.italic || []).map((label) => ({
            label,
            render: (escaped) => `<em>${escaped}</em>`,
          })),
        )} <a href="${escapeHtml(reference.href)}">${escapeHtml(reference.href)}</a></li>`,
    )
    .join("")}</ol></section>`;
}

/**
 * @param {{
 *   origin: string,
 *   article: GuideArticle,
 *   preview?: { indexPath: string, articles: readonly GuideArticle[] } | null,
 * }} options
 */
export function renderGuideArticle({ origin, article, preview = null }) {
  const guidesPath = preview?.indexPath || "/guias/";
  const canonical = new URL(`${guidesPath}${article.slug}`, origin).href;
  /** @type {Record<string, unknown>} schema.org Article (JSON-LD) */
  const schema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    inLanguage: "es",
    mainEntityOfPage: canonical,
    url: canonical,
    publisher: { "@type": "Organization", name: "PuntosFieles", url: new URL("/", origin).href },
  };
  if (article.author)
    schema.author = {
      "@type": article.author.type,
      name: article.author.name,
      ...(article.author.url ? { url: article.author.url } : {}),
    };
  if (article.datePublished) schema.datePublished = article.publishAt || article.datePublished;
  if (article.dateModified) schema.dateModified = article.dateModified;
  if (article.hero) schema.image = new URL(article.hero.src, origin).href;
  if (article.category) schema.articleSection = article.category;
  if (article.references?.length)
    schema.citation = article.references.map((reference) => reference.href);
  const author = article.author
    ? `<span>Por ${article.author.url ? `<a href="${escapeHtml(article.author.url)}">${escapeHtml(article.author.name)}</a>` : escapeHtml(article.author.name)}</span>`
    : "";
  const published = article.datePublished
    ? `<span>${preview ? "Publicación prevista: " : "Publicado el "}<time datetime="${article.datePublished}">${formatDate(article.datePublished)}</time></span>`
    : "";
  const updated = article.dateModified
    ? `<span>Actualizado el <time datetime="${article.dateModified}">${formatDate(article.dateModified)}</time></span>`
    : "";
  const reading = article.readingMinutes
    ? `<span>${article.readingMinutes} min de lectura</span>`
    : "";
  const methods = article.methodNote?.length
    ? `<details class="guide-methods"><summary>Sobre la investigación y sus límites</summary><div>${article.methodNote.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}</div></details>`
    : "";
  const productNote = article.productNote
    ? `<aside class="guide-product-note" aria-labelledby="en-puntosfieles"><h2 id="en-puntosfieles">En PuntosFieles</h2><p>${citationText(article.productNote.text, article.references)}</p><a href="${escapeHtml(article.productNote.href)}">${escapeHtml(article.productNote.linkText)}</a></aside>`
    : "";
  const reviewLinks = preview
    ? `<nav aria-label="Otros artículos para revisar">${preview.articles
        .filter((item) => item.slug !== article.slug)
        .map(
          (item) =>
            `<p><a href="${escapeHtml(guidesPath + item.slug)}">${escapeHtml(item.title)}</a></p>`,
        )
        .join("")}</nav>`
    : "";
  const content = `<article class="container guide-article${article.hero ? " guide-illustrated" : ""}"><nav class="guides-breadcrumb" aria-label="Ruta de navegación"><a href="/">Inicio</a><span aria-hidden="true">/</span><a href="${escapeHtml(guidesPath)}">${preview ? "Vistas previas" : "Guías"}</a></nav><header class="guide-heading"><div><h1>${escapeHtml(article.title)}</h1><p class="guide-description">${escapeHtml(article.description)}</p>${author || published || updated || reading ? `<div class="guide-meta">${author}${published}${updated}${reading}</div>` : ""}${article.references?.length ? '<a class="guide-source-link" href="#referencias">Consultar las fuentes</a>' : ""}</div>${article.hero ? `<figure class="guide-hero">${imageMarkup(article.hero, { eager: true })}${article.hero.caption ? `<figcaption>${escapeHtml(article.hero.caption)}</figcaption>` : ""}</figure>` : ""}</header><div class="guide-body">${renderBlocks(article.body ?? [], article.references)}${productNote}${methods}${renderReferences(article.references)}${article.artCredit ? `<p class="guide-art-credit">${escapeHtml(article.artCredit)}</p>` : ""}</div><footer class="guide-end"><a class="text-link" href="${escapeHtml(guidesPath)}">${preview ? "Ver los cinco artículos" : "Ver todas las guías"} ${arrow}</a>${reviewLinks}</footer></article>`;
  return shell({
    title: article.title,
    description: article.description,
    canonical,
    content,
    indexable: !preview,
    preview: Boolean(preview),
    guidesPath,
    articleSchema: preview ? null : schema,
    hero: article.hero,
  });
}

/** @param {{ origin: string }} options */
export function renderGuideNotFound({ origin }) {
  return shell({
    title: "Guía no disponible",
    description:
      "Esta guía no está disponible. Consulta las guías publicadas de PuntosFieles o vuelve al inicio.",
    canonical: new URL("/guias/", origin).href,
    indexable: false,
    content: `<div class="container guides-unavailable"><h1>Esta guía no<br/><span>está disponible.</span></h1><p>Puede que el enlace haya cambiado. Puedes volver a la sección de guías para consultar las publicaciones disponibles.</p><a class="button" href="/guias/">Volver a las guías ${arrow}</a></div>`,
  });
}
