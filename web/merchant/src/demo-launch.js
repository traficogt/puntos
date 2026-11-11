let revision=1;
let program={program_type:'SPEND',rate:0.1,round:'ceil',version:String(revision).padStart(64,'0')};
export function demoLaunchProgram(options={}){
 const method=options.method||'GET';if(method==='GET')return {ok:true,program:{...program}};
 if(method!=='PUT')throw new Error('Acción no disponible.');
 const body=JSON.parse(options.body||'{}');
 if(body.version!==program.version)throw Object.assign(new Error('La regla cambió; recarga la configuración.'),{status:409});
 if(!['SPEND','VISIT','ITEM'].includes(body.program_type)||typeof body.rate!=='number'||!Number.isFinite(body.rate)||body.rate<=0||body.rate>10000||!['ceil','floor','round'].includes(body.round)||(body.program_type!=='SPEND'&&!Number.isInteger(body.rate))||(body.program_type==='SPEND'&&Math.abs(body.rate*10000-Math.round(body.rate*10000))>=0.000001))throw new Error('Revisa la regla de puntos.');
 program={program_type:body.program_type,rate:body.rate,round:body.program_type==='SPEND'?body.round:program.round,version:String(++revision).padStart(64,'0')};return {ok:true,program:{...program}};
}
