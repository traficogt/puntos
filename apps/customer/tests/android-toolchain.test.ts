import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
const entrypoint=new URL('../tools/android/entrypoint.sh',import.meta.url).pathname;
function fixture() {
 const dir=mkdtempSync(path.join(tmpdir(),'pf-toolchain-test-'));
 const bin=path.join(dir,'bin'),work=path.join(dir,'work'),tools=path.join(dir,'tools'),sdk=path.join(dir,'sdk'),log=path.join(dir,'calls');
 for(const folder of [bin,work,tools,path.join(work,'scripts'),path.join(tools,'bin')])mkdirSync(folder,{recursive:true});
 const script=(file:string,body:string)=>writeFileSync(file,'#!/bin/bash\nset -euo pipefail\n'+body,{mode:0o700});
 script(path.join(bin,'java'),'echo \'openjdk version "17.0.17"\' >&2\n');
 script(path.join(bin,'npm'),`test -z "\${PF_ANDROID_STORE_PASSWORD:-}"\nprintf 'npm %s\\n' "$*" >> "$PF_TEST_LOG"\nif [[ "\${PF_TEST_FAIL_NPM:-}" == "$*" ]]; then exit 42; fi\n`);
 script(path.join(tools,'bin/sdkmanager'),`printf 'sdk %s\\n' "$*" >> "$PF_TEST_LOG"\nif [[ "$*" == *--licenses* ]]; then head -n 1 >/dev/null; fi\n`);
 script(path.join(work,'scripts/build-android-release.sh'),`test "$PF_ANDROID_STORE_PASSWORD" = 'fixture-password'\ntest "$PF_ANDROID_KEY_PASSWORD" = 'fixture-password'\ntest "$PF_ANDROID_KEYSTORE_BASE64" = 'Zml4dHVyZS1rZXk='\ntest "$PF_ANDROID_VERSION_CODE" = 13\ntest "$PF_ANDROID_KEY_ALIAS" = pf-upload\nprintf 'release %s\\n' "$*" >> "$PF_TEST_LOG"\n`);
 writeFileSync(path.join(work,'.nvmrc'),'22.23.5\n');
 writeFileSync(path.join(dir,'key.p12'),'fixture-key',{mode:0o600});
 writeFileSync(path.join(dir,'password'),'fixture-password\n',{mode:0o600});
 const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,
  PF_TEST_LOG:log,PF_ANDROID_WORK_DIR:work,PF_ANDROID_TOOLS_HOME:tools,
  ANDROID_SDK_ROOT:sdk,ANDROID_HOME:sdk,GRADLE_USER_HOME:path.join(dir,'gradle'),
  npm_config_cache:path.join(dir,'npm'),PF_ANDROID_ARTIFACTS_DIR:path.join(dir,'artifacts'),
  PF_ANDROID_SIGNING_KEY_FILE:path.join(dir,'key.p12'),PF_ANDROID_PASSWORD_FILE:path.join(dir,'password'),
  PF_ANDROID_VERSION_CODE:'13',PF_ANDROID_KEY_ALIAS:'pf-upload'};
 return {dir,log,env,run:(mode:string,extra:Record<string,string>={})=>spawnSync('bash',[entrypoint,mode],{env:{...env,...extra},encoding:'utf8'}),calls:()=>existsSync(log)?readFileSync(log,'utf8'):'',close:()=>rmSync(dir,{recursive:true,force:true})};
}
test('local container installs only the pinned SDK components and handles license pipe exit',()=>{
 const f=fixture();try{const result=f.run('setup');assert.equal(result.status,0,result.stderr);const calls=f.calls();assert.match(calls,/--licenses/);for(const pkg of ['platforms;android-36','build-tools;36.0.0','ndk;27.1.12297006','cmake;3.22.1'])assert.ok(calls.includes(pkg));assert.doesNotMatch(calls,/system-images|emulator/);}finally{f.close();}
});
test('local container validates code before loading signing credentials and reuses release validation',()=>{
 const f=fixture();try{const result=f.run('build');assert.equal(result.status,0,result.stderr);assert.deepEqual(f.calls().trim().split('\n'),['npm ci --include=dev --no-audit --no-fund','npm run lint','npm run typecheck','npm test','release all']);assert.doesNotMatch(result.stdout+result.stderr,/fixture-password|Zml4dHVyZS1rZXk=/);const properties=readFileSync(path.join(f.dir,'gradle/gradle.properties'),'utf8');assert.match(properties,/org.gradle.workers.max=1/);assert.match(properties,/org.gradle.parallel=false/);}finally{f.close();}
});
test('failed app checks never reach signing or native compilation',()=>{
 const f=fixture();try{const result=f.run('build',{PF_TEST_FAIL_NPM:'run typecheck'});assert.notEqual(result.status,0);assert.doesNotMatch(f.calls(),/release/);assert.doesNotMatch(result.stdout+result.stderr,/fixture-password/);}finally{f.close();}
});
test('missing signing files and unknown commands fail before package installation',()=>{
 const f=fixture();try{const result=f.run('build',{PF_ANDROID_PASSWORD_FILE:path.join(f.dir,'absent')});assert.notEqual(result.status,0);assert.equal(f.calls(),'');assert.notEqual(f.run('publish').status,0);}finally{f.close();}
});
test('local compilation shares the bounded JVM and limits native compiler concurrency',()=>{
 const f=fixture();try{
  const result=f.run('build');assert.equal(result.status,0,result.stderr);
  const properties=readFileSync(path.join(f.dir,'gradle/gradle.properties'),'utf8');
  assert.match(properties,/^kotlin.compiler.execution.strategy=in-process$/m);
  assert.doesNotMatch(properties,/^kotlin.daemon.jvmargs=/m);
  const init=readFileSync(path.join(f.dir,'gradle/init.d/pf-native-memory.gradle'),'utf8');
  for(const plugin of ['com.android.application','com.android.library'])assert.ok(init.includes(plugin));
  for(const arg of ['-DCMAKE_JOB_POOLS=pf_native=1','-DCMAKE_JOB_POOL_COMPILE=pf_native','-DCMAKE_JOB_POOL_LINK=pf_native'])assert.ok(init.includes(arg));
 }finally{f.close();}
});
