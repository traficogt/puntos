// Actual built merchant app; all activity stays in the in-memory demonstration.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { build } from 'vite';

const merchant = path.resolve(import.meta.dirname, '..');
const project = path.resolve(merchant, '../..');
const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-typed-boundaries-'));
await build({ root: merchant, configFile: path.join(merchant, 'vite.config.js'), build: { outDir, emptyOutDir: true }, logLevel: 'warn' });
const app = express();
app.get('/negocio/', (_req, res) => res.sendFile(path.join(outDir, 'index.html')));
app.get('/runtime-config.js', (_req, res) => res.type('js').send('window.__PF_RUNTIME_CONFIG__={};'));
app.use('/negocio', express.static(outDir));
app.use(express.static(path.join(project, 'public')));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1280,height:950},serviceWorkers:'block'});
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) {
      requests.push(url.href); return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${origin}/negocio/?demo=1#resumen`);
  await expect(page.getByRole('img', {name:'Ventas registradas por día; los mismos datos están disponibles en la tabla.',exact:true})).toBeVisible();
  await page.goto(`${origin}/negocio/?demo=1#region`);
  await expect(page.getByRole('heading',{name:'Región del negocio',exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'País',exact:true}).click();
  await page.getByRole('option',{name:'El Salvador',exact:true}).click();
  await page.getByRole('checkbox',{name:'Confirmo que GTQ es la moneda de las operaciones de mi negocio.',exact:true}).check();
  await page.getByRole('button',{name:'Guardar región',exact:true}).click();
  await expect(page.getByRole('button',{name:'Guardar región',exact:true})).toBeDisabled();
  await expect(page.getByRole('combobox',{name:'País',exact:true})).toHaveValue('El Salvador');
  await page.evaluate(()=>{location.hash='resumen';});
  await expect(page.getByRole('img',{name:'Ventas registradas por día; los mismos datos están disponibles en la tabla.',exact:true})).toBeVisible();
  await page.evaluate(()=>{location.hash='region';});
  await expect(page.getByRole('combobox',{name:'País',exact:true})).toHaveValue('El Salvador');
  assert.deepEqual(errors,[]);
  assert.deepEqual(requests,[]);
  console.log('PASS: accessible chart, typed region save and demo isolation in the actual merchant build.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(outDir,{recursive:true,force:true});
}
