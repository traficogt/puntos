import { readFileSync } from 'node:fs';
import { z } from 'zod';

const text = z.string().trim().min(1);
const slug = text.max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Usa minúsculas, números y guiones; escribe los acentos sin tilde.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'La fecha debe existir en el calendario.');
const httpsUrl = text.url().refine(value => new URL(value).protocol === 'https:', 'Usa una URL HTTPS.');
const link = text.refine(value => {
  if (/[\s\\\u0000-\u001f]/u.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}, 'Usa un enlace local que empiece por / o una URL HTTPS.');
const block = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text }).strict(),
  z.object({ type: z.literal('paragraph'), text }).strict(),
  z.object({ type: z.literal('list'), items: z.array(text).min(1), ordered: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('link'), text, href: link }).strict()
]);
const shared = {
  slug,
  title: text.max(180),
  author: z.object({ type: z.enum(['Person', 'Organization']), name: text.max(160), url: httpsUrl.optional() }).strict().optional(),
  datePublished: date.optional(),
  dateModified: date.optional()
};
const entry = z.discriminatedUnion('status', [
  z.object({ ...shared, status: z.literal('draft'), description: text.max(320).optional(), body: z.array(block).optional() }).strict(),
  z.object({ ...shared, status: z.literal('published'), description: text.max(320), body: z.array(block).min(1) }).strict()
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
  });
});

export function parseGuideCatalog(value) {
  return guideCatalogSchema.parse(value);
}

// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository manifest; no request input enters this path.
export const guideCatalog = parseGuideCatalog(JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')));

export function getPublishedGuides(guides = guideCatalog) {
  return guides.articles.filter(article => article.status === 'published');
}

export function getGuideSearchPaths(guides = guideCatalog) {
  const published = getPublishedGuides(guides);
  return published.length ? ['/guias/', ...published.map(article => `/guias/${article.slug}`)] : [];
}
