const branches=[{id:'22222222-2222-4222-8222-222222222222',name:'Centro · ejemplo',address:'Ubicación ilustrativa',wallet_location_enabled:false,wallet_latitude:null,wallet_longitude:null}];
export function demoWalletLocations(url,options={}){
 if(options.method==='PUT'){
  const branch=branches.find(row=>url.pathname===`/api/admin/branches/${row.id}/wallet-location`);if(!branch)throw new Error('Sucursal de ejemplo no encontrada.');
  const value=JSON.parse(options.body);Object.assign(branch,{wallet_location_enabled:value.enabled,wallet_latitude:value.latitude,wallet_longitude:value.longitude});return {ok:true,branch:{...branch}};
 }
 return {ok:true,branches:branches.map(row=>({...row})),maximum_locations:10};
}
