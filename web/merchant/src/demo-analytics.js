const allowed=new Set(['demo_opened','demo_action_completed','demo_contact_open']);
const seen=new Set();let loading=false;
const isPublicDemo=()=>typeof location!=='undefined'&&location.pathname.replace(/\/$/,'')==='/demostracion';
export function trackDemoEvent(event){
 if(!isPublicDemo()||!allowed.has(event)||seen.has(event)||globalThis.navigator?.doNotTrack==='1')return;
 const tracker=/** @type {any} */(globalThis).umami;
 if(typeof tracker?.track!=='function')return;
 seen.add(event);
 try{Promise.resolve(tracker.track(props=>({...props,url:'/demostracion/',title:'Demostración de PuntosFieles',referrer:'',name:event,data:{}}))).catch(()=>{});}catch{/* Analytics must not affect the demo. */}
}
export function startDemoAnalytics(){
 if(!isPublicDemo()||loading||globalThis.navigator?.doNotTrack==='1')return;
 loading=true;const script=document.createElement('script');script.src='https://privatrack.com/script.js';script.defer=true;
 script.dataset.websiteId='e2ed248a-786d-472f-a3b6-333c949602e6';script.dataset.autoTrack='false';script.dataset.excludeSearch='true';script.dataset.excludeHash='true';script.dataset.doNotTrack='true';
 script.addEventListener('load',()=>trackDemoEvent('demo_opened'),{once:true});document.head.appendChild(script);
}
