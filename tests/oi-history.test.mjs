import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){return next(s==='./context'?s+'.ts':s,c)}});
const {parseOIHistory,normalizeOIRecord,historySnapshots,usableHistory,historyJobs,historyProgress,recoveryPlan,historicalUpgrades,fetchHistoryBatch,OI_STEP}=await import('../lib/local-compass/oi-history.ts');
const {compareInterest}=await import('../lib/local-compass/context.ts');
const now=Math.floor(Date.now()/OI_STEP)*OI_STEP+120000;
const anchor=Math.floor(now/OI_STEP)*OI_STEP;
const ids=Array.from({length:100},(_,i)=>`C${i}-USDT-SWAP`);
const current={at:now,values:Object.fromEntries(ids.map(id=>[id,120]))};
const records=ids.map(instId=>({instId,checkedAt:now,retryAt:now,points:Array.from({length:100},(_,i)=>({at:anchor-i*OI_STEP,usd:100}))}));

test('OI recovery reads USD column and preserves exchange timestamps, not contract counts',()=>{
  assert.deepEqual(parseOIHistory([[String(anchor-OI_STEP),'999','20','456.78']],now),[{at:anchor,bucketAt:anchor-OI_STEP,usd:456.78}]);
  assert.throws(()=>parseOIHistory([[anchor,1,2,'']],now),/Missing/);
  assert.throws(()=>parseOIHistory([[anchor+1,1,2,3]],now),/timestamp/);
  assert.throws(()=>parseOIHistory([[anchor-OI_STEP,1,2,3],[anchor-OI_STEP,1,2,4]],now),/Conflicting/);
  assert.throws(()=>parseOIHistory([[anchor,1,2,-1]],now),/Invalid/);
});
test('future and expired history cannot become a baseline',()=>{
  assert.throws(()=>parseOIHistory([[anchor,1,2,3]],now),/No recent/);
  assert.throws(()=>parseOIHistory([[anchor+OI_STEP,1,2,3]],now),/No recent/);
  assert.throws(()=>parseOIHistory([[anchor-13*3600000,1,2,3]],now),/No recent/);
});
test('older recovery cache keeps receipt times and is upgraded without a forming bucket',()=>{
  const old={instId:ids[0],checkedAt:now,retryAt:now,points:[{at:anchor,usd:110},{at:anchor-OI_STEP,usd:100}]};
  const upgraded=normalizeOIRecord(old);
  assert.deepEqual(upgraded.points,[{at:anchor,bucketAt:anchor-OI_STEP,usd:100}]);
  assert.deepEqual(normalizeOIRecord(upgraded),upgraded);
});
test('cold start recovers all three windows with no local four-hour wait',()=>{
  const snapshots=usableHistory(current,records);
  for(const minutes of [15,60,240]){
    const result=compareInterest(current,snapshots,minutes);
    assert.ok(Math.abs(result.change-20)<1e-10);assert.equal(result.count,100);
    assert.equal(result.source,'OKX historical API');assert.equal(result.coverage,1);
    assert.equal(result.notionalCoverage,1);assert.equal(result.from,anchor-minutes*60000);
    assert.equal(result.minutes,minutes+2);
  }
});
test('incomplete contract coverage is withheld; missing coins are never zeroes',()=>{
  assert.equal(usableHistory(current,records.slice(0,89)).length,0);
  assert.equal(compareInterest(current,historySnapshots(current,records.slice(0,89)),240),null);
  assert.equal(historyProgress(current,records.slice(0,40)).matched,40);
  assert.equal(historyProgress(current,records.slice(0,40)).total,100);
});
test('count coverage alone cannot omit a large coin; USD coverage must also pass',()=>{
  const concentrated={...current,values:{...current.values,[ids[99]]:100000}};
  assert.equal(usableHistory(concentrated,records.slice(0,99)).length,0);
  assert.equal(compareInterest(concentrated,historySnapshots(concentrated,records.slice(0,99)),240),null);
});
test('different times are not combined and cross-venue/margin history is excluded',()=>{
  const shifted=records.map((r,i)=>i<50?r:{...r,points:r.points.map(p=>({...p,at:p.at-13*3600000}))});
  assert.equal(usableHistory(current,shifted).length,0);
  const extra={instId:'BTC-USD-SWAP',points:[{at:anchor-14400000,usd:1e12}]};
  assert.deepEqual(historySnapshots(current,[...records,extra]),historySnapshots(current,records));
});
test('nearest incomplete point does not hide a slightly older complete baseline',()=>{
  const partial={at:now-14400000,values:{[ids[0]]:100}};
  const r=compareInterest(current,[partial,...usableHistory(current,records)],240);
  assert.equal(r.count,100);assert.equal(r.minutes,242);
});
test('gaps outside window tolerance stay unavailable rather than interpolated',()=>{
  const history=[{at:now-14400000-301000,values:current.values}];
  assert.equal(compareInterest(current,history,240),null);
  assert.equal(compareInterest(current,[{...history[0],at:now-900000-181000}],15),null);
});
test('durable records resume the missing contracts after a service restart',()=>{
  const persisted=JSON.parse(JSON.stringify(records.slice(0,70)));
  const jobs=historyJobs(current,persisted,[15,60,240],now);
  assert.equal(jobs.length,30);assert.ok(jobs.every(id=>!persisted.some(r=>r.instId===id)));
  assert.equal(historyJobs(current,records,[],now).length,0);
});
test('history batches are bounded and retain valid old data on API failure',async()=>{
  const saved=[];let calls=0;
  const result=await fetchHistoryBatch(ids,records,{now:()=>now,fetch:async()=>{calls++;if(calls===2)throw new Error('Temporary timeout');return [[anchor-OI_STEP,999,200,100]]},save:async r=>saved.push(r)});
  assert.equal(calls,6);assert.equal(saved.length,6);assert.equal(result.fetched,5);
  assert.equal(result.retryAfterMs,1000); // A single failed coin cannot stall the whole recovery.
  assert.deepEqual(saved[1].points,records[1].points);assert.ok(saved[1].retryAt>now);
  assert.equal(historyJobs(current,[saved[1]],[240],now).includes(saved[1].instId),false);
});
test('rate limits stop a recovery batch instead of hammering all contracts',async()=>{
  let calls=0;const saved=[];
  const r=await fetchHistoryBatch(ids,[],{now:()=>now,fetch:async()=>{calls++;throw Object.assign(new Error('OKX rate limited'),{retryAfterMs:120000})},save:async p=>saved.push(p)});
  assert.equal(calls,1);assert.equal(r.retryAfterMs,120000);assert.deepEqual(saved[0].points,[]);
});
test('a recovery time budget ends before the next request',async()=>{
  let clock=now,calls=0;
  await fetchHistoryBatch(ids,[],{now:()=>clock,budgetMs:1000,fetch:async()=>{calls++;clock+=2000;return [[anchor-OI_STEP,1,2,100]]},save:async()=>{}});
  assert.equal(calls,1);
});
test('451 usable contracts out of 499 still schedule the remaining 48',()=>{
  const all=Array.from({length:499},(_,i)=>`C${i}-USDT-SWAP`);
  const c={at:now,values:Object.fromEntries(all.map(id=>[id,100]))};
  const saved=all.slice(0,451).map(instId=>({...records[0],instId}));
  const plan=recoveryPlan(c,[],saved,now);
  assert.equal(plan.usable,true);assert.equal(plan.state,'recovering');
  assert.equal(plan.matched,451);assert.equal(plan.remaining,48);assert.equal(plan.unattempted,48);
  assert.deepEqual(plan.jobs,all.slice(451));assert.deepEqual(plan.windowsPending,[]);
  assert.deepEqual(plan.windowsIncomplete,[15,60,240]);
});
test('full local baselines avoid 499 redundant history calls',()=>{
  const history=[15,60,240].map(m=>({at:now-m*60000,values:current.values,source:'Local collection'}));
  const plan=recoveryPlan(current,history,[],now);
  assert.equal(plan.state,'ready');assert.equal(plan.remaining,0);assert.equal(plan.jobs.length,0);
  assert.equal(historyJobs(current,[],[],now).length,0);
});
test('usable partial baseline cannot hide a fuller point inside existing tolerance',()=>{
  const partial={at:now-14400000,values:Object.fromEntries(ids.slice(0,95).map(id=>[id,100]))};
  const result=compareInterest(current,[partial,...usableHistory(current,records)],240);
  assert.equal(result.count,100);assert.equal(result.from,anchor-14400000);
});
test('higher count but inadequate notional cannot mask a valid comparison',()=>{
  const c={...current,values:{...current.values,[ids[99]]:100000}};
  const bad={at:now-14400000,values:Object.fromEntries(ids.slice(0,99).map(id=>[id,100]))};
  const good={at:now-14400000-60000,values:Object.fromEntries(ids.slice(10).map(id=>[id,100]))};
  assert.equal(compareInterest(c,[bad,good],240).count,90);
});
test('pending errors stay visible without blocking usable data or retry cooldowns',()=>{
  const partial=records.slice(0,95);
  const failed={instId:ids[95],points:[],checkedAt:now,retryAt:now+60000,error:'No recent historical OI available'};
  const plan=recoveryPlan(current,[],[...partial,failed],now);
  assert.equal(plan.usable,true);assert.equal(plan.failed,1);assert.equal(plan.unattempted,4);
  assert.ok(!plan.jobs.includes(ids[95]));assert.equal(plan.details.find(d=>d.instId===ids[95]).reason,failed.error);
  assert.ok(recoveryPlan(current,[],[...partial,failed],now+60001).jobs.includes(ids[95]));
});
test('a different per-contract timestamp cannot falsely complete an aligned baseline',()=>{
  const broken=[...records.slice(0,99).map(r=>({...r,points:r.points.filter(p=>p.at!==anchor-14400000+OI_STEP)})),{...records[99],points:[{at:anchor-14400000+OI_STEP,usd:100}]}];
  const plan=recoveryPlan(current,[],broken,now);
  assert.equal(plan.matched,99);assert.ok(plan.jobs.includes(ids[99]));
});
test('recovery only writes changed history and protects local or richer prior points',()=>{
  const full=usableHistory(current,records),partial=usableHistory(current,records.slice(0,95));
  assert.equal(historicalUpgrades(full,full).length,0);
  assert.equal(historicalUpgrades(full,partial).length,0);
  const upgraded=historicalUpgrades(partial,full);
  assert.equal(upgraded.length,full.length);assert.equal(Object.keys(upgraded[0].values).length,100);
  const local=full.map(s=>({...s,source:'Local collection'}));
  assert.equal(historicalUpgrades(local,full).length,0);
});
test('repeated per-contract errors back off and successful retry clears the error',async()=>{
  const failed={...records[0],error:'Timeout',failures:3};
  let saved;
  await fetchHistoryBatch([failed.instId],[failed],{now:()=>now,fetch:async()=>{throw new Error('Timeout')},save:async r=>{saved=r}});
  assert.equal(saved.failures,4);assert.equal(saved.retryAt-now,480000);
  await fetchHistoryBatch([failed.instId],[saved],{now:()=>now+480001,fetch:async()=>[[anchor-OI_STEP,1,2,100]],save:async r=>{saved=r}});
  assert.equal(saved.error,undefined);assert.equal(saved.failures,undefined);
});
