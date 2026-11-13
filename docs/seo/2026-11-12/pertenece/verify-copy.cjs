const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../../..');
const mime = {'.css':'text/css','.js':'application/javascript','.woff2':'font/woff2','.svg':'image/svg+xml','.jpg':'image/jpeg'};
const server = http.createServer((req,res) => {
 const pathname = new URL(req.url,'http://localhost').pathname;
 const file = pathname === '/' ? path.join(root,'public/credenciales/index.html') : path.join(root,'public',pathname);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',mime[path.extname(file)]||'text/html');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome'});
 const results=[];
 try {
  for(const width of [1440,390,320]) {
   const page=await browser.newPage({viewport:{width,height:950},deviceScaleFactor:1});
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
   await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'networkidle'});
   await page.evaluate(()=>document.fonts.ready);
   const result=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,h1:document.querySelectorAll('h1').length,canonical:document.querySelector('link[rel=canonical]').href,robots:document.querySelector('meta[name=robots]').content,visibleRegionalClaims:/Guatemala|español|quetzales/i.test(document.body.innerText),simulation:document.querySelector('.demo-disclaimer').textContent,headingFont:getComputedStyle(document.querySelector('h1')).fontFamily,bodyFont:getComputedStyle(document.body).fontFamily,legalLinks:[...document.querySelectorAll('footer nav a')].map(a=>a.href)}));
   assert.equal(result.scrollWidth,width);assert.equal(result.h1,1);assert.equal(result.visibleRegionalClaims,false);assert.equal(result.canonical,'https://pertenecegt.com/');assert.match(result.simulation,/No escanea ni valida credenciales reales/);assert.ok(result.legalLinks.every(url=>url.startsWith('https://puntosfieles.com/')));
   await page.screenshot({path:path.join(__dirname,`copy-${width}.jpg`),type:'jpeg',quality:80,fullPage:width===390});
   await page.locator('#como-funciona').screenshot({path:path.join(__dirname,`wallet-section-${width}.jpg`),type:'jpeg',quality:85});
   result.skipLink = await page.locator('.skip-link').evaluate(el => ({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,focused:document.activeElement===el}));
   assert.ok(result.skipLink.bottom<0);
   await page.screenshot({path:path.join(__dirname,`wallet-viewport-${width}.jpg`),type:'jpeg',quality:85});
   results.push(result);await page.close();
  }
  fs.writeFileSync(path.join(__dirname,'browser-copy-check.json'),JSON.stringify({scope:'Local copy, metadata and layout; external requests blocked; not a contact form end-to-end test',results},null,2));
  console.log(JSON.stringify(results));
 } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
