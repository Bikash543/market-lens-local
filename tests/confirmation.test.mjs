import test from 'node:test';
import assert from 'node:assert/strict';
import {bars,Q,H,findPattern,spotWindow,interestWindow,makePlan,evaluate,fundingValue} from '../lib/confirmation.ts';
const end=Date.UTC(2026,9,20,8),now=end+30000;
function series(n=42,step=Q){return Array.from({length:n},(_,i)=>({t:end-(n-i)*step,o:100,h:101,l:99,c:100,v:100}))}
function setup(side='LONG'){
  const q=series();
  Object.assign(q.at(-2),{o:100,h:104,l:99.5,c:103,v:200});
  Object.assign(q.at(-1),{o:102,h:103.5,l:100.9,c:103,v:110});
  if(side==='SHORT')for(const x of q){const {o,h,l,c}=x;Object.assign(x,{o:200-o,h:200-l,l:200-h,c:200-c})}
  return {symbol:'ETH',intrabar:{bar:{t:end,o:side==='LONG'?103:97,h:side==='LONG'?103.1:97.1,l:side==='LONG'?102.9:96.9,c:side==='LONG'?103:97,v:10},checkedAt:now},q,btcQ:series(),btcH:series(42,H),spot:[5,10,15].map(m=>[String(end-m*60000),side==='LONG'?'100':'200',side==='LONG'?'200':'100']),oi:[[end-300000,1002],[end-Q-300000,1000],[end-H-300000,999]],funding:{fundingRate:'0.0001',fundingTime:end,nextFundingTime:end+8*H,ts:now},ticker:{last:side==='LONG'?'103':'97',ts:now,askPx:'103.01',bidPx:'103',open24h:'100',volCcy24h:'200000'},market:{at:now,stale:false,readings:{'1h':{bias:side,alt:side==='LONG'?.3:-.3,coverage:1,breadth:{available:110},btcDom:0,usdtDom:0}}},errors:[]};
}
test('only a later closed bar can confirm a retest',()=>{
  const x=setup();assert.equal(findPattern(x.q.slice(0,-1),'LONG',end-Q+1000).retestAt,null);
  assert.equal(findPattern(x.q,'LONG',now).retestAt,end);
});
test('long and short confirmation paths can produce valid setups',()=>{
  for(const side of ['LONG','SHORT']){
    const v=evaluate(setup(side),side,now);
    assert.equal(v.verdict,`${side} SETUP`,JSON.stringify(v.reasons));assert.equal(v.passed,7);
    assert.ok(v.plan.netRR<2&&v.plan.netRR>=1.5);assert.equal(v.plan.state,'candidate');
    assert.ok(side==='LONG'?v.plan.stop<v.plan.entry&&v.plan.target2>v.plan.entry:v.plan.stop>v.plan.entry&&v.plan.target2<v.plan.entry);
  }
});
test('missing and misaligned flow never count as agreement',()=>{
  const x=setup();x.spot=null;let v=evaluate(x,'LONG',now);
  assert.equal(v.verdict,'DATA UNAVAILABLE');assert.equal(v.checks.find(c=>c.id==='cvd').state,'missing');
  assert.equal(spotWindow([[end-5*60000,100,200],[end-10*60000,100,200]],end),null);
  assert.equal(spotWindow([[end-5*60000,100,200],[end-10*60000,100,200],[end-15*60000,'',200]],end),null);
});
test('OI uses completed five-minute buckets aligned to the candle boundary',()=>{
  const x=setup();assert.ok(interestWindow(x.oi,end).quarter>0);
  assert.equal(interestWindow(x.oi.map(v=>[v[0]+60000,v[1]]),end),null);
});
test('BTC is excluded from its own relative-strength comparison',()=>{
  const x=setup();x.symbol='BTC';const v=evaluate(x,'LONG',now);
  assert.equal(v.required,6);assert.equal(v.checks.at(-1).state,'na');
});
test('stale and future broad-market snapshots cannot confirm',()=>{
  for(const at of [now-11*60000,now+60000]){
    const x=setup();x.market.at=at;const v=evaluate(x,'LONG',now);
    assert.equal(v.checks[0].state,'missing');assert.notEqual(v.verdict,'LONG SETUP');
  }
});
test('a previous retest expires and is not turned into a current entry',()=>{
  const x=setup(),v=evaluate(x,'LONG',end+Q+1);
  assert.equal(v.plan.state,'retired');assert.notEqual(v.verdict,'LONG SETUP');
});
test('target touch, stop touch and price chasing retire plans',()=>{
  const x=setup(),p=findPattern(x.q,'LONG',now),plan=makePlan(p,x.q,103,now);
  for(const quote of [plan.target1,plan.stop,plan.entry+2*p.atr]){
    assert.equal(makePlan(p,x.q,quote,now).state,'retired');
  }
});
test('stale ticker or unknown funding cannot produce a confirmed setup',()=>{
  const x=setup();x.ticker.ts=now-130000;assert.notEqual(evaluate(x,'LONG',now).verdict,'LONG SETUP');
  x.ticker.ts=now;x.funding=null;assert.notEqual(evaluate(x,'LONG',now).verdict,'LONG SETUP');
  assert.equal(fundingValue({fundingRate:'',ts:now},now),null);
});
test('funding interval is normalized and extreme adverse costs block readiness',()=>{
  const x=setup();x.funding.fundingRate='.002';x.funding.nextFundingTime=end+H;
  assert.equal(fundingValue(x.funding,now).rate8h,1.6);assert.notEqual(evaluate(x,'LONG',now).verdict,'LONG SETUP');
});
test('closed-candle parser rejects gaps, duplicates, bad prices and stale series',()=>{
  const raw=series().map(v=>[String(v.t),v.o,v.h,v.l,v.c,1,1,v.v,'1']);
  assert.equal(bars(raw,Q,now).length,42);
  assert.throws(()=>bars([...raw,raw.at(-1)],Q,now));
  assert.throws(()=>bars(raw.filter((_,i)=>i!==20),Q,now));
  const bad=structuredClone(raw);bad[4][3]=200;assert.throws(()=>bars(bad,Q,now));
  assert.throws(()=>bars(raw,Q,now+2*Q));
});
test('repainting candle is excluded from pattern inputs',()=>{
  const raw=series().map(v=>[String(v.t),v.o,v.h,v.l,v.c,1,1,v.v,'1']);
  raw.push([String(end),100,200,90,199,1,1,1000,'0']);
  assert.equal(bars(raw,Q,now).at(-1).c,100);
});
test('cached quotes cannot extend the displayed validity beyond their freshness deadline',()=>{
  const x=setup();x.ticker.ts=now-100000;
  const v=evaluate(x,'LONG',now);assert.equal(v.expiresAt,now+20000);
  x.ticker.ts=now-130000;assert.equal(evaluate(x,'LONG',now).verdict,'DATA UNAVAILABLE');
});
