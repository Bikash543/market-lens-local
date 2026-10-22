import test from 'node:test';
import assert from 'node:assert/strict';
import {localJSON,monitorServer} from '../local/service-health.mjs';
import {runtimeOptions} from '../local/runtime-options.mjs';
import {runtimeConfig} from '../local/runtime-config.mjs';
import path from 'node:path';

test('desktop runtime keeps the same database and loopback port without developer tracing or page reloads',()=>{
  const root=path.resolve('test-app'),options=runtimeOptions(root,runtimeConfig({},root,false));
  assert.equal(options.config,path.join(root,'dist/server/wrangler.json'));
  assert.equal(options.dev.persist,path.join(root,'data/state'));
  assert.deepEqual(options.dev.server,{hostname:'127.0.0.1',port:8787});
  assert.equal(options.dev.remote,false);assert.equal(options.dev.inspector,false);
  assert.equal(options.dev.liveReload,false);assert.equal(options.sendMetrics,false);
});

test('packaged worker preserves external user data and forwards isolated service ports',()=>{
  const root=path.resolve('installed-app'),data=path.resolve('saved-user-data');
  const config=runtimeConfig({MARKET_LENS_DATA_DIR:data,MARKET_LENS_PORT:'18787'},root,true);
  const options=runtimeOptions(root,config);
  assert.equal(options.dev.persist,path.join(data,'state'));
  assert.equal(options.dev.server.port,18787);
  assert.equal(options.bindings.MARKET_LENS_CONTROL_ORIGIN.value,'http://127.0.0.1:18788');
  assert.equal(options.bindings.MARKET_LENS_TRANSPORT_ORIGIN.value,'http://127.0.0.1:18789');
  assert.equal(options.dev.inspector,false);assert.equal(options.dev.liveReload,false);
});

test('scan transport preserves worker restart and empty response diagnostics',async()=>{
  await assert.rejects(localJSON(new Response('Your worker restarted mid-request.',{status:503})),/Local API 503: Your worker restarted/);
  await assert.rejects(localJSON(new Response('')),/Local API 200: Empty response/);
  await assert.rejects(localJSON(Response.json({error:'Exchange cooling down'},{status:503})),/Exchange cooling down/);
  assert.deepEqual(await localJSON(Response.json({symbol:'ETHUSDT',price:123})),{symbol:'ETHUSDT',price:123});
});
test('health monitor restarts an unresponsive worker even if the parent is alive',async()=>{
  const controller=new AbortController();let probes=0,restarts=0;
  await monitorServer({signal:controller.signal,pause:async()=>{},probe:async()=>{probes++;throw new Error('Worker unavailable')},onUnhealthy:()=>{restarts++}});
  assert.equal(probes,3);assert.equal(restarts,1);
});
test('one healthy probe resets failure count; isolated failures do not restart',async()=>{
  const controller=new AbortController();const results=[false,false,true,false,false,false];let probes=0,restarts=0;
  await monitorServer({signal:controller.signal,pause:async()=>{},probe:async()=>results[probes++],onUnhealthy:()=>{restarts++}});
  assert.equal(probes,6);assert.equal(restarts,1);
});
test('stopping during a probe or timer cannot restart a user-stopped app',async()=>{
  for(const during of ['pause','probe']){
    const controller=new AbortController();let restarts=0;
    await monitorServer({signal:controller.signal,maxFailures:1,pause:async()=>{if(during==='pause')controller.abort()},probe:async()=>{controller.abort();return false},onUnhealthy:()=>{restarts++}});
    assert.equal(restarts,0);
  }
});
