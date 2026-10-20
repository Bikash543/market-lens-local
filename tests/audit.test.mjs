import test from 'node:test';
import assert from 'node:assert/strict';
import {signal,signalCoverage,dominanceStatus,analyze} from '../lib/engine.ts';
import {inspectHealth} from '../lib/health-check.ts';
import {normalizeOKXMarket} from '../lib/market-data.ts';
const now=1800000000000;
const a={symbol:'ETHUSDT',interval:'1h',updated:now,closedAt:now-1,oiAt:now,oi:100000,oiChange:1,cvd:2000,imbalance:.2,momentum:1,atr:2,ema:99,price:100,funding:0,candles:[],cvdSeries:[]};
const dom={btc:58,usdt:5,updated:now,btcChange:0,usdtChange:-.03,baseline:now-3600000,history:[]};
const short={...a,momentum:-1,ema:101,imbalance:-.2,cvd:-2000};
test('observed +0.010 pp USDT state blocks both directions, without blaming the feeds',()=>{
  const d={...dom,usdtChange:.010};
  for(const candidate of [a,short]){const result=signal(candidate,d,now);assert.equal(result.score,5);assert.equal(result.side,'watch');assert.deepEqual(result.checks.filter(c=>!c.ok).map(c=>c.name),['USDT dominance'])}
  assert.match(dominanceStatus(d,now).message,/neither direction passes/);
});
test('exact dominance thresholds allow 6/6 in both directions',()=>{
  assert.equal(signal(a,{...dom,usdtChange:-.015},now).side,'long');
  assert.equal(signal(short,{...dom,usdtChange:.015},now).side,'short');
});
test('each of the six checks independently prevents a full setup',()=>{
  for(const [patch,d,expected] of [
    [{momentum:.1},dom,'Price & trend'],
    [{oiChange:.24},dom,'Open interest'],
    [{imbalance:.029},dom,'Taker flow / CVD'],
    [{funding:.00031},dom,'Funding'],
    [{},{...dom,usdtChange:0},'USDT dominance'],
    [{},{...dom,btcChange:.101},'BTC dominance'],
  ]){const r=signal({...a,...patch},d,now);assert.equal(r.score,5);assert.notEqual(r.side,'long');assert.equal(r.checks.find(c=>!c.ok).name,expected)}
});
test('BTC and altcoin dominance gates use their distinct rules',()=>{
  assert.equal(signal({...a,symbol:'BTCUSDT'},{...dom,btcChange:-.01},now).score,5);
  assert.equal(signal(a,{...dom,btcChange:-.01},now).score,6);
  assert.equal(signal({...short,symbol:'BTCUSDT'},{...dom,usdtChange:.03,btcChange:.01},now).score,5);
});
test('non-finite, future and wrong-baseline data cannot become 6/6',()=>{
  for(const patch of [{btcChange:NaN},{usdtChange:Infinity},{baseline:null},{baseline:now-60000},{updated:now+60000},{btc:Infinity}]){
    assert.equal(signal(a,{...dom,...patch},now).side,'watch');
  }
  for(const patch of [{oi:Infinity},{imbalance:NaN},{updated:now+60000},{closedAt:now+60000},{oiAt:now+60000},{price:0},{interval:'4h'}]){
    assert.equal(signal({...a,...patch},dom,now).side,'stale');
  }
});
test('coverage separates current, expired, unavailable and not-yet-scanned',()=>{
  assert.deepEqual(signalCoverage(['A','B','C','D'],{A:a,B:{...a,updated:now-600001},C:a},{C:{error:'timeout'}},now),{current:1,stale:1,unavailable:1,unscanned:1});
});
test('HTTP 200 rate-limit payload is reported as unhealthy',()=>{
  assert.equal(inspectHealth(200,'{"code":"50011","msg":"Too many requests"}').healthy,false);
  assert.equal(inspectHealth(200,'<html>Blocked</html>').healthy,false);
  assert.equal(inspectHealth(503,'{"error":"Unavailable"}').healthy,false);
  assert.equal(inspectHealth(200,'{"code":"0","data":[1]}').healthy,true);
});
test('a future component timestamp cannot hide behind a current one',()=>{
  const info=[{instId:'ETH-USDT-SWAP',state:'live',settleCcy:'USDT',ctType:'linear',instCategory:'1'}];
  const t={instId:info[0].instId,ts:now,last:100,open24h:99,volCcy24h:1000};
  const m={instId:info[0].instId,ts:now,markPx:100};
  const f={instId:info[0].instId,ts:now,fundingRate:.0001,fundingTime:now+3600000,prevFundingTime:now-7*3600000};
  assert.equal(normalizeOKXMarket(info,[t],[m],[f],now).rows.length,1);
  assert.throws(()=>normalizeOKXMarket(info,[t],[{...m,ts:now+120000}],[f],now),/No fresh/);
  assert.throws(()=>normalizeOKXMarket(info,[{...t,last:Infinity}],[m],[f],now),/No fresh/);
});
test('analysis rejects unsupported timeframe before interpreting candles',()=>{
  assert.throws(()=>analyze('ETHUSDT','4h',[],[],0,now),/Unsupported/);
});
