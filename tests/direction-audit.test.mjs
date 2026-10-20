import test from 'node:test';
import assert from 'node:assert/strict';
import {decide,captureFourContext,carryFourContext,safeSnapshot,FOUR_CONTEXT_AGE} from '../lib/compass.ts';
const now=1800000000000;
const input=horizon=>({horizon,alt:.5,altWithEth:.5,smaller:.6,btc:.2,btcDom:0,usdtDom:-.02,breadth:{up:75,down:20,flat:5,total:100,available:100,advance:75,median:.2},coverage:1});
const snapshot=()=>({at:now,fetchedAt:now,stale:false,signal:'LONG BIAS',alignedSignal:'LONG BIAS',alignment:'ALIGNED',baselineFourHoursMinutes:240,altCap:1e10,btcPrice:80000,btcDominance:57,usdtDominance:6,rows:[{id:'sol',changes:{'4h':.5}}],readings:Object.fromEntries(['15m','1h','4h'].map(h=>[h,decide(input(h),true)])),reasons:[]});
test('market-wide bias requires basket, breadth, BTC and USDT agreement',()=>{
  assert.equal(decide(input('4h'),true).bias,'LONG');
  assert.equal(decide({...input('4h'),btc:-.31},true).bias,'WAIT');
  assert.equal(decide({...input('4h'),usdtDom:0},true).bias,'WAIT');
  assert.equal(decide({...input('4h'),coverage:.89},true).bias,'WAIT');
  assert.equal(decide({...input('1h'),alt:-.5,btc:-.2,usdtDom:.02,breadth:{...input('1h').breadth,up:20,down:75,advance:20}},true).bias,'SHORT');
});
test('completed 4h context survives a newer incomplete snapshot without resetting its observation time',()=>{
  const old=snapshot(),saved=captureFourContext(old,now);
  const next={...snapshot(),at:now+3600000,baselineFourHoursMinutes:null};
  const result=carryFourContext(next,saved,now+3600000);
  assert.equal(result.fourStatus,'saved');assert.equal(result.fourContext.at,now);
  assert.equal(result.alignedSignal,'LONG BIAS');
});
test('expired 4h observations lose alignment and per-coin changes',()=>{
  const saved=captureFourContext(snapshot(),now);
  const later=now+FOUR_CONTEXT_AGE+1;
  const result=safeSnapshot({...snapshot(),at:later,fourContext:saved,fourStatus:'saved'},later);
  assert.equal(result.fourStatus,'expired');assert.equal(result.readings['4h'].bias,'WAIT');assert.equal(result.rows[0].changes['4h'],null);assert.equal(result.alignedSignal,'WAIT');
});
test('old or future primary snapshots suppress every directional signal',()=>{
  for(const at of [now-600001,now+30001]){
    const result=safeSnapshot({...snapshot(),at},now);
    assert.equal(result.signal,'WAIT');assert.equal(result.alignedSignal,'WAIT');assert.equal(result.stale,true);
  }
});
