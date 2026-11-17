import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Button, Group, MantineProvider, Stack, createTheme, useMantineColorScheme} from '@mantine/core';
import '@mantine/core/styles.css';
import '../../src/styles.css';
import OwnerCustomers from '../../src/OwnerCustomers';
import OwnerTeam from '../../src/OwnerTeam';
import OwnerBranches from '../../src/OwnerBranches';
import OwnerSettings from '../../src/OwnerSettings';
import {createOwnerDemoApi} from '../../src/demo-owner-workspace';
import type {OwnerRequest} from '../../src/owner-workspace';
const demo=createOwnerDemoApi();let verified=false;
const controls={failCustomerSave:false,conflictCustomerSave:false,requests:[] as string[]};
Object.assign(window,{__ownerFixture:controls});
const send:OwnerRequest=async<T,>(path:string,options?:RequestInit):Promise<T>=>{
 controls.requests.push(`${options?.method||'GET'} ${path}`);
 if(path.includes('/api/admin/customers/')&&options?.method==='PATCH'){
  if(controls.failCustomerSave){controls.failCustomerSave=false;throw Object.assign(new Error('Fallo de conexión simulado'),{status:503});}
  if(controls.conflictCustomerSave){controls.conflictCustomerSave=false;throw Object.assign(new Error('El nombre cambió en otra sesión. Vuelve a abrir el perfil antes de guardar.'),{status:409});}
 }
 if(path.includes('q=lenta')){const result=demo(new URL('/api/admin/customers?q=Ana',location.origin),options);await new Promise(resolve=>setTimeout(resolve,300));return result as T;}
 if(new URLSearchParams(location.search).get('impersonated')==='1'&&(path.startsWith('/api/admin/staff')||path.startsWith('/api/staff/security/')))throw Object.assign(new Error('Esta acción de seguridad solo puede hacerse desde la sesión propia de la persona usuaria. (Ref: prueba)'),{status:403,code:'IMPERSONATION_FORBIDDEN'});
 if(path==='/api/admin/staff'&&!verified)throw Object.assign(new Error('Verifica tu identidad'),{status:403,code:'RECENT_REAUTH_REQUIRED'});
 if(path==='/api/staff/security/reauth'){if(typeof options?.body==='string'&&JSON.parse(options.body).password==='wrong')throw Object.assign(new Error('No pudimos verificar tu identidad.'),{status:400,code:'REAUTH_VERIFICATION_FAILED'});verified=true;}
 return demo(new URL(path,location.origin),options) as T;
};
const theme=createTheme({primaryColor:'terra',fontFamily:'Inter, sans-serif',headings:{fontFamily:'Bricolage Grotesque, sans-serif'},colors:{terra:['#fff2ed','#ffded1','#f8b9a2','#ef9678','#df7654','#cb5e3c','#b94d2f','#a43d28','#8d3322','#752b1f']},primaryShade:7});
function App(){const [page,setPage]=useState('customers'),[dirty,setDirty]=useState(false);const {toggleColorScheme}=useMantineColorScheme();const navigate=(next:string)=>{if(!dirty||confirm('Tienes cambios sin guardar. ¿Quieres descartarlos?'))setPage(next);};const params=new URLSearchParams(location.search);const props={staff:{id:'owner',role:params.get('role')||'OWNER'},features:{staff_management:params.get('plan')!=='basic',multi_branch:params.get('plan')!=='basic',customer_export:true},limits:{branches:3},onDirty:setDirty,onNavigate:navigate,request:send};return <Stack p="md" maw={1200} mx="auto"><header><Group><Button variant="default" onClick={()=>navigate('customers')}>Ir a clientes</Button><Button variant="default" onClick={()=>navigate('team')}>Ir a equipo</Button><Button variant="default" onClick={()=>navigate('branches')}>Ir a sucursales</Button><Button variant="default" onClick={()=>navigate('settings')}>Ir a configuración</Button><Button variant="default" onClick={toggleColorScheme}>Tema oscuro</Button></Group></header><main>{page==='customers'?<OwnerCustomers {...props}/>:page==='team'?<OwnerTeam {...props}/>:page==='branches'?<OwnerBranches {...props}/>:<OwnerSettings {...props}/>}</main></Stack>;}
createRoot(document.getElementById('root')!).render(<MantineProvider theme={theme}><App/></MantineProvider>);
