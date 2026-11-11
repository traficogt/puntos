import {REGIONAL_COUNTRIES as countries,REGIONAL_CURRENCIES as currencies} from '../../../public/regional-catalog.js';
let region={country:'GT',currency:'GTQ',timezone:'America/Guatemala',locale:'es-GT',minorUnits:2};
let revision=1,confirmed=false;
export function demoRegion(_url,options={}){
 if(options.method==='PUT'){
  const input=JSON.parse(options.body);if(!Object.hasOwn(countries,input.country))throw new Error('País no admitido.');if(input.version!==String(revision))throw new Error('La configuración cambió. Actualiza antes de guardar.');
  if(input.currency!=='GTQ')throw new Error('La moneda está protegida por los movimientos de este negocio de ejemplo.');
  confirmed=input.confirmed_currency===input.currency;
  region={...region,country:input.country,timezone:input.timezone,locale:countries[input.country].locale};revision++;
 }
 return{region,countries,currencies,currency_locked:true,currency_confirmed:confirmed,version:String(revision)};
}
