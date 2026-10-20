import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createWorkQueue} from '../local/work-queue.mjs';
import {analyze,signal} from '../lib/engine.ts';
import {recoveryRows} from '../lib/history-recovery.ts';
import {createFeedCache} from '../lib/feed-cache.ts';
import {createFeedCache as createDirectionCache} from '../lib/local-compass/feed-cache.ts';
registerHooks({resolve(s,c,next){return next(s==='./engine'?'./engine.ts':s,c)}});
const {reusableAnalysis,compactAnalysis,analysisDueAt}=await import('../lib/analysis-reuse.ts');
function fixture(interval,symbol='ETHUSDT'){
  const step=interval==='15m'?900000:3600000,end=Math.floor(1800000000000/step)*step,now=end+120000;
  const raw=Array.from({length:99},(_,i)=>{const t=end-(99-i)*step,p=100+i*.2;return [t,p,p+2,p-1,p+1,100,t+step-1,10000,1,60,6000]});
  const oi=Array.from({length:8},(_,i)=>({timestamp:end-(7-i)*step,sumOpenInterest:1000+i*10,sumOpenInterestValue:100000}));
  const a={...analyze(symbol,interval,raw,oi,0,now),exchange:'Binance'};
  const quote={symbol,exchange:'Binance',funding:.0001,fundingHours:4,updated:now};
  const dom={btc:58,usdt:5,updated:now,btcChange:0,usdtChange:-.03,baseline:now-3600000,history:[]};
  return {raw,oi,a,quote,dom,now,end,step};
}
test('all seven coins / both horizons: reused and compact results preserve full-recalculation signals and levels',()=>{
  for(const symbol of ['BTC','ETH','SOL','AGLD','SUI','SEI','LTC'])for(const interval of ['15m','1h']){
    const f=fixture(interval,symbol+'USDT');
    for(const funding of [-.001,-.0003,0,.00015,.001]){
      const quote={...f.quote,funding};
      const reuse=reusableAnalysis(f.a,quote,'Binance',interval,f.now);
      const full=analyze(f.a.symbol,interval,f.raw,f.oi,funding*2,f.now);
      assert.ok(reuse);
      for(const field of ['ema','atr','price','oi','oiChange','momentum','cvd','imbalance','funding','closedAt','oiAt'])assert.equal(reuse[field],full[field]);
      assert.deepEqual(signal(reuse,f.dom,f.now),signal(full,f.dom,f.now));
      assert.deepEqual(signal(compactAnalysis(reuse),f.dom,f.now),signal(full,f.dom,f.now));
      assert.equal(reuse.price-1.5*reuse.atr,full.price-1.5*full.atr);
      assert.equal(reuse.price+3*reuse.atr,full.price+3*full.atr);
      assert.ok(JSON.stringify(compactAnalysis(reuse)).length<JSON.stringify(reuse).length*.2);
    }
  }
});
test('reuse refuses changed windows, venues, instruments, invalid funding and misaligned OI',()=>{
  const f=fixture('1h'),reuse=(a,q,now=f.now)=>reusableAnalysis(a,q,'Binance','1h',now);
  assert.equal(reuse(f.a,f.quote,f.end+f.step),null);
  assert.equal(reuse({...f.a,exchange:'OKX'},f.quote),null);
  assert.equal(reuse(f.a,{...f.quote,symbol:'SOLUSDT'}),null);
  assert.equal(reuse(f.a,{...f.quote,updated:f.now-180001}),null);
  assert.equal(reuse(f.a,{...f.quote,updated:f.now+30001}),null);
  assert.equal(reuse(f.a,{...f.quote,funding:NaN}),null);
  assert.equal(reuse({...f.a,oiAt:f.a.oiAt-3600000},f.quote),null);
  assert.equal(reuse({...f.a,error:'Invalid series'},f.quote),null);
});
test('scheduled work waits for the next closed candle, delayed publications retry shortly',()=>{
  for(const interval of ['15m','1h']){const f=fixture(interval);assert.equal(analysisDueAt(interval,f.a.closedAt,f.now),f.end+f.step+15000);assert.equal(analysisDueAt(interval,f.a.closedAt-f.step,f.now),f.now+60000)}
});
test('shared queue coalesces collector and UI work, then lets the next window run',async()=>{
  let calls=0;const queue=createWorkQueue({spacingMs:0,run:async value=>{calls++;await new Promise(r=>setTimeout(r,15));return value}});
  const [a,b]=await Promise.all([queue.submit('ETH:1h',{ok:true}),queue.submit('ETH:1h',{ok:false},8)]);
  assert.deepEqual(a,b);assert.equal(calls,1);await new Promise(r=>setTimeout(r,0));
  await queue.submit('ETH:1h',{next:true});assert.equal(calls,2);queue.close();
});
test('shared queue prioritises manual requests and bounds concurrent execution',async()=>{
  const order=[];let release,active=0,max=0;
  const queue=createWorkQueue({spacingMs:0,concurrency:1,run:async v=>{active++;max=Math.max(max,active);order.push(v);if(v==='block')await new Promise(r=>release=r);active--;return v}});
  const first=queue.submit('first','block');await new Promise(r=>setTimeout(r,0));
  const background=queue.submit('background','background'),manual=queue.submit('manual','manual',8);
  release();await Promise.all([first,background,manual]);assert.deepEqual(order,['block','manual','background']);assert.equal(max,1);queue.close();
});
test('hung queue jobs time out without blocking following work',async()=>{
  const queue=createWorkQueue({spacingMs:0,concurrency:1,timeoutMs:20,run:async v=>v==='hung'?new Promise(()=>{}):v});
  const first=assert.rejects(queue.submit('hung','hung'),/timed out/),second=queue.submit('next','done');
  await first;assert.equal(await second,'done');queue.close();
});
test('waiting background jobs age past manual priority',async()=>{
  let clock=0,release;const order=[];
  const queue=createWorkQueue({now:()=>clock,spacingMs:0,concurrency:1,run:async v=>{order.push(v);if(v==='block')await new Promise(r=>release=r);return v}});
  const first=queue.submit('first','block');await new Promise(r=>setTimeout(r,0));
  const bg=queue.submit('bg','background');clock=60000;const fg=queue.submit('fg','manual',8);
  release();await Promise.all([first,bg,fg]);assert.deepEqual(order,['block','background','manual']);queue.close();
});
test('history recovery only imports real, recent original observations',()=>{
  const now=1800000000000,at=now-14400000,prices=Object.fromEntries(Array.from({length:125},(_,i)=>[String(i+1),100]));
  const good={time:at,body:JSON.stringify({at,prices})};
  const result=recoveryRows({format:'market-lens-local-backup-v1',marketHistory:[good,{...good,time:at+1},{time:now+1,body:JSON.stringify({at:now+1,prices})},{time:at,body:'bad'}],dominance:[{time:at,btc:58,usdt:5,source:'CoinPaprika'},{time:at,btc:58,usdt:5,source:'different provider'}]},now);
  assert.deepEqual(result.market,[good]);assert.equal(result.dominance.length,1);
  assert.equal(recoveryRows({format:'market-lens-local-backup-v1'},now).market.length,0);
  assert.throws(()=>recoveryRows({format:'unknown'},now),/Unsupported/);
});

test('manual context refresh joins a collector fetch that takes longer than the old 3.5s wait',async()=>{
  await Promise.all([createFeedCache,createDirectionCache].map(async make=>{
    const boxes=new Map(),locks=new Set();let calls=0;
    const storage={
      read:async key=>boxes.get(key)??null,write:async(key,box)=>boxes.set(key,box),
      acquire:async key=>{if(locks.has(key))return false;locks.add(key);return true},
      release:async key=>locks.delete(key)
    };
    const collector=make(storage,700,5000),ui=make(storage,700,5000);
    const load=async()=>{calls++;await new Promise(r=>setTimeout(r,3700));return {at:123,flow:.05}};
    const result=await Promise.all([collector.get('flow',60000,load),ui.get('flow',60000,load)]);
    assert.deepEqual(result,[{at:123,flow:.05},{at:123,flow:.05}]);assert.equal(calls,1);
  }));
});
