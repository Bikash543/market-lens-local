import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {nextCollectionAt} from '../local/cadence.mjs';
import {convertCoinLore,stableIds} from '../lib/local-compass/coinlore.ts';
import {analyze,captureFourContext,carryFourContext,MAX_AGE} from '../lib/compass.ts';
registerHooks({resolve(specifier,context,next){return next(specifier==='./compass'?'./compass.ts':specifier,context)}});
const {restoreSnapshot,restoreDirectionView,serializeDirectionView}=await import('../lib/snapshot-storage.ts');
const now=1800000000000,step=300000;
const rows=Array.from({length:125},(_,i)=>({
  id:['90','80','518','33285'][i]??String(200000+i),symbol:['BTC','ETH','USDT','USDC'][i]??'ALT'+i,name:'Asset '+i,rank:i+1,
  price_usd:String(i<2?80000/(i+1):i<4?1:100),market_cap_usd:String(1e12/(i+1)),volume24:'1000000',percent_change_1h:'0.5'
}));
const pages=at=>[{info:{time:at/1000},data:rows.slice(0,100)},{info:{time:at/1000},data:rows.slice(100)}];
const observation=at=>({at,version:2,times:Object.fromEntries(rows.map(r=>[r.id,at])),prices:Object.fromEntries(rows.map((r,i)=>[r.id,Number(r.price_usd)/(i===2||i===3?1:1.01)]))});
function fullSnapshot(){
  const converted=convertCoinLore(pages(now),[observation(now-900000),observation(now-14400000)],now);
  return {...analyze(converted.tickers,stableIds,now),baselineFourHoursMinutes:converted.baselineFourHoursMinutes,baselineMinutes:15};
}
test('direction view survives navigation and a restart with timeframe, context and alignment preference',()=>{
  const state={snapshot:fullSnapshot(),context:{btc:{at:now,hour:'Higher highs / higher lows',hourClose:now,quarterClose:now}},contextErrors:{flow:'One member unavailable'},horizon:'4h',requireFour:true,search:'SOL',showAll:true};
  const restored=restoreDirectionView(serializeDirectionView(state),now);
  assert.equal(restored.horizon,'4h');assert.equal(restored.requireFour,true);assert.equal(restored.search,'SOL');assert.equal(restored.showAll,true);
  assert.deepEqual(restored.context,state.context);assert.deepEqual(restored.contextErrors,state.contextErrors);
  assert.equal(restored.snapshot.at,now);assert.equal(restored.snapshot.btcPrice,state.snapshot.btcPrice);
});
test('expired saved view retains observations without turning them into a fresh bias',()=>{
  const value=restoreSnapshot(JSON.stringify({version:2,snapshot:fullSnapshot()}),now+MAX_AGE+1);
  assert.ok(value);assert.equal(value.stale,true);assert.equal(value.signal,'WAIT');assert.equal(value.at,now);assert.equal(value.btcPrice,80000);
  assert.equal(restoreSnapshot(JSON.stringify({version:2,snapshot:fullSnapshot()}),now+86400001),null);
});
test('corrupt, oversized, future and incomplete saved snapshots cannot be restored',()=>{
  assert.equal(restoreSnapshot('broken',now),null);
  assert.equal(restoreDirectionView('x'.repeat(500001),now),null);
  assert.equal(restoreSnapshot(JSON.stringify({version:2,snapshot:{...fullSnapshot(),at:now+30001}}),now),null);
  assert.equal(restoreSnapshot(JSON.stringify({version:2,snapshot:{...fullSnapshot(),readings:{}}}),now),null);
});
test('four-hour bias uses durable same-provider observations and never invents a warm-up baseline',()=>{
  const history=Array.from({length:49},(_,i)=>observation(now-14400000+i*step));
  const warm=convertCoinLore(pages(now),history.filter(s=>now-s.at<=225*60000),now);
  assert.equal(warm.baselineFourHoursMinutes,null);
  assert.equal(warm.tickers[4].quotes.USD.percent_change_4h,null);
  const restoredHistory=JSON.parse(JSON.stringify(history));
  const ready=convertCoinLore(pages(now),restoredHistory,now);
  assert.equal(ready.baselineFourHoursMinutes,240);assert.equal(ready.baselineMinutes,15);
  assert.ok(Math.abs(ready.tickers[4].quotes.USD.percent_change_4h-1)<1e-9);
  const result={...analyze(ready.tickers,stableIds,now),baselineFourHoursMinutes:ready.baselineFourHoursMinutes};
  const context=captureFourContext(result,now);
  assert.ok(context);assert.equal(context.baselineMinutes,240);
  const next={...result,at:now+step,baselineFourHoursMinutes:null};
  const carried=carryFourContext(next,JSON.parse(JSON.stringify(context)),now+step);
  assert.equal(carried.fourContext.at,now);assert.equal(carried.fourStatus,'saved');
});
test('primary collection cadence stays fixed despite slow calls and skips slots after sleep',()=>{
  assert.equal(nextCollectionAt(now,step,now+42000),now+step);
  assert.equal(nextCollectionAt(now,step,now+step),now+2*step);
  assert.equal(nextCollectionAt(now,step,now+7200000),now+7500000);
  const starts=[now];for(let i=0;i<48;i++)starts.push(nextCollectionAt(starts.at(-1),step,starts.at(-1)+42000));
  assert.equal(starts.at(-1)-starts[0],14400000);
});
