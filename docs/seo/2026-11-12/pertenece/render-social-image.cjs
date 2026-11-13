const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../../..');
const mime = { '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? path.join(__dirname, 'social-image.html') : path.join(root, 'public', pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'text/html');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome'});
  try {
    const page = await browser.newPage({ viewport: {width:1200,height:630},deviceScaleFactor:1 });
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'networkidle'});
    await page.evaluate(() => document.fonts.ready);
    const target = path.join(root,'public/credenciales/og-pertenece.jpg');
    await page.screenshot({path:target,type:'jpeg',quality:90});
    console.log(JSON.stringify({file:target,bytes:fs.statSync(target).size,fonts:await page.evaluate(()=>({heading:getComputedStyle(document.querySelector('h1')).fontFamily,body:getComputedStyle(document.body).fontFamily}))}));
  } finally { await browser.close(); server.close(); }
})().catch(error => {console.error(error);server.close();process.exitCode=1;});
