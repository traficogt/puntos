import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatusSnapshot } from '../../deploy/status/snapshot-model.mjs';
const now = '2026-11-16T12:00:00Z';
const history = { sitio: { status: 'up', lastUpdated: now, startTime: now, private: 'never' } };
test('a failed monitor cannot silently re-publish a successful prior observation', () => {
  assert.equal(buildStatusSnapshot({ histories: history, now }).components[0].state, 'unknown');
  const result = buildStatusSnapshot({ histories: history, now, monitorSucceeded: true });
  assert.equal(result.components[0].state, 'up');
  assert.equal(result.components[1].state, 'unknown');
  assert.equal(JSON.stringify(result).includes('never'), false);
});
test('public users cannot spoof incidents or incident updates', () => {
  const issue = { number: 1, title: 'Incidencia', body: '<!-- private metadata -->\nServicio lento', html_url: 'https://github.com/traficogt/puntos-estado/issues/1', state: 'open', labels: [{ name: 'status' }], author_association: 'MEMBER', created_at: now };
  const fake = { ...issue, number: 2, author_association: 'NONE' };
  const result = buildStatusSnapshot({ now, issues: [issue, fake], comments: { 1: [{ body: 'spoof', author_association: 'NONE' }, { body: 'Investigando', author_association: 'OWNER', created_at: now }] }, incidentFeedAvailable: true });
  assert.equal(result.incidents.length, 1);
  assert.equal(result.incidents[0].body, 'Servicio lento');
  assert.deepEqual(result.incidents[0].updates, [{ body: 'Investigando', at: now }]);
  assert.equal(result.incidentsCheckedAt, now);
});
test('maintenance and closed incidents retain their real timestamps', () => {
  const issue = { number: 2, html_url: 'https://github.com/traficogt/puntos-estado/issues/2', user: { login: 'github-actions[bot]' }, state: 'closed', labels: [{ name: 'maintenance' }], created_at: now, closed_at: now };
  const result = buildStatusSnapshot({ now, issues: [issue] });
  assert.equal(result.incidents[0].maintenance, true);
  assert.equal(result.incidents[0].closedAt, now);
  assert.equal(result.incidentsCheckedAt, null);
});

test('incident retrieval follows labeled open pages before bounded closed history', async () => {
  const {fetchIncidentFeed} = await import('../../deploy/status/snapshot-model.mjs');
  const calls=[];
  const issue=(number,state='open')=>({number,title:`Incident ${number}`,state,comments:0,html_url:`https://github.com/traficogt/puntos-estado/issues/${number}`,author_association:'OWNER',labels:[{name:'status'}],created_at:now,updated_at:now});
  const request=async path=>{calls.push(path);const q=new URL(path,'https://api.github.com/').searchParams;const items=q.get('labels')==='maintenance'?[]:q.get('state')==='closed'?[issue(99,'closed')]:q.get('page')==='1'?[issue(1)]:[issue(2)];const link=q.get('labels')==='status'&&q.get('state')==='open'&&q.get('page')==='1'?'<https://api.github.com/repos/traficogt/puntos-estado/issues?state=open&labels=status&per_page=100&page=2>; rel="next", <https://api.github.com/repos/traficogt/puntos-estado/issues?state=open&labels=status&per_page=100&page=2>; rel="last"':'';return new Response(JSON.stringify(items),{headers:{link}});};
  const feed=await fetchIncidentFeed(request);assert.equal(feed.incidentFeedAvailable,true);assert.deepEqual(feed.issues.map(x=>x.number),[1,2,99]);assert.ok(calls.every(path=>path.includes('labels=status')||path.includes('labels=maintenance')));
});
test('open-incident pagination or display overflow discloses incomplete history',async()=>{
  const {fetchIncidentFeed}=await import('../../deploy/status/snapshot-model.mjs');
  const issue=number=>({number,state:'open',comments:0,html_url:`https://github.com/traficogt/puntos-estado/issues/${number}`,author_association:'OWNER',labels:[{name:'status'}],created_at:now});
  const request=async path=>new Response(JSON.stringify(path.includes('state=open')&&path.includes('labels=status')?[issue(1),issue(2)]:[]),{headers:{link:path.includes('state=open')?'<https://api.github.com/repos/traficogt/puntos-estado/issues?page=2>; rel="next", <https://api.github.com/repos/traficogt/puntos-estado/issues?page=2>; rel="last"':''}});
  const feed=await fetchIncidentFeed(request,{maxOpenPages:1,displayLimit:1});assert.equal(feed.incidentFeedAvailable,false);assert.equal(feed.issues.length,1);assert.equal(feed.issues[0].state,'open');
});
test('latest comments come from the actual last pages and retain trusted updates',async()=>{
  const {fetchIncidentFeed}=await import('../../deploy/status/snapshot-model.mjs');const calls=[];
  const issue={number:7,state:'open',comments:204,html_url:'https://github.com/traficogt/puntos-estado/issues/7',author_association:'OWNER',labels:[{name:'status'}],created_at:now};
  const request=async path=>{calls.push(path);if(!path.includes('/comments?'))return new Response(JSON.stringify(path.includes('state=open')&&path.includes('labels=status')?[issue]:[]));const page=Number(new URL(path,'https://api.github.com').searchParams.get('page'));const count=page===3?4:100,offset=(page-1)*100;return new Response(JSON.stringify(Array.from({length:count},(_,i)=>({id:offset+i+1,body:`Update ${offset+i+1}`,author_association:'OWNER',created_at:now}))),{headers:{link:page===2?'<https://api.github.com/repos/traficogt/puntos-estado/issues/7/comments?per_page=100&page=3>; rel="next", <https://api.github.com/repos/traficogt/puntos-estado/issues/7/comments?per_page=100&page=3>; rel="last"':''}});};
  const feed=await fetchIncidentFeed(request);assert.equal(feed.incidentFeedAvailable,true);assert.deepEqual(feed.comments[7].map(x=>x.body),['Update 200','Update 201','Update 202','Update 203','Update 204']);assert.equal(calls.some(path=>path.includes('/comments?')&&path.endsWith('page=1')),false);
});
test('latest comments follow a newer last-page link and failures never claim a complete feed',async()=>{
  const {fetchIncidentFeed}=await import('../../deploy/status/snapshot-model.mjs');
  const issue={number:8,state:'open',comments:30,html_url:'https://github.com/traficogt/puntos-estado/issues/8',author_association:'OWNER',labels:[{name:'status'}],created_at:now};
  const request=async path=>{if(!path.includes('/comments?'))return new Response(JSON.stringify(path.includes('state=open')&&path.includes('labels=status')?[issue]:[]));if(path.endsWith('page=1'))return new Response('[]',{headers:{link:'<https://api.github.com/repos/traficogt/puntos-estado/issues/8/comments?per_page=100&page=2>; rel="next", <https://api.github.com/repos/traficogt/puntos-estado/issues/8/comments?per_page=100&page=2>; rel="last"'}});return new Response(JSON.stringify(Array.from({length:5},(_,i)=>({id:101+i,body:`Latest ${i}`,author_association:'OWNER',created_at:now}))));};
  const feed=await fetchIncidentFeed(request);assert.equal(feed.incidentFeedAvailable,true);assert.equal(feed.comments[8].at(-1).body,'Latest 4');
  const failed=await fetchIncidentFeed(async path=>path.includes('/comments?')?new Response('{}',{status:503}):request(path));assert.equal(failed.incidentFeedAvailable,false);assert.equal(failed.issues.length,1);
});
test('large incident summaries stay below the public fetch limit and disclose omitted details',()=>{
 const issues=Array.from({length:50},(_,index)=>({number:index+1,state:'open',title:`Incident ${index+1}`,body:'x'.repeat(1800),html_url:`https://github.com/traficogt/puntos-estado/issues/${index+1}`,author_association:'OWNER',labels:[{name:'status'}],created_at:now}));
 const comments=Object.fromEntries(issues.map(issue=>[issue.number,Array.from({length:5},()=>({body:'y'.repeat(1200),author_association:'OWNER',created_at:now}))]));
 const result=buildStatusSnapshot({now,issues,comments,incidentFeedAvailable:true});assert.equal(result.incidents.length,50);assert.ok(JSON.stringify(result,null,2).length<200000);assert.equal(result.incidentsCheckedAt,null);
});
test('comment request budgets and untrusted pagination fail closed without following foreign endpoints',async()=>{
 const {fetchIncidentFeed}=await import('../../deploy/status/snapshot-model.mjs');
 const issue={number:9,state:'open',comments:400,html_url:'https://github.com/traficogt/puntos-estado/issues/9',author_association:'OWNER',labels:[{name:'status'}],created_at:now};let calls=0;
 const request=async path=>{if(!path.includes('/comments?'))return new Response(JSON.stringify(path.includes('state=open')&&path.includes('labels=status')?[issue]:[]));calls++;return new Response(JSON.stringify([{id:400,body:'Public spam',author_association:'NONE',created_at:now}]));};
 const limited=await fetchIncidentFeed(request,{maxCommentRequests:1});assert.equal(limited.incidentFeedAvailable,false);assert.equal(calls,1);assert.deepEqual(limited.comments[9],[]);
 const paths=[];const foreign=await fetchIncidentFeed(async path=>{paths.push(path);return new Response('[]',{headers:{link:'<https://elsewhere.example/secret?page=2>; rel="next"'}});});assert.equal(foreign.incidentFeedAvailable,false);assert.ok(paths.every(path=>path.startsWith('issues?')));assert.equal(paths.length,4);
});
