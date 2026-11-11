/* eslint-disable security/detect-non-literal-fs-filename -- Fixed repository page fixtures are selected by this test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import {request as httpRequest} from 'node:http';
import { createSearchVisibility } from '../../src/middleware/search-visibility.js';
const origin='https://puntosfieles.com';
async function fixture(t) {
 const app=express();app.use(createSearchVisibility({marketingOrigin:origin,appOrigin:'https://app.puntosfieles.com'}));app.use((_req,res)=>res.type('html').send('<h1>Fixture</h1>'));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test address');
 return (path,host='puntosfieles.com')=>new Promise((resolve,reject)=>{const request=httpRequest({hostname:'127.0.0.1',port:address.port,path,headers:{Host:host}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:Object.fromEntries(Object.entries(response.headers).filter(([,value])=>value!==undefined).map(([key,value])=>[key,Array.isArray(value)?value.join(", "):String(value)]))})));});request.on('error',reject);request.end();});
}
test('sitemap has only canonical public pages and never trusts request host',async t=>{
 const request=await fixture(t),response=await request('/sitemap.xml');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/xml/);
 const xml=await response.text();assert.deepEqual([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(x=>x[1]),[origin+'/',origin+'/soporte',origin+'/privacidad',origin+'/terminos',origin+'/precios']);assert.doesNotMatch(xml,/lastmod|priority|changefreq/);
 for(const host of ['app.puntosfieles.com','unknown.example'])assert.equal((await request('/sitemap.xml',host)).status,404);
});
test('applications carry noindex while public pages stay indexable',async t=>{
 const request=await fixture(t);
 for(const [path,host] of [['/c','puntosfieles.com'],['/staff/login','puntosfieles.com'],['/admin.html','puntosfieles.com'],['/staff-login','puntosfieles.com'],['/join','puntosfieles.com'],['/ingresar','puntosfieles.com'],['/customer','puntosfieles.com'],['/admin-dashboard/fragments/branding.html','puntosfieles.com'],['/api/mobile/customer','puntosfieles.com'],['/app-preview/','puntosfieles.com'],['/soporte','app.puntosfieles.com'],['/','unknown.example']])assert.match((await request(path,host)).headers.get('x-robots-tag'),/noindex/);
 for(const path of ['/','/soporte','/privacidad','/terminos','/precios'])assert.equal((await request(path)).headers.get('x-robots-tag'),null);
 const robots=await(await request('/robots.txt')).text();assert.match(robots,/Sitemap: https:\/\/puntosfieles.com\/sitemap.xml/);assert.doesNotMatch(robots,/Disallow: \/(?:$|\n)/);
 const appRobots=await(await request('/robots.txt','app.puntosfieles.com')).text();assert.doesNotMatch(appRobots,/Sitemap:|Disallow: \//);
});
test('public aliases redirect permanently preserving query and app legal URLs',async t=>{
 const request=await fixture(t);
 for(const [from,to] of [['/index.html','/'],['/soporte.html','/soporte'],['/privacidad.html','/privacidad'],['/terminos.html','/terminos']]){const r=await request(from+'?utm_source=test');assert.equal(r.status,301);assert.equal(r.headers.get('location'),origin+to+'?utm_source=test');}
 assert.equal((await request('/privacidad.html','app.puntosfieles.com')).status,200);
});
test('metadata is complete and structured data matches real support contact',async()=>{
 for(const [file,path] of [['index','/'],['soporte','/soporte'],['privacidad','/privacidad'],['terminos','/terminos']]){
 const html=await readFile(new URL(`../../public/${file}.html`,import.meta.url),'utf8');assert.ok(html.includes(`<link rel="canonical" href="${origin+path}"`),file+' canonical');assert.match(html,/<meta name="description" content="[^"]{50,}"/);assert.ok(html.includes(`property="og:url" content="${origin+path}"`));assert.match(html,/name="twitter:card"/);assert.equal((html.match(/<h1\b/g)||[]).length,1);
 }
 const html=await readFile(new URL('../../public/index.html',import.meta.url),'utf8');const schemas=[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(x=>JSON.parse(x[1]));assert.equal(schemas.length,1);const entities=schemas[0]['@graph'];const org=entities.find(x=>x['@type']==='Organization');assert.equal(org.contactPoint.email,'soporte@puntosfieles.com');assert.equal(org.url,origin+'/');assert.ok(entities.some(x=>x['@type']==='WebSite'));assert.doesNotMatch(JSON.stringify(schemas),/aggregateRating|reviewCount|streetAddress/);
});
