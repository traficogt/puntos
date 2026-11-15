import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Theme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import './styles.css';
import {HStack,Button,Icon,TabList,Tab,Brand} from './ui';
import Landing from './Landing';
import Dashboard from './Dashboard';
import Playground from './Playground';

const screens=['inicio','panel','componentes'];
function App(){
 const [screen,setScreen]=useState(screens.includes(location.hash.slice(1))?location.hash.slice(1):'inicio');
 const [mode,setMode]=useState('light');
 const [notice,setNotice]=useState('');
 useEffect(()=>{const change=()=>{const next=location.hash.slice(1);if(screens.includes(next)){setScreen(next);window.scrollTo({top:0,behavior:'instant'});}};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
 useEffect(()=>{document.documentElement.dataset.previewTheme=mode;},[mode]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6500);return()=>clearTimeout(timer);},[notice]);
 useEffect(()=>{document.title=`${screen==='inicio'?'Inicio':screen==='panel'?'Panel de negocio':'Componentes'} · PF con Astryx`;},[screen]);
 return <Theme theme={neutralTheme} mode={mode}><div className="pf-theme">
  <a className="skip-link" href="#contenido">Saltar al contenido</a>
  <HStack className="prototype-bar" gap={3} vAlign="center" hAlign="between" wrap="wrap">
   <span className="prototype-label"><strong>PF × Astryx</strong><span>Exploración interactiva</span></span>
   <TabList value={screen} onChange={value=>{location.hash=value;}} size="sm"><Tab value="inicio" label="Inicio" href="#inicio"/><Tab value="panel" label="Panel de negocio" href="#panel"/><Tab value="componentes" label="Componentes" href="#componentes"/></TabList>
   <Button label={mode==='light'?'Activar modo oscuro':'Activar modo claro'} variant="ghost" isIconOnly icon={<Icon icon={mode==='light'?'moon':'sun'}/>} onClick={()=>setMode(mode==='light'?'dark':'light')}/>
  </HStack>
  {screen!=='inicio'&&<HStack className="app-header container" hAlign="between" vAlign="center" gap={3}><Brand/><span className="sample-note">Espacio de prueba · Sin conexión a cuentas reales</span></HStack>}
  {screen==='inicio'?<Landing/>:screen==='panel'?<Dashboard notify={setNotice}/>:<Playground notify={setNotice}/>}
  {notice&&<HStack className="notice" gap={4} vAlign="center"><p role="status">{notice}</p><Button label="Cerrar confirmación" variant="ghost" isIconOnly icon={<Icon icon="close"/>} onClick={()=>setNotice('')}/></HStack>}
 </div></Theme>;
}
createRoot(document.getElementById('root')).render(<App/>);
