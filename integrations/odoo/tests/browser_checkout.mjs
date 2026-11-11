/* eslint-disable security/detect-non-literal-fs-filename -- All paths belong to the isolated fixture directory created by test_browser.sh. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '../../../node_modules/playwright/index.mjs';

const directory = process.env.PF_BROWSER_FIXTURE_DIR;
const origin = process.env.PF_BROWSER_ORIGIN;
let fixture;
for (let attempt = 0; attempt < 1500 && !fixture; attempt++) {
    try { fixture = JSON.parse(await readFile(`${directory}/ready.json`, 'utf8')); }
    catch { await new Promise(resolve => setTimeout(resolve, 200)); }
}
if (!fixture) throw new Error('Odoo browser fixture did not become ready');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
page.on('console', message => {
    if (message.type() !== 'error') return;
    const value = message.text();
    // The test deliberately drops two responses; all other console errors fail.
    if (!value.startsWith('Failed to load resource: net::ERR_FAILED') && !value.startsWith('ConnectionLostError:')) errors.push(value);
    console.error('Browser console:', value);
});
await page.context().addCookies([
    { name:'session_id',value:fixture.sessionId,url:origin },
    { name:'test_request_key',value:fixture.requestKey,url:origin },
]);
let losePayment = true;
let loseStatus = false;
await page.route('**/*', async route => {
    const request = route.request();
    if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) return route.abort();
    if (request.url().includes('/pos.order/sync_from_ui') && losePayment) {
        const payload = request.postDataJSON();
        if (payload.params.args[0].some(order => order.state === 'paid')) {
            losePayment = false;
            loseStatus = true;
            await route.fetch();
            return route.abort('failed');
        }
    }
    if (request.url().includes('/pos.order/pf_checkout_status') && loseStatus) {
        loseStatus = false;
        return route.abort('failed');
    }
    return route.continue();
});
async function openPf() {
    if (page.viewportSize().width < 768) {
        if (await page.locator('.review-button').isVisible()) await page.locator('.review-button').click();
        await page.locator('.mobile-more-button').click();
    }
    await page.getByRole('button', { name:'Puntos Fieles', exact:true }).first().click();
    await page.locator('.pf-checkout').waitFor();
}
async function chooseReward() {
    await openPf();
    await page.locator('#pf-customer-qr').fill(fixture.token);
    await page.getByRole('button', {name:'Find rewards', exact:true}).click();
    await page.getByRole('button', {name:'Redeem', exact:true}).click();
    await page.getByRole('button', {name:'Retry confirmation', exact:true}).waitFor();
}
try {
    await page.goto(`${origin}/pos/ui?config_id=${fixture.configId}&debug=assets`);
    await page.getByRole('button', {name:'Open Register',exact:true}).click({timeout:90000});
    await page.getByRole('button', {name:'Puntos Fieles',exact:true}).first().waitFor({timeout:90000});
    await chooseReward();
    await page.getByRole('button', {name:'Close',exact:true}).last().click();
    await page.reload();
    await page.getByRole('button', {name:'Puntos Fieles',exact:true}).first().waitFor({timeout:60000});
    await openPf();
    await page.getByRole('button', {name:'Retry confirmation',exact:true}).click();
    await page.getByText('Reward authorized. Complete this order to confirm delivery.', {exact:true}).waitFor();
    await page.getByRole('button', {name:'Close',exact:true}).last().click();
    await page.locator('.pay-order-button').click();
    await page.getByRole('button', {name:'Validate',exact:true}).click();
    await page.getByText('Receipt confirmation pending', {exact:true}).waitFor();
    assert.equal(await page.locator('.receipt-screen').count(), 0);
    await page.screenshot({ path:`${directory}/confirmation-pending.png`,fullPage:true });
    // Odoo also displays its standard offline warning for the intentionally lost response.
    await page.getByRole('button', {name:'Continue with limited functionality',exact:true}).click();
    await page.getByRole('button', {name:'Ok',exact:true}).click();
    await page.getByRole('button', {name:'Confirm PF receipt',exact:true}).click();
    await page.locator('.receipt-screen').waitFor();
    await page.screenshot({ path:`${directory}/receipt.png`,fullPage:true });
    await page.getByRole('button', {name:'New Order',exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    await chooseReward();
    await page.getByRole('button', {name:'Retry confirmation',exact:true}).click();
    await page.getByText('Reward authorized. Complete this order to confirm delivery.', {exact:true}).waitFor();
    await page.locator('#pf-cancel-reason').fill('Customer changed their mind');
    await page.getByRole('button', {name:'Cancel PF reward and restore points',exact:true}).click();
    await page.getByText('PF cancellation confirmed.', {exact:true}).waitFor();
    await page.screenshot({path:`${directory}/cancel-mobile.png`,fullPage:true});
    assert.equal(losePayment, false);
    assert.equal(loseStatus, false);
    assert.deepEqual(errors, []);
    await writeFile(`${directory}/result.json`, JSON.stringify({ok:true}));
    console.log('Actual Odoo OWL checkout: desktop recovery, lost payment response, receipt confirmation and mobile cancellation passed.');
} catch (error) {
    if (await page.getByText('See technical details', {exact:true}).count()) {
        await page.getByText('See technical details', {exact:true}).click();
        console.error((await page.locator('.modal').last().innerText()).slice(-7000));
    }
    await page.screenshot({path:`${directory}/failure.png`,fullPage:true}).catch(()=>{});
    await writeFile(`${directory}/result.json`, JSON.stringify({ok:false,error:error.message,errors}));
    console.error(error.message);
    if (errors.length) console.error(errors);
    process.exitCode = 1;
} finally { await browser.close(); }
