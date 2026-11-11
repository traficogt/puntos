import test from 'node:test';import assert from 'node:assert/strict';
import {startDemoAnalytics,trackDemoEvent} from '../src/demo-analytics.js';
test('demo analytics never loads on a private merchant path and strips URLs and data from allowed events',()=>{
 const oldLocation=globalThis.location,oldDocument=globalThis.document,oldTracker=globalThis.umami;const events=[];let loads=0;
 try{globalThis.location={pathname:'/negocio/'};globalThis.document={createElement:()=>{loads++;return{dataset:{},addEventListener:()=>{}};},head:{appendChild:()=>{}}};globalThis.umami={track:fn=>events.push(fn({url:'/demo?token=private',referrer:'https://private.test/?secret=x',data:{phone:'private'}}))};
 startDemoAnalytics();trackDemoEvent('demo_action_completed');assert.equal(loads,0);assert.equal(events.length,0);
 globalThis.location={pathname:'/demostracion/'};startDemoAnalytics();trackDemoEvent('not_allowed');trackDemoEvent('demo_action_completed');trackDemoEvent('demo_action_completed');assert.equal(loads,1);assert.equal(events.length,1);assert.equal(events[0].url,'/demostracion/');assert.equal(events[0].referrer,'');assert.deepEqual(events[0].data,{});
 }finally{globalThis.location=oldLocation;globalThis.document=oldDocument;globalThis.umami=oldTracker;}
});
