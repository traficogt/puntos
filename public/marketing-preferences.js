import { api } from '/lib.js';
import { getCustomerEpoch, readCustomerStorage } from '/customer/session.js';
const byId = id => document.getElementById(id);
const status = byId('preferencesStatus');
const token = new URLSearchParams(location.search).get('token');
const endpoint = token ? `/api/public/marketing-unsubscribe/${encodeURIComponent(token)}` : '/api/customer/marketing-preferences';
let busy = false;
let saving = false;
let dirty = false;
let optedIn = false;
let generation = 0;
let loadedEpoch = '';
let controller;
function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
function clearView() {
  generation++; controller?.abort(); busy=false; saving=false; dirty=false;
  byId('preferencesContent').hidden=true;
  byId('preferencesBusiness').textContent=''; byId('preferencesCurrent').textContent='';
  byId('marketingOptIn').checked=false;
  byId('marketingOptIn').disabled=false;byId('preferencesSave').disabled=false;byId('unsubscribeButton').disabled=false;
  message('');
}
function render(data) {
  optedIn = data.marketing_opt_in === true;
  byId('preferencesBusiness').textContent = data.business_name;
  byId('preferencesCurrent').textContent = optedIn ? 'Actualmente recibes promociones de este negocio.' : 'Actualmente no recibes promociones de este negocio.';
  byId('marketingOptIn').checked = optedIn;
  byId('preferencesContent').hidden = false;
  byId('preferencesForm').hidden = Boolean(token);
  byId('unsubscribeConfirm').hidden = !token || !optedIn;
  byId('preferencesSignin').hidden = !token;
}
async function request(options = {}) {
  return api(new URL(endpoint,location.origin).toString(),{credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal,...options});
}
async function load() {
  clearView();
  if(!token&&readCustomerStorage('pf_customer_blocked')==='1') {
    message('Ingresa para consultar tus preferencias.');byId('preferencesSignin').hidden=false;return;
  }
  const run=++generation;const epoch=getCustomerEpoch();
  const current=()=>run===generation&&(token||epoch===getCustomerEpoch());
  controller=new AbortController();busy=true;
  byId('preferencesRetry').hidden = true;
  message('Consultando tus preferencias…');
  try {
    const data=await request();if(!current())return;
    render(data);loadedEpoch=epoch;
    message(token ? 'Abrir este enlace no cambia tus preferencias.' : 'Tu elección se aplica únicamente a este negocio.');
  } catch (error) {
    if(!current())return;
    message(error.status === 401 ? 'Ingresa para consultar tus preferencias.' : 'No pudimos consultar este enlace. Intenta de nuevo o ingresa a tu tarjeta.',true);
    byId('preferencesSignin').hidden = false;byId('preferencesRetry').hidden = false;
  } finally {if(current())busy=false;}
}
async function save(event) {
  event.preventDefault();if(busy)return;
  if(!token&&loadedEpoch!==getCustomerEpoch()){await load();return;}
  const run=++generation;const epoch=getCustomerEpoch();
  const current=()=>run===generation&&(token||epoch===getCustomerEpoch());
  controller=new AbortController();busy=true;saving=true;
  byId('preferencesSave').disabled=true;byId('unsubscribeButton').disabled=true;byId('marketingOptIn').disabled=true;
  message('Guardando tu elección…');
  try {
    const data=await request({method:token?'POST':'PUT',body:JSON.stringify(token?{confirm:true}:{marketing_opt_in:byId('marketingOptIn').checked})});
    if(!current())return;
    render(data);dirty=false;
    message(data.marketing_opt_in ? 'Preferencia guardada. Aceptaste recibir promociones.' : 'Preferencia guardada. No recibirás nuevas promociones de este negocio.');
  } catch {if(current())message('No pudimos confirmar tu elección. Vuelve a consultar tus preferencias antes de intentar de nuevo.',true);}
  finally {if(current()){busy=false;saving=false;byId('preferencesSave').disabled=false;byId('unsubscribeButton').disabled=false;byId('marketingOptIn').disabled=false;}}
}
byId('preferencesForm').addEventListener('submit',save);
byId('unsubscribeButton').addEventListener('click',save);
byId('preferencesRetry').addEventListener('click',load);
byId('marketingOptIn').addEventListener('change',()=>{dirty=byId('marketingOptIn').checked!==optedIn;});
window.addEventListener('beforeunload',event=>{if(dirty||saving){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',clearView);
window.addEventListener('pageshow',event=>{if(event.persisted)load();});
window.addEventListener('storage',event=>{if(!token&&['pf_customer_epoch','pf_customer_identity','pf_customer_blocked',null].includes(event.key))load();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearView();else load();});
load();
