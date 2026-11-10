import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import helmet from 'helmet';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createMobilePreview} from '../../src/middleware/mobile-preview.js';
test('preview supports route refresh and scopes its style policy to preview only',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'pf-preview-'));await mkdir(path.join(dir,'app-preview'));await writeFile(path.join(dir,'app-preview/index.html'),'<main>App preview</main>');
 const app=express();app.use(helmet());app.use('/app-preview',createMobilePreview(dir));app.get('/c',(_req,res)=>res.send('Existing customer UI'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true});});const origin=`http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */(server.address()).port}`;
 const preview=await fetch(origin+'/app-preview/account');assert.equal(preview.status,200);assert.match(await preview.text(),/App preview/);assert.equal(preview.headers.get('x-robots-tag'),'noindex, nofollow');assert.match(preview.headers.get('content-security-policy'),/style-src 'self' 'unsafe-inline'/);assert.match(preview.headers.get('content-security-policy'),/script-src 'self';/);
 assert.equal((await fetch(origin+'/app-preview/missing.js')).status,404);const existing=await fetch(origin+'/c');assert.equal(existing.headers.get('x-robots-tag'),null);assert.notEqual(existing.headers.get('content-security-policy'),preview.headers.get('content-security-policy'));
});
