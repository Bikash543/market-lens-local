import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:8787',root=new URL('../data/verification/',import.meta.url);
await mkdir(root,{recursive:true});
async function json(route,options){
  const response=await fetch(base+route,{...options,signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,200,route);
  return response.json();
}
const status=await json('/api/local/status'),profile=await json('/api/local/profile');
assert.equal(status.application,'Market Lens Local');
assert.equal(status.running,true);
assert.ok(Array.isArray(profile.watchlist), 'watchlist is an array');
assert.ok(profile.watchlist.every(symbol => typeof symbol === 'string' && symbol.length > 4 && symbol.endsWith('USDT')), 'watchlist contains USDT symbols');
assert.equal((await fetch(base+'/api/local/profile',{headers:{Origin:'https://example.invalid'}})).status,403);
assert.equal((await fetch(base+'/api/local/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'add',symbol:'../../bad'})})).status,400);
assert.deepEqual((await json('/api/local/profile')).watchlist,profile.watchlist);
const evidence={at:new Date().toISOString(),profile,status,securityChecks:'Cross-origin write/read blocked; invalid symbol rejected'};
const path=new URL('before-restart.json',root);
if(process.argv.includes('--after')){
  const before=JSON.parse(await readFile(path,'utf8'));
  assert.deepEqual(profile.watchlist,before.profile.watchlist);
  assert.notEqual(status.collector.startedAt,before.status.collector.startedAt);
  assert.ok(status.history.observations>=before.status.history.observations);
  assert.equal(status.history.firstObservationAt,before.status.history.firstObservationAt);
  evidence.restart='PASS: new collector process; original watchlist and history preserved';
  await writeFile(new URL('after-restart.json',root),JSON.stringify(evidence,null,2));
}else await writeFile(path,JSON.stringify(evidence,null,2));
console.log(JSON.stringify({at:evidence.at,watchlist:profile.watchlist,running:status.running,history:status.history,security:evidence.securityChecks,restart:evidence.restart},null,2));
