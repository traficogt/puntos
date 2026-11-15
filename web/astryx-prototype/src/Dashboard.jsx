// Three-band content structure adapted from Meta Astryx's dashboard template.
import React,{useState} from 'react';
import {Table,proportional,pixel} from '@astryxdesign/core/Table';
import {VStack,HStack,Grid,Heading,Button,Icon,Badge,Avatar,TextInput,Selector,SegmentedControl,SegmentedControlItem,SampleNote,money,Layout,LayoutContent} from './ui';
import CampaignDialog from './CampaignDialog';

const customers=[
 {id:'1',name:'Ana Morales',initials:'AM',visits:8,points:420,last:'Hace 3 días',status:'Cerca de su recompensa'},
 {id:'2',name:'Carlos Ruiz',initials:'CR',visits:5,points:280,last:'Hace 16 días',status:'Por recuperar'},
 {id:'3',name:'Lucía García',initials:'LG',visits:12,points:560,last:'Ayer',status:'Recompensa disponible'},
 {id:'4',name:'Diego López',initials:'DL',visits:2,points:120,last:'Hace 6 días',status:'Nuevo cliente'},
 {id:'5',name:'Sofía Pérez',initials:'SP',visits:7,points:390,last:'Hace 18 días',status:'Por recuperar'},
];
const columns=[
 {key:'name',header:'Cliente',width:proportional(2,{minWidth:190}),renderCell:r=><HStack gap={3} vAlign="center"><Avatar name={r.name} size="sm"/><strong>{r.name}</strong></HStack>},
 {key:'last',header:'Última visita',width:proportional(1,{minWidth:110})},
 {key:'visits',header:'Visitas',width:pixel(80)},
 {key:'points',header:'Puntos',width:pixel(100)},
 {key:'status',header:'Momento',width:proportional(2,{minWidth:200}),renderCell:r=><Badge label={r.status} variant={r.status==='Por recuperar'?'warning':r.status==='Recompensa disponible'?'success':'neutral'}/>},
];

export default function Dashboard({notify}){
 const [period,setPeriod]=useState('7');
 const [query,setQuery]=useState('');
 const [segment,setSegment]=useState('all');
 const [mode,setMode]=useState('normal');
 const [open,setOpen]=useState(false);
 const [campaign,setCampaign]=useState(null);
 const [sort,setSort]=useState('name');
 const rows=customers.filter(c=>c.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))&&(segment==='all'||c.status==='Por recuperar')).sort((a,b)=>sort==='points'?b.points-a.points:a.name.localeCompare(b.name,'es'));
 const visits=period==='7'?[28,34,26,48,37,58,43]:[102,126,143,167];
 const labels=period==='7'?['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']:['Sem. 1','Sem. 2','Sem. 3','Sem. 4'];
 return <main id="contenido" className="dashboard container">
  <Layout contentWidth={1400} content={<LayoutContent padding={6}><VStack gap={6}>
   <HStack hAlign="between" vAlign="center" gap={6} wrap="wrap" className="dashboard-heading"><VStack gap={2}><HStack gap={3} vAlign="center"><Heading level={1}>Buenos días, Andrea.</Heading><Badge label="Negocio de ejemplo"/></HStack><p>Esto merece tu atención en Casa Jacaranda.</p></VStack><Button label="Preparar campaña" variant="primary" icon={<Icon icon="plus"/>} onClick={()=>setOpen(true)}/></HStack>
   <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap" className="dashboard-toolbar"><SampleNote/><SegmentedControl label="Período del resumen" value={period} onChange={setPeriod}><SegmentedControlItem value="7" label="7 días"/><SegmentedControlItem value="30" label="30 días"/></SegmentedControl></HStack>
   <Grid columns={{minWidth:220,repeat:'fit'}} gap={4}>
    <VStack className="stat" gap={2}><span>Visitas registradas</span><strong>{period==='7'?'274':'538'}</strong><small>Compras observadas en el período</small></VStack>
    <VStack className="stat" gap={2}><span>Clientes que volvieron</span><strong>{period==='7'?'68':'124'}</strong><small>No equivale a ventas causadas por PF</small></VStack>
    <VStack className="stat" gap={2}><span>Recompensas pendientes</span><strong>{period==='7'?'24':'39'}</strong><small>Beneficios aún por entregar</small></VStack>
    <VStack className="stat" gap={2}><span>Costo directo estimado</span><strong>{money(period==='7'?192:312)}</strong><small>Con los costos ingresados en el ejemplo</small></VStack>
   </Grid>
   <HStack gap={6} className="dashboard-middle">
    <VStack className="visits-panel surface" gap={6} padding={6}>
      <HStack hAlign="between" vAlign="start"><VStack gap={1}><Heading level={2}>Cada visita cuenta.</Heading><p>Visitas registradas · {period==='7'?'esta semana':'este mes'}</p></VStack><Badge label="Ejemplo"/></HStack>
      <div className="visit-chart" role="img" aria-label={`Visitas de ejemplo: ${visits.map((n,i)=>`${labels[i]} ${n}`).join(', ')}.`}>{visits.map((n,i)=><div className="chart-column" key={i}><span>{n}</span><svg viewBox="0 0 56 180" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y={180-n/Math.max(...visits)*160} width="56" height={n/Math.max(...visits)*160} rx="5"/></svg><small>{labels[i]}</small></div>)}</div>
      <p className="microcopy">Actividad registrada, no una estimación de ingresos adicionales.</p>
    </VStack>
    <VStack className="decision-panel" gap={5} padding={6}>
      <Heading level={2}>Que la próxima<br/>visita no se pierda.</Heading><p>12 clientes de ejemplo llevan más tiempo del habitual sin volver.</p>
      <VStack gap={1}><HStack gap={2}><Avatar name="Ana Morales" size="sm"/><Avatar name="Carlos Ruiz" size="sm"/><Avatar name="Lucía García" size="sm"/></HStack><small>Una audiencia que puedes revisar.</small></VStack>
      <Button label="Preparar una invitación" variant="primary" onClick={()=>setOpen(true)} endContent={<Icon icon="arrowRight"/>}/>
      {campaign&&<p role="status" className="saved-campaign">“{campaign.name}” guardada como simulación. Límite: {campaign.limit} recompensas.</p>}
    </VStack>
   </HStack>
   <HStack className="operating-strip surface" gap={6} vAlign="center" hAlign="between" wrap="wrap" padding={5}><VStack gap={1}><Heading level={3}>¿Cómo está tu negocio?</Heading><p aria-live="polite">{mode==='busy'?'Pausarías invitaciones nuevas; los beneficios existentes siguen vigentes.':mode==='quiet'?'Puedes preparar una oferta limitada para las horas tranquilas.':'El programa sigue sus reglas habituales.'}</p></VStack><SegmentedControl label="Ritmo del negocio" value={mode} onChange={setMode}><SegmentedControlItem value="quiet" label="Tranquilo"/><SegmentedControlItem value="normal" label="Normal"/><SegmentedControlItem value="busy" label="Ocupado"/></SegmentedControl></HStack>
   <VStack className="customer-section" gap={5}>
     <HStack hAlign="between" vAlign="center" wrap="wrap" gap={4}><Heading level={2}>Personas, no solo puntos.</Heading><HStack gap={2} wrap="wrap"><TextInput label="Buscar clientes de ejemplo" isLabelHidden placeholder="Buscar un nombre…" type="search" value={query} onChange={setQuery}/><Selector label="Ordenar clientes" isLabelHidden value={sort} onChange={setSort} options={[{value:'name',label:'Por nombre'},{value:'points',label:'Más puntos'}]}/></HStack></HStack>
     <SegmentedControl label="Filtrar clientes" value={segment} onChange={setSegment}><SegmentedControlItem value="all" label="Todos"/><SegmentedControlItem value="recover" label="Por recuperar"/></SegmentedControl>
     {rows.length?<><p className="table-scroll-hint microcopy">Desliza la tabla para ver puntos y estado.</p><Table data={rows} columns={columns} idKey="id" density="spacious" hasHover/></>:<VStack className="empty-state" padding={8} gap={3}><Heading level={3}>No encontramos ese nombre.</Heading><p>Prueba con Ana, Carlos o Lucía, o quita el filtro.</p><Button label="Limpiar búsqueda y filtros" onClick={()=>{setQuery('');setSegment('all');}}/></VStack>}
     <SampleNote>Clientes ficticios. Esta vista no consulta la base de datos de PF.</SampleNote>
   </VStack>
  </VStack></LayoutContent>}/>
  <CampaignDialog open={open} onClose={()=>setOpen(false)} onSave={value=>{setCampaign(value);notify('Simulación guardada. No se envió ningún mensaje.');}}/>
 </main>;
}
