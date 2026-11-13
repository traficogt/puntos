// Synthetic browser-only state. Never reads or writes the merchant account.
let saved={mode:'normal',until:null,capacity:null,version:'b'.repeat(64)};
export function demoOperatingMode(){return {...saved,mode:['quiet','busy'].includes(saved.mode)&&Date.parse(saved.until)>Date.now()?saved.mode:'normal'};}
export function setDemoOperatingMode(body){
 if(body.version!==saved.version)throw new Error('El estado cambió. Actualiza la bandeja.');
 if(!['quiet','normal','busy'].includes(body.mode)||body.mode!=='normal'&&(!Number.isInteger(body.minutes)||body.minutes<30||body.minutes>240))throw new Error('Selecciona un ritmo y duración válidos.');
 saved={mode:body.mode,until:body.mode!=='normal'?new Date(Date.now()+Number(body.minutes)*60000).toISOString():null,capacity:body.capacity??saved.capacity,version:saved.version==='b'.repeat(64)?'c'.repeat(64):'b'.repeat(64)};return demoOperatingMode();
}
