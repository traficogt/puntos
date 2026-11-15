import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const moduleUrl=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const sessionUrl=new URL('../../public/customer/session.js',import.meta.url).href;
const lib=moduleUrl('export const api=()=>{throw Error("Unexpected default API")};export const setHidden=(element,hidden)=>{if(element)element.hidden=hidden;};');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository source fixtures.
const read=name=>readFile(new URL(`../../public/${name}`,import.meta.url),'utf8');
const notebookUrl=moduleUrl((await read('demand-notebook.js')).replace("'./lib.js'",JSON.stringify(lib)));
const demandUrl=moduleUrl((await read('customer/demand-notebook.js')).replace("'./session.js'",JSON.stringify(sessionUrl)).replace("'../demand-notebook.js'",JSON.stringify(notebookUrl)));
const idb=moduleUrl('export const clearCustomerCache=async()=>{};export const putCustomerCache=async()=>{};export const getCustomerCacheSnapshot=async()=>null;');
const offers=moduleUrl('export const clearGrowthOffers=()=>{};export const loadGrowthOffers=async()=>{};');
const entitlements=moduleUrl('export const clearRewardEntitlements=()=>{};export const loadRewardEntitlements=async()=>{};');
const meRenderer=moduleUrl('export const renderFromMe=async()=>{globalThis.__demandLifecycle.rendering=true;if(globalThis.__demandLifecycle.renderGate)await globalThis.__demandLifecycle.renderGate;return{status:"live"};};');
const network=moduleUrl('export const setOnlineBadge=()=>{};');
const loadSource=(await read('customer/load.js')).replace("'./demand-notebook.js'",JSON.stringify(demandUrl))
  .replace('"./session.js"',JSON.stringify(sessionUrl)).replace('"/idb.js"',JSON.stringify(idb)).replace('"/lib.js"',JSON.stringify(lib))
  .replace('"./growth-offers.js"',JSON.stringify(offers)).replace('"./reward-entitlements.js"',JSON.stringify(entitlements))
  .replace('"./me.js"',JSON.stringify(meRenderer)).replace('"./network.js"',JSON.stringify(network))
  .replace('"./wallet-navigation.js"',JSON.stringify(new URL('../../public/customer/wallet-navigation.js',import.meta.url).href));
const {loadAll}=await import(moduleUrl(loadSource));
const {clearCustomerDemand}=await import(demandUrl);
const {clearWalletView}=await import(sessionUrl);

function element(tag='div') {
  const listeners=new Map();
  const result={tagName:tag,children:[],parentElement:null,value:'',textContent:'',disabled:false,hidden:false,
    classList:{toggle(){}},setAttribute(){},reportValidity(){return true;},
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}},
    replaceChildren(...children){this.children=[];this.append(...children);if(tag==='select')this.value=children[0]?.value||'';},
    addEventListener(name,fn){listeners.set(name,fn);},dispatch(name){return listeners.get(name)?.({preventDefault(){}});},
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);},
    reset(){for(const field of descendants(this))if(['input','textarea','select'].includes(field.tagName))field.value='';}
  };
  return result;
}
function descendants(node){return node.children.flatMap(child=>[child,...descendants(child)]);}
function deferred(){let resolve=/** @type {(value?:any)=>void} */(()=>{});const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};}
function setup(t) {
  const container=element(),saved=new Map();
  const state={customer:'customer-a',business:'business-a',calls:[],meGate:null,postGate:null,postFails:false,notebookFails:false,renderGate:null,rendering:false,
    rewards:[{id:'reward-a',name:'Una recompensa'}]};
  const values={__demandLifecycle:state,document:{createElement:element,getElementById:()=>({}),head:element()},navigator:{onLine:true},location:{href:'',hash:''},
    localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)}};
  for(const [key,value]of Object.entries(values)){
    const before=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,value});
    t.after(()=>{if(before)Object.defineProperty(globalThis,key,before);else Reflect.deleteProperty(globalThis,key);});
  }
  clearCustomerDemand();t.after(clearCustomerDemand);
  const $=selector=>selector==='#customerDemand'?container:null;
  const api=async(path,options={})=>{
    state.calls.push({path,options});
    if(path==='/api/customer/me'){
      if(state.meGate)await state.meGate;
      return{business:{id:state.business,slug:'cafe'},customer:{id:state.customer}};
    }
    assert.equal(path,'/api/customer/demand-notebook');
    if(options.method==='POST'){
      if(state.postGate)await state.postGate;
      if(state.postFails)throw new TypeError('Failed to fetch');
      return{deduplicated:false};
    }
    if(state.notebookFails)throw new Error('No pudimos cargar los pedidos');
    return{rewards:state.rewards,requests:[]};
  };
  const find=predicate=>descendants(container).find(predicate);
  return{state,saved,container,$,api,toast(){},field:name=>find(el=>el.name===name),form:()=>find(el=>el.tagName==='form'),
    button:text=>find(el=>el.tagName==='button'&&el.textContent===text)};
}

test('same-customer refresh preserves the request draft and mounted controls',async t=>{
  const h=setup(t);await loadAll(h);const form=h.form();
  h.field('topic').value='Pan sin azúcar';h.field('note').value='Por favor avísenme';h.field('reward_id').value='reward-a';
  await loadAll(h);
  assert.equal(h.form(),form);
  assert.equal(h.field('topic').value,'Pan sin azúcar');assert.equal(h.field('note').value,'Por favor avísenme');
  assert.equal(h.field('reward_id').value,'reward-a');
});

test('identity revalidation pauses submission without erasing editable input',async t=>{
  const h=setup(t);await loadAll(h);h.field('topic').value='Una opción sin azúcar';
  const gate=deferred();h.state.meGate=gate.promise;const pending=loadAll(h);
  assert.equal(h.button('Guardar pedido')?.disabled,true);
  assert.equal(h.field('topic')?.value,'Una opción sin azúcar');
  assert.equal(h.field('topic')?.disabled,false);
  gate.resolve();await pending;
  assert.equal(h.button('Guardar pedido').disabled,false);
});

test('switching customer discards the previous draft and cancels its requests',async t=>{
  const h=setup(t);await loadAll(h);h.field('topic').value='Private draft';const oldForm=h.form();
  const firstGet=h.state.calls.find(call=>call.path.endsWith('demand-notebook'));
  h.state.customer='customer-b';await loadAll(h);
  assert.notEqual(h.form(),oldForm);assert.equal(h.field('topic').value,'');assert.equal(firstGet.options.signal.aborted,true);
});

test('a different customer never renders alongside the previous customer draft',async t=>{
  const h=setup(t);await loadAll(h);h.field('topic').value='Private draft';
  const gate=deferred();h.state.customer='customer-b';h.state.renderGate=gate.promise;h.state.rendering=false;
  const loading=loadAll(h);
  while(!h.state.rendering)await new Promise(resolve=>setImmediate(resolve));
  try{assert.equal(h.container.children.length,0);}finally{gate.resolve();await loading;}
});

test('wallet refresh retries a failed notebook read without losing the draft',async t=>{
  const h=setup(t);h.state.notebookFails=true;await loadAll(h);h.field('topic').value='Una petición';
  h.state.notebookFails=false;await loadAll(h);
  assert.equal(h.state.calls.filter(call=>call.path.endsWith('demand-notebook')).length,2);
  assert.equal(h.field('topic').value,'Una petición');
  assert.ok(!descendants(h.container).some(node=>node.textContent==='No pudimos cargar los pedidos'));
});

test('manual request-list refresh preserves a still-eligible selected reward',async t=>{
  const h=setup(t);await loadAll(h);h.field('reward_id').value='reward-a';
  await h.button('Actualizar pedidos').dispatch('click');assert.equal(h.field('reward_id').value,'reward-a');
  h.state.rewards=[];await h.button('Actualizar pedidos').dispatch('click');assert.equal(h.field('reward_id').value,'');
});

test('an uncertain submission keeps its idempotency key through a wallet refresh',async t=>{
  const h=setup(t);await loadAll(h);h.field('topic').value='Una opción diferente';h.state.postFails=true;
  await h.form().dispatch('submit');const first=h.state.calls.find(call=>call.options.method==='POST');
  await loadAll(h);h.state.postFails=false;await h.form().dispatch('submit');
  const posts=h.state.calls.filter(call=>call.options.method==='POST');
  assert.equal(posts.length,2);assert.equal(JSON.parse(posts[1].options.body).request_id,JSON.parse(first.options.body).request_id);
});

test('removing a reward cannot silently turn an uncertain retry into a different request',async t=>{
  const h=setup(t);await loadAll(h);h.field('topic').value='Una opción diferente';h.field('reward_id').value='reward-a';h.state.postFails=true;
  await h.form().dispatch('submit');const first=h.state.calls.find(call=>call.options.method==='POST');
  h.state.rewards=[];await loadAll(h);await loadAll(h);
  const retained=h.field('reward_id').children.find(option=>option.value==='reward-a');
  assert.equal(retained.textContent,'Una recompensa (envío pendiente)');
  h.state.postFails=false;await h.form().dispatch('submit');
  const posts=h.state.calls.filter(call=>call.options.method==='POST');
  assert.deepEqual(JSON.parse(posts[1].options.body),JSON.parse(first.options.body));
});

test('history refresh resumes after a submission completes during session revalidation',async t=>{
  const h=setup(t);await loadAll(h);h.field('topic').value='Una opción diferente';const postingGate=deferred();h.state.postGate=postingGate.promise;
  const posting=h.form().dispatch('submit');const validation=deferred();h.state.meGate=validation.promise;
  const loading=loadAll(h);postingGate.resolve();await posting;validation.resolve();await loading;
  assert.equal(h.state.calls.filter(call=>call.path.endsWith('demand-notebook')&&call.options.method!=='POST').length,2);
});

test('an in-flight request survives same-account refresh but cannot restore a cleared view',async t=>{
  const h=setup(t);await loadAll(h);h.field('topic').value='Una opción diferente';const gate=deferred();h.state.postGate=gate.promise;
  const posting=h.form().dispatch('submit');await loadAll(h);assert.equal(h.button('Guardar pedido').disabled,true);
  clearWalletView(h.$);gate.resolve();await posting;assert.equal(h.container.children.length,0);
});
