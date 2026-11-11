import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { metricsMiddleware, getRegistry } from '../../src/middleware/metrics.js';

test('metrics label routes never contain bearer tokens or arbitrary unmatched paths', async () => {
 const res = Object.assign(new EventEmitter(), { statusCode: 401 });
 metricsMiddleware({ method:'GET', baseUrl:'/api', originalUrl:'/api/magic/customer/secret-link', route:{path:'/magic/customer/:token'} },res,()=>{});res.emit('finish');
 for(let i=0;i<10;i++) {
  const missing = Object.assign(new EventEmitter(), {statusCode:404});
  metricsMiddleware({method:'GET',originalUrl:'/api/unique-unmatched-'+i},missing,()=>{});missing.emit('finish');
 }
 const output=await getRegistry().metrics();
 assert.ok(!output.includes('secret-link'));
 assert.ok(!output.includes('unique-unmatched-'));
 assert.ok(output.includes('/api/magic/customer/:token'));
 assert.ok(output.includes('/api/unmatched'));
 assert.match(output, /^# TYPE puntos_http_requests_total counter$/m);
 assert.match(output, /^# TYPE puntos_http_request_duration_seconds histogram$/m);
 assert.match(output, /^puntos_http_requests_total\{method="GET",path="\/api\/unmatched",status="404"\} 10$/m);
 assert.match(output, /^puntos_http_request_duration_seconds_count\{method="GET",path="\/api\/unmatched",status="404"\} 10$/m);
});
