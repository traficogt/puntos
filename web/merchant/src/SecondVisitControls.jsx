import {useEffect,useRef,useState} from 'react';
import {useForm} from '@mantine/form';
import {Alert,Anchor,Button,Group,NumberInput,SimpleGrid,Stack,Switch,Text,Title} from '@mantine/core';
import {api,useResource,isDemo} from './api.js';
import {Failure,Loading,number} from './ui.jsx';
import {merchantRegion} from './region.js';
import {secondVisitCommitment} from './second-visit-model.js';
const base='/api/admin/automations/second-visit';
const precise=value=>new Intl.NumberFormat(merchantRegion().locale,{maximumFractionDigits:6}).format(value);
const amount=(value,currency)=>new Intl.NumberFormat(merchantRegion().locale,{style:'currency',currency}).format(value);
export default function SecondVisitControls({onDirty}){
 const [version,setVersion]=useState(0),data=useResource(base,version);
 return <section aria-labelledby="second-visit-heading"><Stack gap="md"><Title order={2} id="second-visit-heading" tabIndex={-1}>De la primera a la segunda visita</Title><Text>Un motivo concreto para volver después de la primera compra registrada. Revisa el bono y el compromiso máximo antes de activar la invitación.</Text>
  {data.loading?<Loading/>:data.error?<Failure error={data.error} retry={()=>setVersion(v=>v+1)}/>:<Editor key={version} data={data.data} onDirty={onDirty} onSaved={()=>setVersion(v=>v+1)}/>}
 </Stack></section>;
}
function Editor({data,onDirty,onSaved}){
 const form=useForm({initialValues:data.is_configured===false?{...data.settings,bonus_points:'',minimum_purchase_q:'',monthly_points_cap:0,monthly_offer_cap:0}:data.settings,validate:values=>{
  const errors={};for(const [field,min,max] of [['bonus_points',1,10000],['duration_days',1,14],['monthly_points_cap',0,2000000],['monthly_offer_cap',0,5000]])if(!Number.isInteger(values[field])||values[field]<min||values[field]>max)errors[field]=`Usa un número entero entre ${number(min)} y ${number(max)}.`;
  if(values.enabled&&values.monthly_points_cap<values.bonus_points)errors.monthly_points_cap='El presupuesto debe cubrir al menos un bono.';
  if(values.enabled&&values.monthly_offer_cap<1)errors.monthly_offer_cap='Permite al menos una oferta para activar la regla.';
  if(typeof values.minimum_purchase_q!=='number'||values.minimum_purchase_q<0)errors.minimum_purchase_q='Escribe una compra mínima. Usa 0 solo si no deseas un mínimo.';return errors;
 }});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[review,setReview]=useState(null),alive=useRef(true),dirty=form.isDirty(),proposal=data.recommendation;
 const valuesKey=JSON.stringify(form.values),commitment=secondVisitCommitment(form.values,proposal?.cost_per_point??null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{onDirty?.(dirty||busy);return()=>onDirty?.(false);},[dirty,busy,onDirty]);
 useEffect(()=>{setReview(null);},[valuesKey]);
 async function save(values){if(busy)return;setBusy(true);setError('');try{await api(base,{method:'PUT',body:JSON.stringify(values)});if(alive.current)onSaved();}catch(e){if(alive.current)setError(e.message||'No se guardaron los cambios.');}finally{if(alive.current)setBusy(false);}}
 return <Stack gap="md">
  {data.data_readiness?.inactivity_allowed===false&&<Alert color="yellow" title="Ofertas nuevas en espera">{data.data_readiness.summary} Las ofertas ya concedidas conservan sus términos.</Alert>}
  {proposal?.settings?<Stack gap="sm"><Title order={3}>Una propuesta para revisar</Title><Text size="sm">Partimos del 10 % de los {number(proposal.source.reward_points)} puntos de tu recompensa «{proposal.source.reward_name}», sujeto al límite por compra. Tu regla actual otorga {precise(proposal.source.earning_rate)} puntos por {proposal.source.program_type==='VISIT'?'visita':proposal.source.program_type==='ITEM'?'artículo':`unidad de ${data.currency}`}.</Text><Text size="sm">Propone {number(proposal.settings.bonus_points)} puntos al volver en {proposal.settings.duration_days} días, hasta {proposal.settings.monthly_offer_cap} ofertas nuevas al mes. Elige la compra mínima y ajusta los límites según tu negocio.</Text><Button variant="default" w="fit-content" disabled={busy||form.values.enabled} onClick={()=>form.setValues({...proposal.settings,minimum_purchase_q:''})}>Usar propuesta para revisar</Button></Stack>:<Alert color="blue" title="Completa tu propuesta"><Text size="sm">No hay una recomendación disponible con la regla de acumulación, las recompensas activas y el límite por compra actuales. Define el bono, la compra mínima y ambos límites abajo, o revisa <Anchor underline="always" href="/administracion/?configurar=puntos">tu programa</Anchor> y <Anchor underline="always" href="/administracion/?seccion=recompensas">tus recompensas</Anchor>.</Text></Alert>}
  <form onSubmit={form.onSubmit(values=>values.enabled?setReview({...values}):save(values))}><Stack gap="md">
   <Switch label="Activar invitación a la segunda visita" description="Desactivada al comenzar. Antes de activarla, revisa los términos y confirma al final." disabled={busy} {...form.getInputProps('enabled',{type:'checkbox'})}/>
   <SimpleGrid cols={{base:1,sm:2}}>
    <NumberInput label="Bono en la segunda compra" min={1} max={10000} allowDecimal={false} disabled={busy} {...form.getInputProps('bonus_points')}/>
    <NumberInput label={`Compra mínima (${data.currency})`} description="Escribe 0 si cualquier importe puede calificar." min={0} max={999999.99} decimalScale={2} disabled={busy} {...form.getInputProps('minimum_purchase_q')}/>
    <NumberInput label="Días para volver" min={1} max={14} allowDecimal={false} disabled={busy} {...form.getInputProps('duration_days')}/>
    <NumberInput label="Máximo de ofertas nuevas al mes" min={0} max={5000} allowDecimal={false} disabled={busy} {...form.getInputProps('monthly_offer_cap')}/>
    <NumberInput label="Presupuesto mensual en puntos" description="Cada oferta reserva su bono completo. Vencer o devolver una compra no repone este límite." min={0} max={2000000} allowDecimal={false} disabled={busy} {...form.getInputProps('monthly_points_cap')}/>
   </SimpleGrid>
   <Text size="sm" c="dimmed">Solo una invitación de esta regla por cliente. La próxima compra debe cumplir el mínimo antes de vencer. Si coincide otra oferta dirigida, se aplica una: la que vence primero. Pausar detiene nuevas invitaciones y conserva los bonos ya prometidos.</Text>
   {error&&<Alert color="red" role="alert">{error}</Alert>}<Button type="submit" w="fit-content" loading={busy} disabled={!dirty}>{form.values.enabled?'Revisar antes de activar':data.settings.enabled?'Pausar segunda visita':isDemo?'Guardar segunda visita en demostración':'Guardar propuesta sin activar'}</Button>
  </Stack></form>
  {review&&<Stack gap="sm" role="region" aria-labelledby="second-visit-review-heading"><Title order={3} id="second-visit-review-heading">Revisa el compromiso antes de activar</Title><Text>{number(review.bonus_points)} puntos extra en la siguiente compra de al menos {number(review.minimum_purchase_q)} {data.currency}. Cada oferta vence {review.duration_days} días después de crearse.</Text><Text>Sin reservas previas, máximo: {number(commitment.offers)} ofertas completas y {number(commitment.points)} puntos comprometidos al mes, limitado por tu presupuesto de {number(review.monthly_points_cap)} puntos y {number(review.monthly_offer_cap)} ofertas.</Text><Text>{commitment.cost==null?'Costo monetario desconocido: falta tu supuesto de costo por punto. No significa costo cero.':`Costo estimado máximo: ${amount(commitment.cost,data.currency)}, usando tu supuesto de ${precise(proposal.cost_per_point)} ${data.currency} por punto. No es un gasto confirmado.`} <Anchor underline="always" href="#costos">Revisar costos</Anchor></Text><Text size="sm">Los {number(data.budget?.points_committed)} puntos ya reservados este mes cuentan para el límite. El bono se gana al comprar otra vez; enviar la invitación requiere consentimiento. Se suma a los puntos normales. {proposal?.purchase_point_cap?`El límite total por compra es ${number(proposal.purchase_point_cap)} puntos; una compra que lo supere puede rechazarse.`:'No hay un límite total de puntos por compra configurado.'} Los descuentos externos y el retorno adicional son desconocidos.</Text><Group><Button loading={busy} onClick={()=>save(review)}>{isDemo?'Activar segunda visita en demostración':'Confirmar y activar segunda visita'}</Button><Button variant="default" disabled={busy} onClick={()=>setReview(null)}>Volver a editar</Button></Group></Stack>}
  <Group gap="lg"><Text size="sm">{number(data.budget?.points_committed)} puntos reservados este mes</Text><Text size="sm">{number(data.budget?.offers_created)} ofertas creadas este mes</Text></Group>
  <div><Title order={3}>Regreso observado</Title><Text mt="xs">{number(data.results?.returned_customers)} de {number(data.results?.offers_created)} clientes con oferta registraron otra compra durante su vigencia. {number(data.results?.bonuses_claimed)} bonos usados.</Text><Text size="sm">{number(data.results?.open_windows)} ventanas siguen abiertas. {data.note}</Text></div>
 </Stack>;
}
