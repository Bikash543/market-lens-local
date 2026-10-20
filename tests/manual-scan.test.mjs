import test from 'node:test';
import assert from 'node:assert/strict';
import {manualScanTargets,runManualScan} from '../lib/manual-scan.ts';

test('a click processes each requested asset once, then stops even after errors',async()=>{
  const calls=[],success=[],failure=[],progress=[];
  await runManualScan({symbols:['ETH','BTC','ETH'],signal:new AbortController().signal,spacingMs:1,
    run:async s=>{calls.push(s);if(s==='BTC')throw new Error('Rate limit');return 1},
    success:s=>success.push(s),failure:s=>failure.push(s),progress:n=>progress.push(n)});
  await new Promise(r=>setTimeout(r,30));
  assert.deepEqual(calls,['ETH','BTC']);assert.deepEqual(success,['ETH']);assert.deepEqual(failure,['BTC']);
  assert.equal(progress.at(-1),0);
});
test('switching timeframe cancels the remaining pass and suppresses a late result',async()=>{
  const controller=new AbortController(),calls=[],results=[];
  await runManualScan({symbols:['BTC','ETH'],signal:controller.signal,spacingMs:1,
    run:async s=>{calls.push(s);controller.abort();return 1},
    success:s=>results.push(s),failure:()=>assert.fail('No cancellation error should be shown'),progress:()=>{}});
  assert.deepEqual(calls,['BTC']);assert.deepEqual(results,[]);
});
test('an already cancelled refresh does not make requests',async()=>{
  const controller=new AbortController();controller.abort();
  await runManualScan({symbols:['BTC'],signal:controller.signal,run:async()=>assert.fail('Unexpected fetch'),
    success:()=>{},failure:()=>{},progress:()=>{}});
});

test('all 287 contracts are targeted independently of table pagination',()=>{
  const rows=Array.from({length:287},(_,i)=>({symbol:`COIN${i}USDT`}));
  const targets=manualScanTargets([...rows,rows[0]],'COIN240USDT');
  assert.equal(targets.length,287);
  assert.equal(targets[0],'COIN240USDT');
  assert.equal(new Set(targets).size,287);
  assert.ok(targets.includes('COIN286USDT'));
  assert.deepEqual(manualScanTargets(rows,'DELISTEDUSDT',{onlySelected:true}),[]);
  assert.deepEqual(manualScanTargets(rows,'COIN240USDT',{onlySelected:true}),['COIN240USDT']);
});

test('watchlist refresh excludes unrelated selected and inactive contracts',()=>{
  const rows=[{symbol:'BTCUSDT'},{symbol:'ETHUSDT'},{symbol:'SOLUSDT'}];
  assert.deepEqual(manualScanTargets(rows,'BTCUSDT',{watchOnly:true,watch:['SOLUSDT','ETHUSDT','OLDUSDT']}),['ETHUSDT','SOLUSDT']);
  assert.deepEqual(manualScanTargets(rows,'BTCUSDT',{watchOnly:true,watch:[]}),[]);
});

test('a full-market pass goes beyond 15, counts failures and ends once',async()=>{
  const symbols=Array.from({length:287},(_,i)=>`C${i}`),calls=[],updates=[];
  await runManualScan({symbols,signal:new AbortController().signal,spacingMs:0,concurrency:2,
    run:async s=>{calls.push(s);if(s==='C15'||s==='C80')throw new Error('Missing history');return s},
    success:()=>{},failure:()=>{},progress:(_,p)=>updates.push(p)});
  assert.equal(calls.length,287);
  assert.equal(new Set(calls).size,287);
  assert.deepEqual(updates.at(-1),{total:287,completed:287,succeeded:285,failed:2,active:0,cancelled:false});
});

test('a hung asset times out, aborts its request and allows the queue to finish',async()=>{
  const aborted=[],success=[],failed=[],updates=[];
  await runManualScan({symbols:['HUNG','BTC','ETH'],signal:new AbortController().signal,spacingMs:0,concurrency:2,timeoutMs:20,
    run:async(s,signal)=>{if(s==='HUNG'){signal.addEventListener('abort',()=>aborted.push(s));return new Promise(()=>{})}return s},
    success:s=>success.push(s),failure:s=>failed.push(s),progress:(_,p)=>updates.push(p)});
  assert.deepEqual(aborted,['HUNG']);assert.deepEqual(success,['BTC','ETH']);assert.deepEqual(failed,['HUNG']);
  assert.equal(updates.at(-1).completed,3);
});

test('concurrent scans have paced starts and bounded concurrency',async()=>{
  const starts=[];let active=0,maxActive=0;
  await runManualScan({symbols:['A','B','C','D'],signal:new AbortController().signal,spacingMs:20,concurrency:2,
    run:async()=>{starts.push(Date.now());active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,45));active--;return 1},
    success:()=>{},failure:()=>{},progress:()=>{}});
  assert.equal(maxActive,2);
  assert.ok(starts.slice(1).every((t,i)=>t-starts[i]>=15),'Starts must respect the pacing interval');
});

test('Stop cancels active hung requests immediately without relaunching',async()=>{
  const controller=new AbortController(),calls=[],updates=[];
  setTimeout(()=>controller.abort(),15);
  await runManualScan({symbols:['A','B','C','D'],signal:controller.signal,spacingMs:0,concurrency:2,timeoutMs:1000,
    run:async s=>{calls.push(s);return new Promise(()=>{})},
    success:()=>assert.fail('Late result'),failure:()=>assert.fail('Cancellation is not a failed feed'),progress:(_,p)=>updates.push(p)});
  assert.deepEqual(calls,['A','B']);assert.equal(updates.at(-1).cancelled,true);
  assert.equal(updates.at(-1).active,0);assert.equal(updates.at(-1).completed,0);
});
