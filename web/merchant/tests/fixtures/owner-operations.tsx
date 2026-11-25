import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Button, Group, MantineProvider, Stack, createTheme, useMantineColorScheme} from '@mantine/core';
import '@mantine/core/styles.css';
import '../../src/styles.css';
import OwnerJobs from '../../src/OwnerJobs';
import OwnerAlerts from '../../src/OwnerAlerts';
import OwnerLedger from '../../src/OwnerLedger';
import OwnerAudit from '../../src/OwnerAudit';
import Automations from '../../src/Automations.jsx';
import {createOwnerOperationsDemoApi} from '../../src/demo-owner-operations';
import type {OwnerRequest} from '../../src/owner-workspace';
// Isolated fixture: the owner operations screens over the in-memory preview API. Automations uses the app's own
// transport, which routes to the demo module when the page is served under /demostracion; nothing reaches an API.
const demo=createOwnerOperationsDemoApi();
const controls={requests:[] as string[]};
Object.assign(window,{__ownerFixture:controls});
const send:OwnerRequest=async<T,>(path:string,options?:RequestInit):Promise<T>=>{
 controls.requests.push(`${options?.method||'GET'} ${path}`);
 const result=demo(new URL(path,location.origin),options);
 if(result===undefined)throw Object.assign(new Error('Ruta no disponible en la prueba'),{status:404});
 return structuredClone(result) as T;
};
const theme=createTheme({primaryColor:'terra',fontFamily:'Inter, sans-serif',headings:{fontFamily:'Bricolage Grotesque, sans-serif'},colors:{terra:['#fff2ed','#ffded1','#f8b9a2','#ef9678','#df7654','#cb5e3c','#b94d2f','#a43d28','#8d3322','#752b1f']},primaryShade:7});
function App(){
 const params=new URLSearchParams(location.search);
 const [page,setPage]=useState(params.get('page')||'jobs'),[dirty,setDirty]=useState(false);
 const {toggleColorScheme}=useMantineColorScheme();
 const navigate=(next:string)=>{if(!dirty||confirm('Tienes cambios sin guardar. ¿Quieres descartarlos?'))setPage(next);};
 const features={analytics:params.get('plan')!=='basic',lifecycle_automation:true,fraud_monitoring:true};
 const props={staff:{id:'owner',role:params.get('role')||'OWNER'},features,onDirty:setDirty,onNavigate:navigate,request:send};
 return <Stack p="md" maw={1200} mx="auto"><header><Group><Button variant="default" onClick={()=>navigate('jobs')}>Ir a trabajos</Button><Button variant="default" onClick={()=>navigate('alerts')}>Ir a alertas</Button><Button variant="default" onClick={()=>navigate('ledger')}>Ir a conciliación</Button><Button variant="default" onClick={()=>navigate('audit')}>Ir a auditoría</Button><Button variant="default" onClick={()=>navigate('automations')}>Ir a automatizaciones</Button><Button variant="default" onClick={toggleColorScheme}>Tema oscuro</Button></Group></header><main>{page==='jobs'?<OwnerJobs {...props} pollDelayMs={40}/>:page==='alerts'?<OwnerAlerts {...props}/>:page==='ledger'?<OwnerLedger {...props}/>:page==='audit'?<OwnerAudit {...props}/>:<Automations features={features} onDirty={setDirty}/>}</main></Stack>;
}
createRoot(document.getElementById('root')!).render(<MantineProvider theme={theme}><App/></MantineProvider>);
