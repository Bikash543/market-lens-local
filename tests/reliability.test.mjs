import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { createFeedCache, deadline } from '../lib/feed-cache.ts';
import { chooseTask, startScanner } from '../lib/scan-scheduler.ts';
import { windowCacheMs,unverifiedWindowCacheMs } from '../lib/window-cache.ts';

registerHooks({resolve(specifier, context, next){
  return next(['./feed-cache','./local-fetch'].includes(specifier)?specifier+'.ts':specifier,context);
}});
const {upstreamJSON,retryAfter}=await import('../lib/upstream.ts');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const never=()=>new Promise(()=>{});

test('unverified closed statistics refresh within 30s even when their timestamp is current',()=>{
  for(const [interval,step] of [['15m',900000],['1h',3600000]]){
    const boundary=Math.floor(1800000000000/step)*step,now=boundary+10000;
    assert.equal(unverifiedWindowCacheMs(interval,boundary-1,now),30000);
    assert.equal(unverifiedWindowCacheMs(interval,boundary-step-1,now),2000);
    assert.equal(unverifiedWindowCacheMs(interval,boundary-1,boundary+step-1500),1500);
    assert.ok(windowCacheMs(interval,boundary-1,now)>30000);
  }
});

test('one request cannot inherit another request’s unfinished feed promise',async()=>{
  const cache=createFeedCache();
  let release,calls=0;
  const blocked=cache.scope(()=>cache.get('price',1000,()=>new Promise(resolve=>{release=resolve;calls++})));
  const healthy=await deadline(cache.scope(()=>cache.get('price',1000,async()=>{calls++;return 42})),100);
  assert.equal(healthy,42);
  assert.equal(calls,2);
  release(42);await blocked;
  assert.equal(await cache.get('price',1000,async()=>{throw Error('should be cached')}),42);
});
test('duplicate work is coalesced only inside its own request',async()=>{
  const cache=createFeedCache();let calls=0;
  const fetch=async()=>{calls++;await delay(10);return {price:42}};
  const results=await cache.scope(()=>Promise.all([cache.get('p',1000,fetch),cache.get('p',1000,fetch)]));
  assert.deepEqual(results,[{price:42},{price:42}]);assert.equal(calls,1);
});
test('hung optional cache storage cannot block a healthy upstream',async()=>{
  const cache=createFeedCache({read:never,write:never},15);
  assert.equal(await deadline(cache.get('p',1000,async()=>42),200),42);
});
test('an expired isolate entry reuses a newer value published by another isolate',async()=>{
  let box=null,calls=0;
  const storage={read:async()=>box,write:async(_key,value)=>{box=value}};
  const a=createFeedCache(storage),b=createFeedCache(storage);
  await a.get('p',-1,async()=>1);
  await b.get('p',1000,async()=>2);
  assert.equal(await a.get('p',1000,async()=>{calls++;return 3}),2);
  assert.equal(calls,0);
});
test('shared leases deduplicate cold fetches across independent cache instances',async()=>{
  const boxes=new Map(),locks=new Map();let calls=0;
  const storage={
    read:async key=>boxes.get(key)??null,
    write:async(key,value)=>{boxes.set(key,value)},
    acquire:async(key,owner)=>{if(locks.has(key))return false;locks.set(key,owner);return true},
    release:async(key,owner)=>{if(locks.get(key)===owner)locks.delete(key)},
  };
  const a=createFeedCache(storage),b=createFeedCache(storage);
  const loader=async()=>{calls++;await delay(25);return {price:42}};
  assert.deepEqual(await Promise.all([a.get('p',1000,loader),b.get('p',1000,loader)]),[{price:42},{price:42}]);
  assert.equal(calls,1);assert.equal(locks.size,0);
});
test('validated windows expire on the next bar, while delayed windows get short retries',()=>{
  const hour=3600000,now=100*hour+120000;
  assert.equal(windowCacheMs('1h',100*hour-1,now),3480000);
  assert.equal(windowCacheMs('15m',100*hour-1,now),780000);
  assert.equal(windowCacheMs('15m',100*hour-1,now+900000),2000);
});
test('stale fallback preserves observation time and has a hard expiry',async()=>{
  const cache=createFeedCache(),value={updated:100,price:42};
  await cache.get('p',-10,async()=>value);
  const fallback=await cache.get('p',1000,async()=>{throw Error('offline')},{staleMs:1000,onStale:(v,e)=>({...v,stale:true,error:e.message})});
  assert.equal(fallback.updated,100);assert.equal(fallback.stale,true);
  await assert.rejects(cache.get('p',1000,async()=>42,{staleMs:1,onStale:v=>v}),/offline/);
});
test('an upstream stalled while reading its JSON body is aborted by its deadline',async()=>{
  let aborted=false;
  const fetcher=async(_url,{signal})=>{signal.addEventListener('abort',()=>aborted=true);return {ok:true,status:200,json:never}};
  const start=Date.now();
  await assert.rejects(upstreamJSON('https://body.test/data',{fetcher,timeoutMs:150}),/timed out/);
  assert.ok(Date.now()-start<700);assert.equal(aborted,true);
});
test('a fast network interruption gets one retry and permanent access errors do not',async()=>{
  let calls=0;
  const result=await upstreamJSON('https://retry.test/data',{fetcher:async()=>{
    if(++calls===1)throw Error('temporary reset');
    return Response.json({ok:true});
  }});
  assert.equal(result.ok,true);assert.equal(calls,2);
  calls=0;
  await assert.rejects(upstreamJSON('https://denied.test/data',{fetcher:async()=>{calls++;return new Response('',{status:403})}}),/403/);
  assert.equal(calls,1);
});
test('rate limits honor Retry-After and suppress immediate repeated requests',async()=>{
  let calls=0;
  const options={fetcher:async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'60'}})}};
  await assert.rejects(upstreamJSON('https://rate.test/data',options),e=>e.retryAfterMs===60000);
  await assert.rejects(upstreamJSON('https://rate.test/data',options),/cooling down/);
  assert.equal(calls,1);assert.equal(retryAfter('120'),120000);
  assert.equal(retryAfter(new Date(60000).toUTCString(),0),60000);
});
test('selected and visible contracts take priority, with cooldowns respected',()=>{
  const tasks=[{symbol:'background',priority:3,updated:0},{symbol:'visible',priority:1,updated:0},{symbol:'selected',priority:0,updated:0,retryAt:2000000}];
  assert.equal(chooseTask(tasks,new Set(),1000000).symbol,'visible');
  assert.equal(chooseTask(tasks,new Set(['visible']),1000000).symbol,'background');
  assert.equal(chooseTask(tasks,new Set(),2000000).symbol,'selected');
});
test('statistics calls reserve shared slots and save exchange cooldowns',async()=>{
  let reservations=0,deferrals=0;
  const gate={reserve:async()=>{reservations++;return Date.now()},defer:async(_key,until)=>{deferrals++;assert.ok(until>Date.now())}};
  await upstreamJSON('https://shared.test/api/v5/rubik/success',{gate,fetcher:async()=>Response.json({code:'0'})});
  await assert.rejects(upstreamJSON('https://shared.test/api/v5/rubik/limited',{gate,fetcher:async()=>Response.json({code:'50011'})}),/rate limited/);
  assert.equal(reservations,2);assert.equal(deferrals,1);
  let fetched=false;
  await assert.rejects(upstreamJSON('https://shared.test/api/v5/rubik/queued',{gate:{...gate,reserve:async()=>null},fetcher:async()=>{fetched=true;return Response.json({})}}),/queue is busy/);
  assert.equal(fetched,false);
  await assert.rejects(upstreamJSON('https://shared.test/api/v5/rubik/cooldown',{gate:{...gate,reserve:async()=>({retryAfterMs:120000})},fetcher:async()=>{fetched=true;return Response.json({})}}),e=>e.retryAfterMs===120000);
  assert.equal(fetched,false);
});
test('a stuck coin does not stall other coins; stop aborts work and ignores late results',async()=>{
  const done=new Set(),started=[],signals=[];let release,peak=0;
  const scanner=startScanner({
    tasks:()=>['stuck','BTC','ETH','SOL'].filter(s=>!done.has(s)).map(symbol=>({symbol,priority:1,updated:0})),
    spacingMs:5,concurrency:2,
    run:async(symbol,signal)=>{
      started.push(symbol);signals.push(signal);
      if(symbol==='stuck')return new Promise(resolve=>release=resolve);
      await delay(10);return symbol;
    },
    success:(symbol)=>done.add(symbol),
    failure:()=>assert.fail('unexpected failure'),
    busy:n=>peak=Math.max(n,peak),
  });
  try{
    await deadline((async()=>{while(done.size<3)await delay(5)})(),500);
    assert.deepEqual([...done],['BTC','ETH','SOL']);assert.equal(peak,2);
  }finally{scanner.stop();release?.('late')}
  await delay(10);
  assert.ok(signals.every(s=>s.aborted));assert.equal(done.has('stuck'),false);
  assert.equal(started.length,4);
});
