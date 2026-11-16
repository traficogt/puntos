import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { guideCatalog } from '../../src/content/guides/catalog.js';
import { renderGuideArticle } from '../../src/content/guides/render.js';

// This editorial pass changes PF examples/illustrations, not source findings or
// release dates. Digests pin the previously reviewed source passages and APA data.
const baseline = [
  ['funcionan-los-programas-de-fidelizacion', 'published', '2026-11-14', undefined, '05cff860a750b5b2f3b9dd0e25542c07d590a8d8f7129e87d99618ba27bef36f', '1d5880939ffe90da50df0775fb31ff540b4e8b18cdc597688f4e83c9af818c86'],
  ['como-disenar-programa-fidelizacion', 'scheduled', '2026-11-21', '2026-11-21T17:11:00-06:00', '00df20dd70b91fc5d797810794e3d9d4601ebbebf603be6d92d137b5b34c9842', 'fd138e039826376f98428ea80890c755a5351bdc6d96277bf39e64b842606815'],
  ['cuanto-cuesta-una-recompensa', 'scheduled', '2026-11-28', '2026-11-28T10:48:00-06:00', '4f5bce432f41b83600fc0dddd5be9f05c05be40e3369343e7d6845348a713695', '780bda8b1d709ed510bbbf4009d8f468eba99df8b8a02d21b9aa5c04f85fa159'],
  ['cuantas-visitas-para-una-recompensa', 'scheduled', '2026-12-05', '2026-12-05T14:03:00-06:00', '2fc99821d6d60e2c004d528efa78f9bdae8b4057578955d112c5b0f341884774', 'b189fa606ab2251e2aa442777dcd61ccba9665ebed413b6a675182a8e1fded40'],
  ['ventaja-empezar-con-sellos', 'scheduled', '2026-12-12', '2026-12-12T11:50:00-06:00', '5e0d990296940cb3bd0b80631685c668f9f3fe566ddeb5270f1e2585d3433647', '821bc3a2976eced28305704a77a2758b057c6d700c356477ad8946fcd17bc607'],
  ['como-mostrar-progreso-recompensas', 'scheduled', '2026-12-19', '2026-12-19T12:39:00-06:00', 'b982b80aaf706075c23b69100ecaa9ca3e80c2c92b24f62fe079272db3421456', 'd487d2a8cd447e028b0164ce57ff382569d12529a058b47c78ad00e06b3fd7af'],
];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const find = slug => guideCatalog.articles.find(article => article.slug === slug);

test('all six guides retain their reviewed sources, study passages and publication schedule', () => {
  assert.equal(guideCatalog.articles.length, baseline.length);
  for (const [slug, status, datePublished, publishAt, references, science] of baseline) {
    const article = find(slug);
    assert.equal(article.status, status, slug);
    assert.equal(article.datePublished, datePublished, slug);
    assert.equal(article.publishAt, publishAt, slug);
    assert.equal(hash(article.references), references, `${slug}: reference metadata`);
    const passages = article.body.filter(block => block.type === 'paragraph' && article.references.some(reference => block.text.includes(reference.citation)))
      // Only this paragraph's own-example bridge changes 30 to 34 purchases;
      // every sentence about the actual study must retain the reviewed text.
      .map(block => block.type === 'paragraph' ? { ...block, text: block.text.replace('Treinta y cuatro compras registradas', 'Treinta compras registradas') } : block);
    assert.equal(hash(passages), science, `${slug}: original study settings/findings`);
  }
});

test('every article has an additional responsive body illustration distinct from its hero', () => {
  for (const article of guideCatalog.articles) {
    assert.ok(article.hero, article.slug);
    const images = article.body.filter(block => block.type === 'figure');
    assert.ok(images.length >= 1, article.slug);
    for (const image of images) {
      assert.notEqual(image.src, article.hero.src);
      assert.ok(image.srcSmall && image.alt && image.caption, article.slug);
      const html = renderGuideArticle({ origin: 'https://puntosfieles.com', article });
      assert.ok(html.includes(image.src));
      assert.ok(html.includes(image.srcSmall));
    }
  }
});

test('articles that discuss cost or reward funding link the working public calculator', () => {
  for (const [slug] of baseline.slice(0, 5)) {
    assert.ok(find(slug).body.some(block => block.type === 'link' && block.href === '/calculadora'), slug);
  }
});

test('PF examples cover distinct trades while real carwash and cafeteria studies remain identifiable', () => {
  const trades = ['lavandería', 'panadería', 'librería', 'barbería', 'taller de bicicletas', 'tienda de plantas'];
  for (const [index, [slug]] of baseline.entries()) {
    const trade = trades[index];
    assert.ok(JSON.stringify(find(slug).body).includes(trade), `${slug}: ${trade}`);
  }
  const welcome = JSON.stringify(find('ventaja-empezar-con-sellos').body);
  assert.match(welcome, /lavadero de autos.*300 tarjetas/);
  assert.match(welcome, /108 clientes de una cafetería universitaria/);
  const costs = JSON.stringify(find('cuanto-cuesta-una-recompensa').body);
  assert.match(costs, /34 compras adicionales/);
  assert.match(costs, /Q28 − Q3/);
});

test('published body deliveries preserve the approved, visually inspected gallery originals', () => {
  const selections = { 'disenar-ensayo': '10-ensamble', 'costos-libreria': '08-libreria', 'visitas-comercios': '01-plaza', 'avance-bienvenida': '06-confianza', 'progreso-puente': '07-puente' };
  for (const [delivery, original] of Object.entries(selections)) {
    for (const size of [768, 1536]) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed test-owned mapping; no request input.
      const served = readFileSync(new URL(`../../public/images/articles/${delivery}-${size}.webp`, import.meta.url));
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed test-owned mapping; no request input.
      const gallery = readFileSync(new URL(`../../src/content/illustration-review/${original}-${size}.webp`, import.meta.url));
      assert.deepEqual(served, gallery, `${delivery}-${size}`);
    }
  }
});
