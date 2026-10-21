import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){return next(s.startsWith('.')&&!/\.(?:ts|mjs|js)$/.test(s)?s+'.ts':s,c)}});
const {cryptoInterest,cryptoHistory,isCryptoOI,CRYPTO_OI_UNIVERSE}=await import('../lib/oi-universe.ts');
const {compareInterest}=await import('../lib/local-compass/context.ts');
const {recoveryPlan,historySnapshots}=await import('../lib/local-compass/oi-history.ts');
const now=Math.floor(Date.now()/300000)*300000+60000;
const crypto=Array.from({length:100},(_,i)=>({instId:`C${i}-USDT-SWAP`,instType:'SWAP',state:'live',ctType:'linear',settleCcy:'USDT',instCategory:'1'}));
const excluded=[
  {...crypto[0],instId:'AAPL-USDT-SWAP',instCategory:'3'},
  {...crypto[0],instId:'XAU-USDT-SWAP',instCategory:'4'},
  {...crypto[0],instId:'EUR-USDT-SWAP',instCategory:'5'},
  {...crypto[0],instId:'BOND-USDT-SWAP',instCategory:'6'},
  {...crypto[0],instId:'UNKNOWN-USDT-SWAP',instCategory:''},
  {...crypto[0],instId:'PENDING-USDT-SWAP',state:'preopen'},
  {...crypto[0],instId:'OLD-USDT-SWAP',state:'suspend'},
  {...crypto[0],instId:'BTC-USD-SWAP',settleCcy:'BTC',ctType:'inverse'},
  {...crypto[0],instId:'BTC-USDT-261225',instType:'FUTURES'}
];
const instruments=[...crypto,...excluded];
const raw=instruments.map(r=>({instId:r.instId,oiUsd:r.instCategory==='1'?'120':'1000000000000',ts:String(now)}));
test('aggregate includes only active crypto USDT perpetuals, never symbol guesses',()=>{
  const {current,coverage}=cryptoInterest(raw,instruments,now);
  assert.equal(Object.keys(current.values).length,100);assert.equal(Object.values(current.values).reduce((s,n)=>s+n,0),12000);
  assert.deepEqual(coverage,{eligible:100,missing:0,excludedNonCrypto:4,excludedOther:3});
  assert.ok(excluded.every(r=>!(r.instId in current.values)));assert.equal(current.universe,CRYPTO_OI_UNIVERSE);
});
test('unavailable metadata fails closed rather than restoring the mixed total',()=>{
  assert.throws(()=>cryptoInterest(raw,[],now),/directory/);
  assert.throws(()=>cryptoInterest(raw,null,now),/directory/i);
  assert.throws(()=>cryptoInterest(raw,excluded,now),/directory/);
});
test('fresh crypto coverage is checked against the eligible directory, not just received rows',()=>{
  assert.throws(()=>cryptoInterest(raw.slice(0,89),instruments,now),/Incomplete/);
  const result=cryptoInterest(raw.slice(0,95),instruments,now);
  assert.equal(result.coverage.missing,5);assert.equal(Object.keys(result.current.values).length,95);
  assert.throws(()=>cryptoInterest(raw.map(r=>({...r,ts:String(now-240000)})),instruments,now),/stale/);
});
test('legacy mixed baselines yield identical crypto-only 15m, 1h and 4h changes',()=>{
  const {current}=cryptoInterest(raw,instruments,now);
  const mixed=[15,60,240].map(m=>({at:now-m*60000,source:'Local collection',values:Object.fromEntries(instruments.map(r=>[r.instId,r.instCategory==='1'?100:1]))}));
  const original=JSON.stringify(mixed),history=cryptoHistory(mixed,current);
  for(const minutes of [15,60,240]){
    const result=compareInterest(current,history,minutes);
    assert.equal(result.count,100);assert.equal(result.coverage,1);assert.equal(result.notionalCoverage,1);
    assert.ok(Math.abs(result.change-20)<1e-10);assert.equal(result.minutes,minutes);
  }
  assert.equal(JSON.stringify(mixed),original);assert.ok(history.every(s=>Object.keys(s.values).length===100));
  const plan=recoveryPlan(current,history,[],now);assert.equal(plan.state,'ready');assert.deepEqual(plan.jobs,[]);
});
test('history recovery never schedules non-crypto records or includes their values',()=>{
  const {current}=cryptoInterest(raw,instruments,now);
  const allRecords=instruments.map(r=>({instId:r.instId,checkedAt:now,retryAt:now,points:[{at:now-60000-14400000,usd:100}]}));
  const history=historySnapshots(current,allRecords);
  assert.ok(history.every(s=>Object.keys(s.values).length===100));
  const plan=recoveryPlan(current,[],[],now);
  assert.deepEqual(plan.jobs.sort(),crypto.map(r=>r.instId).sort());
});
test('legacy saved views are not mislabeled as crypto-only without manual refresh',()=>{
  assert.equal(isCryptoOI({count:499,source:'OKX USDT perpetuals'}),false);
  assert.equal(isCryptoOI(null),false);
  assert.equal(isCryptoOI({universe:'other'}),false);
  assert.equal(isCryptoOI({universe:CRYPTO_OI_UNIVERSE}),true);
});
