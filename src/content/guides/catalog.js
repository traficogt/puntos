import { readFileSync } from 'node:fs';
import { z } from 'zod';

const text = z.string().trim().min(1);
const slug = text.max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Usa minúsculas, números y guiones; escribe los acentos sin tilde.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'La fecha debe existir en el calendario.');
const publicationTime = text.refine(value => {
  const parts = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);
  if (!parts || !date.safeParse(parts[1]).success) return false;
  return Number(parts[2]) < 24 && Number(parts[3]) < 60 && Number(parts[4]) < 60 &&
    (parts[5] === 'Z' || (Number(parts[6]) <= 14 && Number(parts[7]) < 60 && (Number(parts[6]) < 14 || Number(parts[7]) === 0))) &&
    Number.isFinite(Date.parse(value));
}, 'Usa un instante ISO 8601 válido con segundos y zona horaria explícita (Z o ±HH:MM).');
const guatemalaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit' });
const httpsUrl = text.url().refine(value => new URL(value).protocol === 'https:', 'Usa una URL HTTPS.');
const imagePath = text.regex(/^\/images\/articles\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:webp|png)$/i, 'Usa una imagen WebP o PNG local en /images/articles/.');
const image = {
  src: imagePath, srcSmall: imagePath.optional(), alt: text,
  width: z.number().int().positive(), height: z.number().int().positive()
};
const reference = z.object({ id: slug, citation: text, apa: text, href: httpsUrl, italic: z.array(text).optional() }).strict();
const link = text.refine(value => {
  if (/[\s\\\u0000-\u001f]/u.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}, 'Usa un enlace local que empiece por / o una URL HTTPS.');
const block = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text }).strict(),
  z.object({ type: z.literal('paragraph'), text }).strict(),
  z.object({ type: z.literal('list'), items: z.array(text).min(1), ordered: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('link'), text, href: link }).strict(),
  z.object({ type: z.literal('figure'), ...image, caption: text.optional() }).strict(),
  z.object({ type: z.literal('callout'), text, note: text.optional() }).strict()
]);
const shared = {
  slug,
  title: text.max(180),
  author: z.object({ type: z.enum(['Person', 'Organization']), name: text.max(160), url: httpsUrl.optional() }).strict().optional(),
  datePublished: date.optional(),
  dateModified: date.optional(),
  publishAt: publicationTime.optional(),
  category: text.optional(),
  hero: z.object({ ...image, caption: text.optional() }).strict().optional(),
  references: z.array(reference).optional(),
  methodNote: z.array(text).optional(),
  readingMinutes: z.number().int().positive().optional(),
  artCredit: text.optional()
};
const publication = { description: text.max(320), body: z.array(block).min(1) };
const entry = z.discriminatedUnion('status', [
  z.object({ ...shared, status: z.literal('draft'), description: text.max(320).optional(), body: z.array(block).optional() }).strict(),
  z.object({ ...shared, ...publication, status: z.literal('published') }).strict(),
  z.object({ ...shared, ...publication, status: z.literal('scheduled'), publishAt: publicationTime, datePublished: date }).strict()
]);

/** Content is repository-owned and never selected by a request-provided filename. */
export const guideCatalogSchema = z.object({ version: z.literal(1), articles: z.array(entry) }).strict().superRefine((catalog, ctx) => {
  const slugs = new Set();
  catalog.articles.forEach((article, index) => {
    if (slugs.has(article.slug)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['articles', index, 'slug'], message: 'El slug ya existe.' });
    slugs.add(article.slug);
    if (article.datePublished && article.dateModified && article.dateModified < article.datePublished) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['articles', index, 'dateModified'], message: 'La actualización no puede ser anterior a la publicación.' });
    }
    if (article.publishAt && publicationTime.safeParse(article.publishAt).success &&
      article.datePublished !== guatemalaDate.format(new Date(article.publishAt))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['articles', index, 'datePublished'], message: 'La fecha de publicación debe coincidir con publishAt en America/Guatemala.' });
    }
    const referenceIds = new Set();
    article.references?.forEach((item, referenceIndex) => {
      if (referenceIds.has(item.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['articles', index, 'references', referenceIndex, 'id'], message: 'El identificador de referencia ya existe en este artículo.' });
      referenceIds.add(item.id);
    });
  });
});

export function parseGuideCatalog(value) {
  return guideCatalogSchema.parse(value);
}

// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository manifest; no request input enters this path.
export const guideCatalog = parseGuideCatalog(JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')));

/**
 * Evaluate eligibility on every call; scheduled entries never need a status mutation.
 * @param {typeof guideCatalog} [guides]
 * @param {() => number | Date} [now]
 */
export function getPublishedGuides(guides = guideCatalog, now = Date.now) {
  const instant = new Date(now());
  const timestamp = instant.getTime();
  if (!Number.isFinite(timestamp)) throw new TypeError('El reloj de publicación debe devolver una fecha válida.');
  const today = guatemalaDate.format(instant);
  return guides.articles.filter(article => (article.status === 'published' || article.status === 'scheduled') &&
    (!article.publishAt || Date.parse(article.publishAt) <= timestamp) &&
    (!article.datePublished || article.datePublished <= today));
}

/** @param {typeof guideCatalog} [guides] @param {() => number | Date} [now] */
export function getGuideSearchPaths(guides = guideCatalog, now = Date.now) {
  const published = getPublishedGuides(guides, now);
  return published.length ? ['/guias/', ...published.map(article => `/guias/${article.slug}`)] : [];
}
