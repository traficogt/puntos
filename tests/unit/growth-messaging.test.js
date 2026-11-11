import test from 'node:test';
import assert from 'node:assert/strict';
import { marketingWindow, campaignMessageBody, classifyCampaignSend } from '../../src/app/services/campaign-message-service.js';

test('Guatemala campaign hours open at 09 and close at 18, with the next opening', () => {
  assert.equal(marketingWindow(new Date('2026-11-10T14:59:00Z')).allowed, false);
  assert.equal(marketingWindow(new Date('2026-11-10T15:00:00Z')).allowed, true);
  assert.equal(marketingWindow(new Date('2026-11-11T00:00:00Z')).allowed, false);
  assert.equal(marketingWindow(new Date('2026-11-11T00:00:00Z')).nextAt.toISOString(), '2026-11-11T15:00:00.000Z');
});
test('campaign copy contains bounded terms and unsubscribe without arbitrary campaign claims', () => {
  const body = campaignMessageBody({business_name:'Café',bonus_points:50,minimum_purchase_q:25,expires_at:'2026-11-20T18:00:00Z'}, 'https://example.test/preferencias-de-mensajes/?token=test');
  assert.match(body,/50 puntos/); assert.match(body,/Q25.00/); assert.match(body,/una vez/); assert.match(body,/token=test/);
});
test('campaign outcome never equates simulation or uncertain errors with provider acceptance', () => {
  assert.equal(classifyCampaignSend({ok:true,provider:'dev'}), 'suppressed');
  assert.equal(classifyCampaignSend({ok:true,provider:'smtp_email',accepted:true}), 'accepted');
  assert.equal(classifyCampaignSend({ok:false,error:'DELIVERY_UNCERTAIN'}), 'uncertain');
  assert.equal(classifyCampaignSend({ok:false,error:'NO_DELIVERY_PROVIDER'}), 'failed');
  assert.equal(classifyCampaignSend(null), 'uncertain');
});

import {MessageProviderError} from '../../src/app/services/messaging/providers/http-provider.js';
import {createWhatsAppCloudProvider} from '../../src/app/services/messaging/providers/whatsapp-cloud-provider.js';
import {createTwilioProvider} from '../../src/app/services/messaging/providers/twilio-provider.js';
import {createBaileysProvider} from '../../src/app/services/messaging/providers/baileys-provider.js';
import {createSmtpProvider} from '../../src/app/services/messaging/providers/smtp-provider.js';
import {safeLogUrl} from '../../src/utils/logger.js';
const providerConfig={WA_PHONE_NUMBER_ID:'fixture',WA_ACCESS_TOKEN:'fixture',TWILIO_ACCOUNT_SID:'fixture',TWILIO_AUTH_TOKEN:'fixture',TWILIO_WHATSAPP_FROM:'+50255550000',BAILEYS_SEND_URL:'https://fixture.invalid/send'};
const message={channel:'campaign',body:'fixture',destinations:{phone:'+50255550001'},strictAcceptance:true};
test('all HTTP adapters classify success without a provider receipt as uncertain',async()=>{
  for(const factory of [createWhatsAppCloudProvider,createTwilioProvider,createBaileysProvider]) {
    const provider=factory({config:providerConfig,fetchImpl:async()=>new Response('{}',{status:200})});
    await assert.rejects(provider.send(message),error=>error instanceof MessageProviderError && error.deliveryUncertain===true);
  }
});
test('HTTP adapter 503 and network loss stay uncertain; explicit rejection is definite',async()=>{
  for(const factory of [createWhatsAppCloudProvider,createTwilioProvider,createBaileysProvider]) {
    for(const status of [503,400]) {
      const provider=factory({config:providerConfig,fetchImpl:async()=>new Response('{}',{status})});
      await assert.rejects(provider.send(message),error=>error instanceof MessageProviderError && error.deliveryUncertain===(status===503));
    }
  }
});
test('SMTP marketing requires a real accepted recipient and URLs redact unsubscribe tokens',async()=>{
  const provider=createSmtpProvider({config:{},transportFactory:()=>({sendMail:async()=>({messageId:'id',accepted:[],rejected:['fixture@example.test']})})});
  await assert.rejects(provider.send({...message,destinations:{email:'fixture@example.test'}}));
  assert.equal(safeLogUrl(`/api/public/marketing-unsubscribe/${'a'.repeat(43)}`),'/api/public/marketing-unsubscribe/[REDACTED]');
});


test('capped campaign copy qualifies remaining availability without guaranteeing a bonus', () => {
  const campaign={business_name:'Café',bonus_points:50,minimum_purchase_q:25,expires_at:'2026-11-20T18:00:00Z',points_budget:100,points_committed:0};
  assert.match(campaignMessageBody(campaign,'https://example.test/unsubscribe'),/puntos disponibles de la campaña/i);
});
