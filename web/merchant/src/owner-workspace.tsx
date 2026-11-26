import {useEffect, useRef, useState} from 'react';
import {Alert, Button, Group, PasswordInput, Skeleton, Stack, Text, TextInput, Title} from '@mantine/core';
import {request} from './typed-api';
import {merchantRegion} from './region.js';

export type OwnerRequest = typeof request;
export interface OwnerStaff {id: string; role: string; branch_id?: string | null}
export interface OwnerPageProps {
  staff: OwnerStaff;
  features: Record<string, boolean>;
  onDirty?: (dirty: boolean) => void;
  onNavigate?: (page: string) => void;
  request?: OwnerRequest;
  limits?: {branches?: number; activeCustomers?: number; rewards?: number};
  /** Plan code as the server reports it (EMPRENDEDOR, NEGOCIO, EMPRESA). */
  plan?: string;
  /** Soft-cap usage from /api/admin/plan; active_customers is null when the server could not count. */
  usage?: {active_customers: number | null} | null;
}
export interface OwnerFailure {message: string; status?: number; code?: string}
export interface Branch {id: string; name: string; address: string | null; code: string}
export interface TeamMember {id: string; name: string; email: string; phone?: string | null; role: 'OWNER' | 'MANAGER' | 'CASHIER'; active: boolean; branch_id: string | null; can_manage_gift_cards: boolean}
export interface Customer {id: string; name: string | null; phone: string; created_at: string; last_visit_at: string | null; points: number; pending_points: number; lifetime_points: number; /** "Cuenta de prueba": excluded from progress, reports and plan usage; absent on older servers. */ is_test?: boolean}
export interface CustomerPage {customers: Customer[]; total: number; page: number; limit: number; total_pages: number}
const noop = () => {};
export function failure(error: unknown): OwnerFailure {
  if (error instanceof Error) return error;
  return {message: 'No pudimos completar la operación. Vuelve a intentarlo.'};
}
export function needsReauth(error: OwnerFailure | null) {return error?.code === 'RECENT_REAUTH_REQUIRED' || error?.code === 'RECENT_MFA_REQUIRED';}
export function useOwnerResource<T>(path: string | null, revision: number, send: OwnerRequest) {
  const [state,setState] = useState<{path: string | null; revision: number; data: T | null; error: OwnerFailure | null; loading: boolean}>({path:null,revision:-1,data:null,error:null,loading:!!path});
  useEffect(()=>{if(!path)return; const controller=new AbortController();setState({path,revision,data:null,error:null,loading:true});
    send<T>(path,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setState({path,revision,data,error:null,loading:false});}).catch(error=>{if(!controller.signal.aborted)setState({path,revision,data:null,error:failure(error),loading:false});});return()=>controller.abort();
  },[path,revision,send]);
  return state.path===path&&state.revision===revision?state:{path,revision,data:null,error:null,loading:!!path};
}
export function useOwnerMutation() {
  const alive=useRef(false),pending=useRef(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState<OwnerFailure | null>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function run<T>(work:()=>Promise<T>,success:(value:T)=>void) {if(pending.current)return;pending.current=true;setBusy(true);setError(null);try{const value=await work();if(alive.current)success(value);}catch(cause){if(alive.current)setError(failure(cause));}finally{pending.current=false;if(alive.current)setBusy(false);}}
  return {busy,error,clear:()=>setError(null),run};
}
export function useOwnerDirty(dirty: boolean, onDirty: (dirty:boolean)=>void = noop) {
  useEffect(()=>{onDirty(dirty);return()=>onDirty(false);},[dirty,onDirty]);
  useEffect(()=>{if(!dirty)return; const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[dirty]);
}
export function mayDiscard(dirty: boolean) {return !dirty || window.confirm('Tienes cambios sin guardar. ¿Quieres descartarlos?');}
export function OwnerLoading({label='Cargando información…'}:{label?:string}) {return <Stack role="status" aria-label={label} gap="sm"><Text>{label}</Text><Skeleton height={42}/><Skeleton height={42}/><Skeleton height={42}/></Stack>;}
function errorMessage(error:OwnerFailure) {
  if(error.status===402||error.code==='TRIAL_LOCKED'||error.code==='TRIAL_EXPIRED')return 'Tu prueba terminó. Elige un plan para seguir operando.';
  if(error.code==='REAUTH_VERIFICATION_FAILED')return 'No pudimos verificar tu identidad. Revisa la contraseña y el código de verificación.';
  if(error.message.startsWith('Email already used'))return 'Ese correo ya tiene una cuenta. Usa otro correo para crear el acceso.';
  if(error.message.startsWith('Password'))return 'Elige una contraseña de 8 a 128 caracteres que no sea común ni incluya el nombre, correo o teléfono de la cuenta.';
  if(error.message.startsWith('Invalid MFA code'))return 'Revisa el código actual de tu aplicación de verificación.';
  if(error.message.startsWith('Plan limit: branches'))return 'Llegaste al límite de sucursales de tu plan.';
  if(error.status===403&&!needsReauth(error))return 'Tu cuenta o el plan actual no permiten esta operación.';
  if(error.status===404)return 'Esta cuenta o sucursal ya no está disponible. Vuelve al listado para actualizar la información.';
  if(error.status===400||error.status===409)return error.message;
  return 'Revisa tu conexión y vuelve a intentarlo. Tus cambios siguen en el formulario.';
}
export function OwnerError({error,retry}:{error:OwnerFailure;retry?:()=>void}) {return <Alert color="red" title="No pudimos completar la operación" role="alert"><Stack gap="sm"><Text size="sm">{errorMessage(error)}</Text>{retry&&<Button variant="default" onClick={retry} w="fit-content">Reintentar</Button>}</Stack></Alert>;}
export function OwnerRestricted({title,owner=true}:{title:string;owner?:boolean}) {return <Stack><Title order={1}>{title}</Title><Text>{owner?'Esta función no está incluida en el plan actual de tu negocio.':'Esta sección está disponible para el dueño del negocio.'}</Text></Stack>;}
export function VerifyIdentity({send,onVerified}:{send:OwnerRequest;onVerified:()=>void}) {
  const [password,setPassword]=useState(''),[code,setCode]=useState('');const mutation=useOwnerMutation();
  return <section aria-labelledby="owner-verify-heading"><Stack maw={520}><Title order={2} id="owner-verify-heading">Verifica tu identidad</Title><Text>Para administrar accesos, confirma tu contraseña. Si tienes verificación en dos pasos, incluye el código actual.</Text>{mutation.error&&<OwnerError error={mutation.error}/>}<form onSubmit={event=>{event.preventDefault();mutation.run(()=>send('/api/staff/security/reauth',{method:'POST',body:JSON.stringify({password,...(code?{mfaCode:code}:{})})}),()=>{setPassword('');setCode('');onVerified();});}}><Stack><PasswordInput label="Tu contraseña" autoComplete="current-password" required maxLength={128} value={password} onChange={event=>setPassword(event.currentTarget.value)} disabled={mutation.busy}/><TextInput label="Código de verificación (si está activado)" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event=>setCode(event.currentTarget.value)} disabled={mutation.busy}/><Group><Button type="submit" loading={mutation.busy}>Verificar y continuar</Button></Group></Stack></form></Stack></section>;
}
export function ownerDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(merchantRegion().locale,{dateStyle:'medium',timeStyle:'short',timeZone:merchantRegion().timezone}).format(date);
}
export function ownerDate(value: string | null) {return value?new Intl.DateTimeFormat(merchantRegion().locale,{dateStyle:'medium',timeZone:merchantRegion().timezone}).format(new Date(value)):'Sin visitas registradas';}
export {request};
