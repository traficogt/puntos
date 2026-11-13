import React from 'react';
import {createRoot} from 'react-dom/client';
import {MantineProvider} from '@mantine/core';
import '@mantine/core/styles.css';
import '../../src/styles.css';
import {DemandNotebook} from '../../src/DemandNotebook.jsx';
import {SupplierFunding} from '../../src/SupplierFunding.jsx';
import {mountDemandNotebook} from '../../../../public/demand-notebook.js';
const mode=new URLSearchParams(location.search).get('screen');
if(mode==='staff'||mode==='customer'){document.getElementById('root').style.padding='24px';mountDemandNotebook({container:document.getElementById('root'),source:mode,getContext:()=>({customerId:window.__TEST_CUSTOMER_ID__})});}
else createRoot(document.getElementById('root')).render(<MantineProvider><div style={{padding:'24px',maxWidth:1200,margin:'auto'}}>{mode==='funding'?<SupplierFunding/>:<DemandNotebook/>}</div></MantineProvider>);
