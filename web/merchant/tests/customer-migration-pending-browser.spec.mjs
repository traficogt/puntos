// Isolated browser fixture; the only import data is synthetic and stays in memory.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const entry = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {MantineProvider,Container} from '@mantine/core';
import '@mantine/core/styles.css';
import CustomerMigration from '/src/CustomerMigration.jsx';
import {demoMigration} from '/src/demo-migration.js';
window.__submissions=[];
window.__api=async(path,options={})=>{
 if(path==='/api/admin/customer-import-jobs')return {jobs:[]};
 const body=JSON.parse(options.body??'{}');
 if(options.method==='POST'&&body.columns){
  window.__pending=path;
  await new Promise(resolve=>{window.__release=resolve;});
  window.__pending=null;
  window.__submissions.push({path,body});
 }
 return demoMigration(new URL(path,location.origin),options);
};
createRoot(document.getElementById('root')).render(React.createElement(MantineProvider,null,React.createElement(Container,{py:'xl'},React.createElement(CustomerMigration))));`;
const vite = await createServer({ configFile: false, root, logLevel: 'error', plugins: [react(), {
  name: 'migration-pending-fixture',
  resolveId(id) { if (id === '/__entry.jsx') return '\0migration-entry'; if (id === '/lib.js') return '\0migration-api'; },
  load(id) { if (id === '\0migration-entry') return entry; if (id === '\0migration-api') return 'export const api=(path,options)=>window.__api(path,options);'; },
  configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith('/negocio/')) return next();
    res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml(req.url, '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Importación de prueba</title></head><body><main id="root"></main><script type="module" src="/__entry.jsx"></script></body></html>'));
  }); },
}], server: { host: '127.0.0.1', port: 0 } });
await vite.listen();
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/negocio/`);
  await page.getByRole('combobox', { name: 'Origen de los saldos', exact: true }).click();
  await page.getByRole('option', { name: 'Sellos de tarjetas de papel', exact: true }).click();
  const source = page.getByLabel('Registro de origen', { exact: false });
  const evidence = page.getByLabel('Evidencia revisada por el dueño', { exact: false });
  const conversion = page.getByLabel('Puntos por sello o unidad de progreso', { exact: false });
  const approved = page.getByRole('checkbox', { name: /Como dueño apruebo convertir/ });
  await source.fill('Tarjeta sintética 1');
  await evidence.fill('Tres sellos comprobados en el registro de prueba.');
  await approved.check();
  await page.locator('input[type=file]').setInputFiles({ name: 'sellos.csv', mimeType: 'text/csv', buffer: Buffer.from('Teléfono,Nombre,Saldo\n55550991,Cliente de prueba,3') });
  await page.getByRole('heading', { name: 'Relaciona las columnas' }).waitFor();
  async function assertLocked() {
    for (const field of [source, evidence, conversion, approved]) assert.equal(await field.isDisabled(), true, 'Source terms must stay fixed while their review or commit is pending');
  }
  await page.getByRole('button', { name: 'Revisar lote', exact: true }).click();
  await page.waitForFunction(() => window.__pending?.endsWith('/preview'));
  await assertLocked();
  await page.evaluate(() => window.__release());
  await expect(page.getByRole('checkbox', { name: /confirmo importar.*30 puntos iniciales/ })).toBeVisible();
  await conversion.fill('20');
  await expect(page.getByRole('heading', { name: 'Revisa antes de importar' })).toHaveCount(0);
  await approved.check();
  await page.getByRole('button', { name: 'Revisar lote', exact: true }).click();
  await page.waitForFunction(() => window.__pending?.endsWith('/preview'));
  await assertLocked();
  await page.evaluate(() => window.__release());
  await page.getByRole('checkbox', { name: /confirmo importar.*60 puntos iniciales/ }).check();
  await page.getByRole('button', { name: 'Confirmar importación', exact: true }).click();
  await page.waitForFunction(() => window.__pending?.endsWith('/commit'));
  await assertLocked();
  await page.evaluate(() => window.__release());
  await expect(page.getByText('1 clientes creados con 60 puntos iniciales. 0 clientes existentes omitidos.')).toBeVisible();
  const bodies = await page.evaluate(() => window.__submissions.map(request => request.body));
  assert.deepEqual(bodies.map(body => body.source.conversion.points_per_unit), [10, 20, 20]);
  assert.deepEqual(errors, []);
  console.log('Migration pending responses: conversion/evidence locked, edits invalidate preview, and committed points match the reviewed conversion.');
} finally { await browser.close(); await vite.close(); }
