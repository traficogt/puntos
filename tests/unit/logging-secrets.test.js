import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';

test('loading server configuration keeps startup output reserved for application logs', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/config/index.js');"], {
    env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' }, encoding: 'utf8'
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('HTTP logging never records session cookies, CSRF, API credentials or magic-link credentials', () => {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { logger } from './src/utils/logger.js';
    logger.info({req:{url:'/api/magic/customer/secret-magic?token=secret-query',query:{token:'secret-query'},params:{token:'secret-magic'},headers:{authorization:'secret-auth',cookie:'secret-cookie','x-csrf-token':'secret-csrf','x-api-key':'secret-api'}},res:{statusCode:200,headers:{'set-cookie':['pf_customer=secret-session; HttpOnly']}}},'request completed');
  `], { env: { ...process.env, LOG_LEVEL: 'info' }, encoding: 'utf8' });
  for (const secret of ['secret-magic', 'secret-query', 'secret-auth', 'secret-cookie', 'secret-csrf', 'secret-api', 'secret-session']) assert.ok(!output.includes(secret), `${secret} appeared in a log`);
  assert.equal(JSON.parse(output).res.statusCode, 200);
});

test('real HTTP middleware redacts bearer URLs and integration credentials', () => {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import http from 'node:http';
    import pinoHttp from 'pino-http';
    import { httpLogOptions } from './src/utils/logger.js';
    const middleware = pinoHttp(httpLogOptions);
    const server = http.createServer((req,res)=>{middleware(req,res);res.end('ok');});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    await fetch('http://127.0.0.1:'+server.address().port+'/api/MAGIC/Customer/secret-magic?token=secret-query',{headers:{'x-webhook-secret':'secret-webhook','x-registration-token':'secret-registration','x-metrics-token':'secret-metrics','x-signature':'secret-signature'}});
    await new Promise(r=>server.close(r));
  `], { env: { ...process.env, LOG_LEVEL: 'info' }, encoding: 'utf8' });
  for (const secret of ['secret-magic','secret-query','secret-webhook','secret-registration','secret-metrics','secret-signature']) assert.ok(!output.includes(secret), `${secret} appeared in HTTP log`);
});
