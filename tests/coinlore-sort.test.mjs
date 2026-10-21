import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {directionDisplay} from '../lib/direction-display.ts';
import {compareMarketRows} from '../lib/market-sort.ts';
import {dataReadiness} from '../lib/data-readiness.mjs';
registerHooks({resolve(s,c,next){return next(['./coinlore','./feed-cache','./local-fetch'].includes(s)?s+'.ts':s,c)}});
const {mergeCoinLorePages,selectCoinLorePages,collectCoinLorePages,COINLORE_QUERIES}=await import('../lib/local-compass/coinlore-pages.ts');
const {convertCoinLore}=await import('../lib/local-compass/coinlore.ts');
const {upstreamJSON}=await import('../lib/upstream.ts');
const now=Date.UTC(2026,9,21,5),minute=60000;
function page(index,at){return {info:{time:at/1000},data:Array.from({length:100},(_,i)=>{const rank=index*100+i+1;return {id:rank===1?'90':rank===3?'518':'asset'+rank,rank,symbol:'C'+rank,name:'Coin '+rank,price_usd:'10',market_cap_usd:'1000',percent_change_1h:'1',volume24:'100'}})}}
function runner(previous,fetches){let stored=previous,diagnostic,calls=[];return {options:{now:()=>now,read:async()=>stored,write:async b=>{stored=JSON.parse(JSON.stringify(b))},diagnose:async d=>{diagnostic=d},get:async q=>{calls.push(q);const r=fetches.shift();if(r instanceof Error)throw r;return r}},get stored(){return stored},get diagnostic(){return diagnostic},calls}}

test('canonical pages keep all 125 constituents and original provider timestamps',async()=>{
  const r=runner(null,[page(0,now-20000),page(1,now-21000)]),v=await collectCoinLorePages(r.options);
  assert.deepEqual(r.calls,COINLORE_QUERIES);assert.equal(v.buffered,false);
  const converted=convertCoinLore(v.pages,[],now);
  assert.equal(converted.tickers.length,125);assert.equal(converted.snapshot.at,now-21000);
  assert.equal(converted.snapshot.times.asset125,now-21000);assert.equal(converted.snapshot.times['90'],now-20000);
});
test('staggered publications use the newest complete matched pair without relaxing skew',async()=>{
  const previous=mergeCoinLorePages(null,[page(0,now-5*minute),page(1,now-5*minute)],now);
  const r=runner(previous,[page(0,now-4*minute),page(1,now)]),v=await collectCoinLorePages(r.options);
  assert.equal(v.buffered,true);assert.match(v.warning,/saved pages/);assert.equal(v.timing.skewMs,0);
  assert.equal(v.pages[0].info.time*1000,now-5*minute);assert.equal(v.pages[1].info.time*1000,now-5*minute);
  assert.equal(r.diagnostic.latest.skewMs,4*minute);assert.equal(r.calls.length,2);
  assert.equal(r.stored.pages[1][0].info.time*1000,now); // Keep unmatched newer page for the next poll.
  const restarted=runner(JSON.parse(JSON.stringify(r.stored)),[page(0,now),page(1,now)]);
  const next=await collectCoinLorePages(restarted.options);assert.equal(next.buffered,false);assert.equal(next.timing.skewMs,0);
});
test('incomplete refresh durably retains the successful page and cannot fake a basket',async()=>{
  const r=runner(null,[page(0,now),new Error('offline')]);
  await assert.rejects(collectCoinLorePages(r.options),/not synchronized/);
  assert.equal(r.stored.pages[0].length,1);assert.equal(r.stored.pages[1].length,0);assert.equal(r.calls.length,2);
  const next=runner(r.stored,[new Error('offline'),page(1,now)]),v=await collectCoinLorePages(next.options);
  assert.equal(v.buffered,true);assert.equal(v.timing.state,'fresh');assert.equal(v.pages.length,2);
});
test('a malformed new page cannot disguise saved data by reusing its timestamp',async()=>{
  const previous=mergeCoinLorePages(null,[page(0,now),page(1,now)],now);
  const malformed=page(0,now);malformed.data=[];
  const r=runner(previous,[malformed,page(1,now)]),v=await collectCoinLorePages(r.options);
  assert.equal(v.buffered,true);assert.match(v.warning,/saved pages/);assert.equal(v.pages[0].data.length,100);
});
test('one bounded retry repairs the lagging page and persistent mismatch fails safely',async()=>{
  for(const repaired of [true,false]){
    const r=runner(null,[page(0,now-4*minute),page(1,now),page(0,repaired?now:now-4*minute)]);
    if(repaired){const v=await collectCoinLorePages(r.options);assert.equal(v.timing.skewMs,0)}
    else await assert.rejects(collectCoinLorePages(r.options),/not synchronized/);
    assert.deepEqual(r.calls,[COINLORE_QUERIES[0],COINLORE_QUERIES[1],COINLORE_QUERIES[0]]);
  }
});
test('future, expired, malformed, duplicate and incomplete data cannot pass matching',()=>{
  assert.equal(selectCoinLorePages(mergeCoinLorePages(null,[page(0,now-601000),page(1,now-601000)],now),now),null);
  for(const alter of [p=>{p.info.time=(now+31000)/1000},p=>{p.info.time=(now-1200001)/1000},p=>p.data.pop(),p=>{p.data[0].price_usd='bad'},p=>{p.data[1].id=p.data[0].id},p=>{p.data[5].rank=99}]){
    const p=page(0,now);alter(p);assert.equal(mergeCoinLorePages(null,[p,page(1,now)],now).pages[0].length,0);
  }
  const second=page(1,now);second.data[0].id='90';assert.equal(selectCoinLorePages(mergeCoinLorePages(null,[page(0,now),second],now),now),null);
  assert.equal(selectCoinLorePages(mergeCoinLorePages(null,[page(0,now-120001),page(1,now)],now),now),null);
});
test('retained page history is bounded and expired versions are evicted',()=>{
  let buffer=null;
  for(let i=0;i<60;i++)buffer=mergeCoinLorePages(buffer,[page(0,now-i*10000),page(1,now-i*10000)],now);
  assert.deepEqual(buffer.pages.map(p=>p.length),[24,24]);
  assert.deepEqual(mergeCoinLorePages(buffer,[],now+1200001).pages,[[],[]]);
});
const ready={coverage:1,breadth:{total:100,available:100},alt:0,btc:0,btcDom:0,usdtDom:0,bias:'WAIT'};
const snapshot={at:now,stale:false,signal:'WAIT',readings:{'15m':ready,'1h':ready},fourContext:{at:now,reading:ready}};
test('saved fallback and buffered pages never claim a successful fresh refresh',()=>{
  for(const data of [{...snapshot,refreshError:'Provider mismatch'},{...snapshot,sourceSync:{warning:'Matched saved pages'}}]){
    const d=directionDisplay(data);assert.equal(d.current,false);assert.equal(d.cached,true);assert.match(d.connection,/Saved data/);assert.match(d.copy,/saved data/);assert.equal(dataReadiness('market',data,now).ready,false);
  }
  const context=directionDisplay(snapshot,{supportingPending:true});assert.equal(context.connection,'Market updated · context pending');assert.equal(context.current,false);assert.equal(context.state,'WAIT');
  const pending=directionDisplay(snapshot,{error:'4h comparison pending'});assert.equal(pending.current,false);assert.equal(pending.connection,'Refresh incomplete');assert.equal(pending.cached,false);
});
test('a complete WAIT is distinct from loading, expired data, saved view and absent history',()=>{
  const live=directionDisplay(snapshot);assert.equal(live.current,true);assert.equal(live.state,'WAIT');assert.match(live.copy,/market conditions/);
  const loading=directionDisplay(snapshot,{loading:true});assert.equal(loading.current,false);assert.equal(loading.connection,'Refreshing…');
  const stale=directionDisplay({...snapshot,stale:true});assert.equal(stale.state,'DATA UNAVAILABLE');assert.equal(stale.current,false);
  const saved=directionDisplay(snapshot,{savedView:true});assert.equal(saved.current,false);assert.equal(saved.connection,'Saved snapshot');
  const collecting=directionDisplay({...snapshot,readings:{'1h':ready}});assert.equal(collecting.state,'COLLECTING HISTORY');
  assert.equal(directionDisplay(snapshot,{requireFour:true,fourReady:false}).state,'COLLECTING 4H');
});
const row=(symbol,oiChange,side='neutral',volume=100)=>({symbol,volume,change:0,analysis:oiChange==null?undefined:{oiChange},signal:{side,score:3}});
test('OI sort orders percentage increases correctly, then cached and missing observations',()=>{
  const rows=[row('MISSING',null),row('NEGATIVE',-2),row('BEST',8),row('CACHED',99,'stale'),row('POSITIVE',2),row('ZERO',0)];
  const original=JSON.stringify(rows);
  assert.deepEqual([...rows].sort((a,b)=>compareMarketRows(a,b,'oi')).map(r=>r.symbol),['BEST','POSITIVE','ZERO','NEGATIVE','CACHED','MISSING']);
  assert.deepEqual([...rows].sort((a,b)=>compareMarketRows(a,b,'oi-asc')).map(r=>r.symbol),['NEGATIVE','ZERO','POSITIVE','BEST','CACHED','MISSING']);
  assert.equal(JSON.stringify(rows),original);
  assert.deepEqual([row('B',1),row('A',1),row('LARGE',1,'neutral',200)].sort((a,b)=>compareMarketRows(a,b,'oi')).map(r=>r.symbol),['LARGE','A','B']);
});
test('CoinLore requests share a host-wide limiter across different pages',async()=>{
  const reservations=[];
  const gate={reserve:async(...v)=>{reservations.push(v);return Date.now()},defer:async()=>{}};
  for(const query of COINLORE_QUERIES)await upstreamJSON('https://api.coinlore.net/api/tickers/?'+query,{gate,attempts:1,fetcher:async()=>Response.json({data:[]})});
  assert.equal(reservations.length,2);assert.equal(reservations[0][0],reservations[1][0]);assert.equal(reservations[0][1],1100);
});
