import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import jsQR from "jsqr";
import QRCode from "qrcode";

test("actual branded artifacts decode to the unchanged enrollment URL", async () => {
  // Fixed repository service path, independent of request input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  assert.ok(existsSync(new URL("../../../src/app/services/branded-qr-service.js", import.meta.url)), "branded QR renderer exists");
  const { renderBrandedQr, brandedQrConfiguration } = await import("../../../src/app/services/branded-qr-service.js");
  for (const slug of ["cafe-jacaranda", "café uno/x", "n".repeat(120)]) {
    const business = { id: "own", name: "Café & <Uno> \"Guatemala\"", slug, customer_branding_json: { primary_color: "#204030", accent_color: "#F0DDA5" } };
    const url = `https://app.puntosfieles.com/registro/${encodeURIComponent(slug)}`;
    const config = brandedQrConfiguration(business, "https://app.puntosfieles.com");
    assert.equal(config.registration_url, url);
    const plain = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 4, width: 480 });
    for (const svg of [plain, renderBrandedQr(business, "https://app.puntosfieles.com"), renderBrandedQr(business, "https://app.puntosfieles.com", { foreground: "#333333" })]) {
      const image = new Resvg(svg, { fitTo: { mode: "width", value: 960 } }).render();
      const decoded = jsQR(new Uint8ClampedArray(image.pixels), image.width, image.height);
      assert.equal(decoded?.data, url, `decoder reads ${slug}`);
    }
  }
});

test("QR uses a four-module white quiet zone, safe text, bounded palette and high correction", async () => {
  const { renderBrandedQr, brandedQrConfiguration } = await import("../../../src/app/services/branded-qr-service.js");
  const business = { id: "own", name: '<script onload="alert(1)"> & Café', slug: "cafe", customer_branding_json: { primary_color: "#ffffff", accent_color: "url(https://evil.test)", customer_logo_url: "https://external.test/logo.svg" } };
  const config = brandedQrConfiguration(business, "https://app.puntosfieles.com");
  assert.equal(config.defaults.foreground, "#302820");
  assert.equal(config.branding.logo_included, false);
  const svg = renderBrandedQr(business, "https://app.puntosfieles.com");
  const size = QRCode.create(config.registration_url, { errorCorrectionLevel: "H" }).modules.size;
  assert.match(svg, new RegExp(`viewBox="0 0 ${size + 8} ${size + 8}"`));
  assert.match(svg, /&lt;script/);
  assert.equal(/<script|<foreignObject|(?:href|src)="https?:|url\(|<use/i.test(svg), false);
  for (const foreground of ["#ffffff", "#aaaaaa", "red", "#123", '#000000" onload="alert(1)', "#00000000"]) {
    assert.throws(() => renderBrandedQr(business, "https://app.puntosfieles.com", { foreground }), /color|contraste/i);
  }
});

test("only bounded embedded raster logos can be included; external and SVG logos remain outside the artifact", async () => {
  const { brandedQrConfiguration, renderBrandedQr } = await import("../../../src/app/services/branded-qr-service.js");
  const logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/l8AAAAASUVORK5CYII=";
  const business = { id: "own", name: "Café Uno", slug: "cafe", customer_branding_json: { customer_logo_url: logo } };
  assert.equal(brandedQrConfiguration(business, "https://app.puntosfieles.com").branding.logo_included, true);
  const logoSvg = renderBrandedQr(business, "https://app.puntosfieles.com");
  assert.match(logoSvg, /<image[^>]+data:image\/png;base64,/);
  const withLogo = new Resvg(logoSvg).render();
  assert.equal(jsQR(new Uint8ClampedArray(withLogo.pixels), withLogo.width, withLogo.height)?.data, "https://app.puntosfieles.com/registro/cafe");
  for (const invalid of ["data:image/svg+xml;base64,PHN2Zy8+", "https://example.com/logo.png", "/uploads/logo.png", "data:image/png;base64,PHN2Zy8+", `data:image/png;base64,${"A".repeat(500000)}`]) {
    business.customer_branding_json.customer_logo_url = invalid;
    assert.equal(brandedQrConfiguration(business, "https://app.puntosfieles.com").branding.logo_included, false);
    assert.equal(renderBrandedQr(business, "https://app.puntosfieles.com").includes("<image"), false);
  }
});

const fixtureJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAQABgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCbQElaAAf/2Q==';
const fixturePng = (transparent = false) => `data:image/png;base64,${new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">${transparent ? '' : '<rect width="120" height="80" fill="#E8B25B"/>'}<path fill="#302820" d="M10 10H50V25H25V35H45V50H25V70H10Z M65 10H105V25H80V35H100V50H80V70H65Z"/></svg>`).render().asPng().toString('base64')}`;
const nestedCode = svg => svg.match(/<svg x="50"[\s\S]*?<\/svg>/)?.[0] ?? '';

test('portable logos default inside the QR, with header and no-logo placements as explicit alternatives', async () => {
  const { brandedQrConfiguration, renderBrandedQr } = await import('../../../src/app/services/branded-qr-service.js');
  const logo = fixturePng(true);
  const business = {id:'own',name:'Café Uno',slug:'cafe',customer_branding_json:{customer_logo_url:logo}};
  const config = brandedQrConfiguration(business,'https://app.puntosfieles.com');
  assert.equal(config.defaults.logo_position,'center');
  assert.deepEqual(config.capabilities.logo_positions,['center','header','none']);
  assert.match(config.branding.logo_note,/centro.*QR/);
  assert.equal(JSON.stringify(config).includes(logo),false,'configuration returns logo metadata only');
  const centered = renderBrandedQr(business,'https://app.puntosfieles.com');
  assert.match(nestedCode(centered),/<image[^>]+data:image\/png;base64,/);
  assert.equal((centered.match(/<image/g) ?? []).length,1);
  const backing=nestedCode(centered).match(/<g data-logo-position="center">\s*<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*fill="#FFFFFF"/);
  assert.ok(backing,'center logo has a white backing inside the QR');
  const modules=QRCode.create(config.registration_url,{errorCorrectionLevel:'H'}).modules.size;
  assert.ok(Number(backing[3])<=modules*0.18+0.001,'backing including padding covers at most 18% of the code width');
  assert.equal(Number(backing[3]),Number(backing[4]));
  assert.ok(Math.abs(Number(backing[1])+Number(backing[3])/2-(modules+8)/2)<0.001);
  const header = renderBrandedQr(business,'https://app.puntosfieles.com',{logo_position:'header'});
  assert.match(header,/<image/);assert.doesNotMatch(nestedCode(header),/<image/);
  assert.doesNotMatch(renderBrandedQr(business,'https://app.puntosfieles.com',{logo_position:'none'}),/<image/);
  assert.doesNotMatch(renderBrandedQr(business,'https://app.puntosfieles.com',{logo_data_url:null}),/<image/);
});

test('actual center/header/none exports decode across URL density and opaque, transparent and JPEG logos', async () => {
  const { renderBrandedQr } = await import('../../../src/app/services/branded-qr-service.js');
  for (const [density,slug] of ['cafe','café uno/x','n'.repeat(120)].entries()) {
    const business = {id:'own',name:'Café Uno',slug,customer_branding_json:{customer_logo_url:'https://private.example/logo.png'}};
    const url = `https://app.puntosfieles.com/registro/${encodeURIComponent(slug)}`;
    for (const [logoIndex,[kind,logo_data_url]] of [['opaque',fixturePng()],['transparent',fixturePng(true)],['jpeg',fixtureJpeg]].entries()) {
      // Exercise every logo/density at two sizes for the occluded center.
      // Header/none use one representative per logo/density instead of duplicating the full matrix.
      for (const logo_position of logoIndex===density?['center','header','none']:['center']) {
        const svg = renderBrandedQr(business,'https://app.puntosfieles.com',{logo_position,logo_data_url});
        assert.equal(svg.includes('private.example'),false);
        assert.equal(svg.includes('<image'),logo_position!=='none');
        for (const width of logo_position==='center'?[480,960]:[480]) {
          const image = new Resvg(svg,{fitTo:{mode:'width',value:width}}).render();
          const pixels=image.pixels;
          assert.equal(jsQR(new Uint8ClampedArray(pixels),image.width,image.height)?.data,url,`${kind}, ${logo_position}, ${slug.length} characters, width ${width}`);
          if (kind==='opaque' && width===480) {
            let logoPixels=0;
            for (let y=178;y<558;y++) for (let x=50;x<430;x++) {
              const offset=(y*image.width+x)*4;
              if (pixels[offset]===232 && pixels[offset+1]===178 && pixels[offset+2]===91) logoPixels++;
            }
            assert.equal(logoPixels>0,logo_position==='center','the colored logo is visibly rendered inside the code only for center placement');
          }
        }
      }
    }
  }
});

test('explicit raster uploads reject malformed, oversized, remote and executable values without changing stored branding', async () => {
  const { renderBrandedQr } = await import('../../../src/app/services/branded-qr-service.js');
  const business = {id:'own',name:'Café Uno',slug:'cafe',customer_branding_json:{customer_logo_url:fixturePng()}};
  const original = JSON.stringify(business);
  const largePng = Buffer.from(fixturePng().split(',')[1],'base64');largePng.writeUInt32BE(2049,16);
  const largeJpeg = Buffer.from(fixtureJpeg.split(',')[1],'base64');largeJpeg.writeUInt16BE(2049,largeJpeg.indexOf(Buffer.from([255,192]))+5);
  for (const logo_data_url of ['https://outside.test/logo.png','/logo.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,PHN2Zy8+','data:image/jpeg;base64,/9j/2Q==',`data:image/png;base64,${'A'.repeat(180000)}`,`data:image/png;base64,${largePng.toString('base64')}`,`data:image/jpeg;base64,${largeJpeg.toString('base64')}`]) {
    assert.throws(()=>renderBrandedQr(business,'https://app.puntosfieles.com',{logo_data_url}),{statusCode:400});
  }
  assert.throws(()=>renderBrandedQr(business,'https://app.puntosfieles.com',{logo_position:'outside'}),{statusCode:400});
  assert.match(renderBrandedQr(business,'https://app.puntosfieles.com',{logo_data_url:fixturePng(true)}),/<image/);
  assert.equal(JSON.stringify(business),original);
});

test('every source-branded SVG variant decodes to the selected same-business source',async()=>{
  const {renderBrandedQr}=await import('../../../src/app/services/branded-qr-service.js');
  const logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/l8AAAAASUVORK5CYII=';
  for(const slug of ['cafe','café/x','n'.repeat(120)]){
    const business={id:'own',name:'Cafe',slug,customer_branding_json:{customer_logo_url:logo}};
    const source={id:'source',business_id:'own',code:'abcdefghijklmnop'};
    for(const logo_position of ['center','header','none']){
      const svg=renderBrandedQr(business,'https://puntos.example',{logo_position},source);
      const image=new Resvg(svg,{fitTo:{mode:'width',value:960}}).render();
      assert.equal(jsQR(new Uint8ClampedArray(image.pixels),image.width,image.height)?.data,`https://puntos.example/registro/${encodeURIComponent(slug)}?origen=abcdefghijklmnop`);
    }
    assert.throws(()=>renderBrandedQr(business,'https://puntos.example',{}, {...source,business_id:'other'}));
  }
});
