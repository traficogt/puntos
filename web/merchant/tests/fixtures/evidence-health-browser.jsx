import React from 'react';
import {createRoot} from 'react-dom/client';
import {MantineProvider} from '@mantine/core';
import '@mantine/core/styles.css';
import '../../src/styles.css';
import DataHealth from '../../src/DataHealth.jsx';
import TransactionHistory from '../../src/TransactionHistory.jsx';
import {createPlatformHealth} from '../../../../public/super/operations-health.js';
import {loadCustomerDemand} from '../../../../public/customer/demand-notebook.js';
import {clearWalletView,invalidateCustomerIdentity} from '../../../../public/customer/session.js';
import {api} from '../../../../public/lib.js';
const mode=new URLSearchParams(location.search).get('screen'),root=document.getElementById('root');
root.style.cssText='padding:24px;max-width:1200px;margin:auto';
if(mode==='platform'){
 let epoch=0;const screen=createPlatformHealth({container:root,api,currentSession:()=>epoch});
 Object.assign(window,{harnessPlatformClear(){epoch++;screen.clear();},harnessPlatformLoad:screen.load});void screen.load();
}else if(mode==='customer'){
 root.innerHTML='<div id="needLogin" hidden><h2>Ingresa de nuevo</h2><p id="customerEntrySubtitle"></p></div><main id="main"><p id="who">Cliente privado de prueba</p><p id="points">Saldo privado de prueba</p><section id="customerDemand"></section></main>';
 const $=selector=>document.querySelector(selector);let epoch=0;
 const load=()=>{const current=epoch;$('#main').hidden=false;$('#main').classList.remove('is-hidden');return loadCustomerDemand({api,$,isCurrent:()=>current===epoch});};
 Object.assign(window,{harnessCustomerClear(){epoch++;invalidateCustomerIdentity();clearWalletView($);},harnessCustomerLoad:load});void load();
}else createRoot(root).render(<MantineProvider>{mode==='health'?<DataHealth/>:<TransactionHistory/>}</MantineProvider>);
