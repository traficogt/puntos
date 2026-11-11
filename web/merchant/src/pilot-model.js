import {currentPilotChecklistVersion,pilotChecksForVersion} from '../../../public/pilot-checklists.js';
export {currentPilotChecklistVersion,pilotChecksForVersion};
export const pilotChecks=pilotChecksForVersion(currentPilotChecklistVersion);
export function pilotReport(detail){
 return {format:'puntosfieles-pilot-report-v2',generated_at:new Date().toISOString(),pilot:{checklist_version:detail.pilot.checklist_version,pos_profile:detail.pilot.pos_profile??null,name:detail.pilot.name,status:detail.pilot.status,duration_days:detail.pilot.duration_days,started_at:detail.pilot.started_at,planned_end_at:detail.pilot.planned_end_at,closed_at:detail.pilot.closed_at,close_note:detail.pilot.close_note},checks:detail.checks.map(({key,label,required,instruction,status,note,updated_at})=>({key,label,required,...(instruction?{instruction}:{}),status,note,updated_at,evidence_type:'owner_reported'})),results:detail.results,notice:'Informe privado del negocio. Las pruebas son declaraciones del responsable; no certifican automáticamente las integraciones ni demuestran causalidad. Revisa las notas antes de compartir y solicita permiso antes de publicar un caso de éxito.'};
}
export function downloadPilotReport(detail){
 const url=URL.createObjectURL(new Blob([JSON.stringify(pilotReport(detail),null,2)],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='informe-piloto-puntosfieles.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
