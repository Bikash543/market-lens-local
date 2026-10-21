import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {analyze,attachFourContext,safeSnapshot,validFourContext,FOUR_CONTEXT_AGE} from '../lib/compass.ts';
import {allowedURL} from '../local/exchange-network.mjs';
registerHooks({resolve(s,c,n){return n(s==='./compass'?'./compass.ts':s,c)}});
const {cmcConstituents,cmcFourHour,cmcHistoryQuery}=await import('../lib/cmc-four-hour.ts');
const now=1800000000000;
function fixture(multiplier=1.01){
  const current={status:{error_code:0},data:Array.from({length:125},(_,i)=>({
    id:[1,1027,825,3408][i]??10000+i,symbol:['BTC','ETH','USDT','USDC'][i]??'A'+i,name:'Asset '+i,cmc_rank:i+1,tags:i===2||i===3?['stablecoin']:[],
    quote:[{symbol:'USD',price:100,market_cap:1e12/(i+1),volume_24h:1e7,last_updated:new Date(now).toISOString()}]
  }))};
  const historical={status:{error_code:0,credit_count:3},data:Object.fromEntries(current.data.map((c,i)=>[c.id,{id:c.id,quotes:[{timestamp:new Date(now-14400000).toISOString(),quote:{USD:{price:100/(i===2||i===3?1:multiplier),timestamp:new Date(now-14400000).toISOString()}}}]}]))};
  return {current,historical};
}
function context(multiplier=1.01){const f=fixture(multiplier);return cmcFourHour(cmcConstituents(f.current,now),f.historical,now)}
function primary(){
  const f=fixture();return {...analyze(f.current.data.map(c=>({id:{1:'btc-bitcoin',1027:'eth-ethereum',825:'usdt-tether',3408:'usdc-usdc'}[c.id]??'coinlore:'+c.id,symbol:c.symbol,name:c.name,rank:c.cmc_rank,last_updated:new Date(now).toISOString(),quotes:{USD:{price:100,market_cap:c.quote[0].market_cap,percent_change_15m:c.tags.length?0:1,percent_change_1h:c.tags.length?0:1}}})),['usdt-tether','usdc-usdc'],now),baselineMinutes:15};
}
test('CMC history restores full 4h breadth and directional conditions without local observations',()=>{
  const c=context();assert.equal(c.source,'CoinMarketCap');assert.equal(c.baselineMinutes,240);assert.equal(c.reading.bias,'LONG');
  assert.equal(c.constituents,125);assert.equal(c.stableCount,2);assert.equal(c.rows.length,121);assert.equal(c.reading.breadth.up,121);assert.equal(c.reading.coverage,1);
  assert.ok(Math.abs(c.reading.alt-1)<1e-6);assert.ok(c.reading.usdtDom<0);assert.equal(context(.99).reading.bias,'SHORT');
});
test('flat complete CMC data yields WAIT, not collecting history',()=>{
  const c=context(1);assert.equal(c.reading.bias,'WAIT');assert.equal(c.reading.coverage,1);assert.ok(validFourContext(c,now));assert.equal(c.reading.breadth.flat,121);
});
test('query requests only a bounded ten-minute historical batch for matched IDs',()=>{
  const f=fixture(),q=new URLSearchParams(cmcHistoryQuery(cmcConstituents(f.current,now)));
  assert.equal(q.get('interval'),'5m');assert.equal(Number(q.get('time_end'))-Number(q.get('time_start')),600);assert.equal(q.get('id').split(',').length,125);
  assert.equal(allowedURL('https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/historical?'+q).hostname,'pro-api.coinmarketcap.com');
  assert.ok(allowedURL('https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/listings/latest?limit=125'));
  assert.throws(()=>allowedURL('https://pro-api.coinmarketcap.com/private/account'));
});
test('current quotes reject stale, future, skewed, duplicate IDs and absent stable classification',()=>{
  for(const mutate of [f=>f.data[5].quote[0].last_updated=new Date(now-600001).toISOString(),f=>f.data[5].quote[0].last_updated=new Date(now+30001).toISOString(),f=>f.data[5].quote[0].last_updated=new Date(now-120001).toISOString(),f=>f.data[5].id=1,f=>f.data[2].tags=[],f=>f.status.error_code=1001]){
    const f=fixture();mutate(f.current);assert.throws(()=>cmcConstituents(f.current,now));
  }
});
test('history rejects absent BTC, wrong IDs, empty arrays and mismatched quote times',()=>{
  for(const mutate of [h=>delete h.data[1],h=>h.data[1].id=1027,h=>h.data[1].quotes=[],h=>h.data[1].quotes[0].quote.USD.timestamp=new Date(now-14000000).toISOString(),h=>h.status.error_code=1002]){
    const f=fixture();mutate(f.historical);assert.throws(()=>cmcFourHour(cmcConstituents(f.current,now),f.historical,now));
  }
});
test('coverage and historical window checks refuse missing or displaced comparisons',()=>{
  const f=fixture();for(const id of Object.keys(f.historical.data).slice(-20))delete f.historical.data[id];
  assert.throws(()=>cmcFourHour(cmcConstituents(f.current,now),f.historical,now));
  const wrong=fixture();for(const a of Object.values(wrong.historical.data)){a.quotes[0].timestamp=new Date(now-3600000).toISOString();a.quotes[0].quote.USD.timestamp=a.quotes[0].timestamp}
  assert.throws(()=>cmcFourHour(cmcConstituents(wrong.current,now),wrong.historical,now));
});
test('symbol collisions do not join distinct assets, and tagged stablecoins stay excluded',()=>{
  const f=fixture();f.current.data[10].symbol='USDT';f.current.data[11].tags=['stablecoin'];
  const c=cmcFourHour(cmcConstituents(f.current,now),f.historical,now);
  assert.ok(c.rows.some(r=>r.id==='cmc:10010'));assert.ok(!c.rows.some(r=>r.id==='cmc:10011'));assert.equal(c.stableCount,3);
});
test('independent CMC attachment preserves 15m/1h rules and never places CMC returns on CoinLore prices',()=>{
  const before=primary(),after=attachFourContext(before,context(.99),now);
  assert.equal(after.source,before.source);assert.equal(after.signal,before.signal);assert.deepEqual(after.readings['1h'],before.readings['1h']);assert.deepEqual(after.readings['15m'],before.readings['15m']);
  assert.equal(after.alignedSignal,'WAIT');assert.equal(after.alignment,'CONFLICT');assert.ok(after.rows.every(c=>c.changes['4h']===null));assert.ok(after.fourContext.rows.every(c=>c.changes['1h']===null));
  assert.equal(after.rows[0].price,before.rows[0].price);assert.equal(attachFourContext(before,context(),now).alignedSignal,'LONG BIAS');
});
test('valid 4h observation keeps its own clock when intraday data ages; expiry blocks alignment',()=>{
  const value=attachFourContext(primary(),context(),now),later=now+3600000;
  const stale=safeSnapshot(value,later);assert.equal(stale.signal,'WAIT');assert.ok(validFourContext(stale.fourContext,later));assert.equal(stale.fourContext.at,now);
  const expired=safeSnapshot({...value,at:now+FOUR_CONTEXT_AGE+1},now+FOUR_CONTEXT_AGE+1);assert.equal(expired.fourContext,undefined);assert.equal(expired.alignedSignal,'WAIT');assert.equal(expired.fourStatus,'expired');
});
test('saved CMC context survives reload with source and separate asset rows',async()=>{
  const {restoreDirectionView,serializeDirectionView}=await import('../lib/snapshot-storage.ts');
  const snapshot=attachFourContext(primary(),context(),now);
  const restored=restoreDirectionView(serializeDirectionView({snapshot,context:{},contextErrors:{},horizon:'4h',requireFour:true,search:'',showAll:false}),now);
  assert.equal(restored.snapshot.fourContext.source,'CoinMarketCap');assert.equal(restored.snapshot.fourContext.rows.length,121);assert.equal(restored.horizon,'4h');
});
test('client and server compass safety rules remain identical',()=>{
  assert.equal(readFileSync(new URL('../lib/compass.ts',import.meta.url),'utf8'),readFileSync(new URL('../lib/local-compass/compass.ts',import.meta.url),'utf8'));
});
