import React from 'react';
import {createRoot} from 'react-dom/client';
import {MantineProvider} from '@mantine/core';
import '@mantine/core/styles.css';
import WeeklyOwnerBrief from '../../src/WeeklyOwnerBrief.jsx';
createRoot(document.getElementById('root')).render(<MantineProvider><main><WeeklyOwnerBrief onDirty={()=>{}}/></main></MantineProvider>);
