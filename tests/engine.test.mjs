import assert from 'node:assert/strict';
import test from 'node:test';
import { analyze, signal } from '../lib/engine.ts';
const step=3600000, now=1800000000000, end=Math.floor(now/step)*step;
function fixture(){
  const candles=Array.from({length:60},(_,i)=>{const t=end-(60-i)*step;return [t,100+i,102+i,99+i,101+i,10,t+step-1,10000,20,6,6000,0]});
  const oi=Array.from({length:8},(_,i)=>({timestamp:end-(7-i)*step,sumOpenInterest:1000+i*10,sumOpenInterestValue:100000}));
  return {candles,oi};
}
test('CVD is signed taker quote volume and OI uses contract count',()=>{const {candles,oi}=fixture();const a=analyze('ETHUSDT','1h',candles,oi,0,now);assert.equal(a.cvd,8000);assert.equal(a.imbalance,.2);assert.ok(Math.abs(a.oiChange-(1070/1030-1)*100)<1e-10);assert.equal(a.oiAt,end);assert.equal(a.closedAt,end-1)});
test('Unfinished candles cannot change analysis',()=>{const {candles,oi}=fixture();const a=analyze('ETHUSDT','1h',candles,oi,0,now);const b=analyze('ETHUSDT','1h',[...candles,[end,160,9999,1,9000,1,end+step-1,9999999,2,1,1]],oi,0,now);assert.deepEqual(a,b)});
test('Misaligned OI is rejected rather than silently combining windows',()=>{const {candles,oi}=fixture();assert.throws(()=>analyze('ETHUSDT','1h',candles,oi.slice(0,-1),0,now),/aligned/)});
test('Missing, stale and incomplete dominance cannot produce full signals',()=>{const {candles,oi}=fixture();const a=analyze('ETHUSDT','1h',candles,oi,0,now);assert.equal(signal(a,null,now).side,'watch');const d={btc:58,usdt:5,updated:now,btcChange:0,usdtChange:-.03,baseline:now-step,history:[]};assert.equal(signal(a,d,now).side,'long');assert.equal(signal(a,{...d,updated:now-1900000},now).side,'watch');assert.equal(signal({...a,updated:now-700000},d,now).side,'stale');assert.equal(signal(undefined,d,now).side,'waiting')});
test('Shorts require bearish flow, price and dominance; crowding blocks',()=>{const {candles,oi}=fixture();const a=analyze('ETHUSDT','1h',candles,oi,0,now);const short={...a,momentum:-1,price:99,ema:100,imbalance:-.1,cvd:-100};const d={btc:58,usdt:5,updated:now,btcChange:.02,usdtChange:.03,baseline:now-step,history:[]};assert.equal(signal(short,d,now).side,'short');assert.equal(signal({...short,funding:-.001},d,now).side,'neutral')});
test('Missing candles and invalid taker volume are rejected',()=>{const {candles,oi}=fixture();assert.throws(()=>analyze('ETHUSDT','1h',candles.filter((_,i)=>i!==30),oi,0,now),/discontinuous/);candles[5][10]=20000;assert.throws(()=>analyze('ETHUSDT','1h',candles,oi,0,now),/Invalid/)});
