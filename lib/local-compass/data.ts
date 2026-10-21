import {readSetting,writeSetting} from '../local-store';
import {cmcConstituents,cmcHistoryQuery,cmcFourHour} from '../cmc-four-hour';
import {flowSample} from '../flow-sample';
import {sharedOKX,sharedOKXCandles,sharedGate} from '../shared-feeds';
import { env, waitUntil } from 'cloudflare:workers';
import { createFeedCache, deadline } from './feed-cache';
import { upstreamJSON, type RequestGate } from '../upstream';
import { analyze, safeSnapshot, MAX_AGE, FOUR_CONTEXT_AGE, captureFourContext, carryFourContext, attachFourContext, validFourContext, type Compass, type FourHourContext } from './compass';
import { candles, structure, breakout, spotFlow } from './context';
import {aggregateInterest} from './oi-recovery';
import { convertCoinLore,stableIds,type MarketObservation } from './coinlore';
import {collectCoinLorePages} from './coinlore-pages';
const gate:RequestGate={
  reserve:async(key,spacing,maxQueue)=>{
    const now=Date.now();
    const r=await env.DB!.prepare("INSERT INTO feed_cache (key,body,expires) VALUES (?,'{}',?) ON CONFLICT(key) DO UPDATE SET expires=MAX(?,feed_cache.expires)+? WHERE feed_cache.expires<=? RETURNING expires").bind(`rate:v1:${key}`,now+spacing,now,spacing,now+maxQueue).first<{expires:number}>();
    if(r)return r.expires-spacing;
    return {retryAfterMs:60000};
  },
  defer:async(key,until)=>env.DB!.prepare("INSERT INTO feed_cache (key,body,expires) VALUES (?,'{}',?) ON CONFLICT(key) DO UPDATE SET expires=MAX(feed_cache.expires,excluded.expires)").bind(`rate:v1:${key}`,until).run()
};
const cache=createFeedCache({
  read:async key=>env.DB!.prepare('SELECT body,expires FROM feed_cache WHERE key=?').bind(key).first(),
  write:async(key,v)=>env.DB!.prepare('INSERT INTO feed_cache (key,body,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires=excluded.expires').bind(key,v.body,v.expires).run(),
  acquire:async(key,owner)=>!!await env.DB!.prepare('INSERT INTO feed_cache (key,body,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires=excluded.expires WHERE feed_cache.expires<=? RETURNING key').bind(`lease:${key}`,owner,Date.now()+18000,Date.now()).first(),
  release:async(key,owner)=>env.DB!.prepare('DELETE FROM feed_cache WHERE key=? AND body=?').bind(`lease:${key}`,owner).run()
},1500,15000);
export const scope=cache.scope;
const err=(e:unknown)=>e instanceof Error&& !/internal error; reference/.test(e.message)?e.message:'Provider connection temporarily unavailable';
async function coinLoreMarket(){
  const value=await cache.get('compass:coinlore:v5',45000,async()=>{
    const synchronized=await collectCoinLorePages({
      get:query=>upstreamJSON('https://api.coinlore.net/api/tickers/?'+query,{timeoutMs:3500,attempts:1,gate:sharedGate}),
      read:async()=>{const saved=await env.DB!.prepare('SELECT body FROM feed_cache WHERE key=?').bind('compass:coinlore-pages:v1').first<{body:string}>();return saved?JSON.parse(saved.body):null},
      write:async buffer=>env.DB!.prepare('INSERT INTO feed_cache(key,body,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires=excluded.expires').bind('compass:coinlore-pages:v1',JSON.stringify(buffer),Date.now()+1200000).run(),
      diagnose:value=>writeSetting('direction-timestamps',value),
    });
    const [first,second]=synchronized.pages;
    const stored=await deadline(env.DB!.prepare('SELECT body FROM market_history WHERE time>=? ORDER BY time').bind(Date.now()-21600000).all<{body:string}>(),1500,'Market baseline unavailable');
    const history=stored.results.map(v=>JSON.parse(v.body) as MarketObservation);
    const {tickers,snapshot,baselineMinutes,baselineFourHoursMinutes,historyMinutes,baselineRange}=convertCoinLore([first,second],history);
    await deadline(env.DB!.batch([
      env.DB!.prepare('INSERT INTO market_history (time,body) VALUES (?,?) ON CONFLICT(time) DO UPDATE SET body=excluded.body').bind(snapshot.at,JSON.stringify(snapshot)),
      env.DB!.prepare('DELETE FROM market_history WHERE time<?').bind(snapshot.at-86400000)
    ]),1500,'Market baseline save timed out');
    const result=analyze(tickers,stableIds);
    result.source='CoinLore';result.baselineMinutes=baselineMinutes;result.baselineFourHoursMinutes=baselineFourHoursMinutes;result.historyMinutes=historyMinutes;
    result.sourceSync={mode:synchronized.buffered?'buffered':'current',warning:synchronized.warning,checkedAt:synchronized.timing.checkedAt,pageTimes:synchronized.timing.pageTimes as number[],latestPageTimes:synchronized.diagnostics.latest.pageTimes,skewMs:synchronized.timing.skewMs??0};
    result.sourceNote='1h return from CoinLore; 15m and fallback 4h from measured same-provider prices. Standard 100-row pages are synchronized from recent original page versions; the full top-125 basket is retained. Background collection runs every minute while this PC is awake, preserving each page timestamp. Individual quote ages are not exposed. '+(baselineRange?`Matched 15m windows: ${baselineRange[0].toFixed(1)}–${baselineRange[1].toFixed(1)} minutes.`:'15m waits for timestamp-verified history.');
    result.collection={cadenceMinutes:1,latestObservationAt:snapshot.at,observations:new Set([...history.map(h=>h.at),snapshot.at]).size};
    if(baselineMinutes===null)result.reasons.unshift('No matching 15-minute baseline yet. Intraday confirmation waits for measured observations.');
    const currentFour=captureFourContext(result);
    let savedFour:FourHourContext|null=null;
    if(currentFour){
      await deadline(env.DB!.prepare('INSERT INTO feed_cache (key,body,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires=excluded.expires WHERE feed_cache.expires<=excluded.expires').bind('compass:four-hour:v1',JSON.stringify(currentFour),currentFour.at+FOUR_CONTEXT_AGE).run(),1500,'4h context save timed out');
    }else{
      const saved=await deadline(env.DB!.prepare('SELECT body FROM feed_cache WHERE key=?').bind('compass:four-hour:v1').first<{body:string}>(),1500,'4h context read timed out');
      if(saved){try{savedFour=JSON.parse(saved.body)}catch{/* Invalid saved data stays unavailable. */}}
    }
    return carryFourContext(result,savedFour);
  },{staleMs:900000,onStale:(v,e)=>({...v,refreshError:e.message})});
  return safeSnapshot(value);
}
const CMC_FOUR_KEY='compass:cmc-four:v1';
async function cmcContext(){
  return cache.get<FourHourContext & {refreshError?:string}>(CMC_FOUR_KEY,v=>Math.max(60000,v.at+3600000-Date.now()),async()=>{
    const retry=await readSetting<{until:number;message:string}>('cmc-four-retry');
    if(retry&&retry.until>Date.now())throw new Error(retry.message);
    try{
      const settings:any=await fetch((process.env.MARKET_LENS_CONTROL_ORIGIN||'http://127.0.0.1:8788')+'/providers',{signal:AbortSignal.timeout(2500)}).then(r=>r.json());
      if(!settings.cmc?.configured)throw new Error('CMC history needs an API key in Local settings; using collected CoinLore history when available.');
      const get=(url:string)=>upstreamJSON(url,{timeoutMs:5000,attempts:1,gate:sharedGate});
      const current=cmcConstituents(await get('https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/listings/latest?start=1&limit=125&convert=USD'));
      const history=await get('https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/historical?'+cmcHistoryQuery(current));
      const context=cmcFourHour(current,history);
      await writeSetting('cmc-four-retry',{until:0,message:''});
      return context;
    }catch(e){
      // Persist cooldown across requests/restarts, including auth/plan errors.
      const message=err(e);
      await writeSetting('cmc-four-retry',{until:Date.now()+300000,message}).catch(()=>{});
      throw e;
    }
  },{staleMs:900000,onStale:(value,e)=>({...value,refreshError:e.message})});
}
export async function market(){
  const [primary,cmc]=await Promise.allSettled([coinLoreMarket(),cmcContext()]);
  let value:Compass;
  if(primary.status==='fulfilled')value=primary.value;
  else{
    const saved=await env.DB!.prepare('SELECT body FROM local_snapshots WHERE key=?').bind('direction:market').first<{body:string}>();
    if(!saved)throw primary.reason;
    value={...safeSnapshot(JSON.parse(saved.body)),refreshError:err(primary.reason)};
  }
  if(cmc.status==='fulfilled'&&validFourContext(cmc.value)){
    value=attachFourContext(value,cmc.value);
    value.fourError=cmc.value.refreshError;
  }else if(!validFourContext(value.fourContext))value.fourError=cmc.status==='rejected'?err(cmc.reason):'Saved CMC four-hour context expired; waiting for fresh provider history.';
  return safeSnapshot(value);
}
// Readback only: an unattended caller can verify durable writes without causing
// another collection. No private data, supplied records or arbitrary SQL exposed.
export async function historyStatus(){
  const now=Date.now();
  const [rows,saved,cmcSaved]=await Promise.all([
    deadline(env.DB!.prepare('SELECT COUNT(*) AS count,MIN(time) AS first,MAX(time) AS latest FROM market_history WHERE time>=?').bind(now-86400000).first<{count:number;first:number|null;latest:number|null}>(),1500,'History status timed out'),
    deadline(env.DB!.prepare('SELECT body FROM feed_cache WHERE key=?').bind('compass:four-hour:v1').first<{body:string}>(),1500,'4h status timed out'),
    deadline(env.DB!.prepare('SELECT body FROM feed_cache WHERE key=?').bind(CMC_FOUR_KEY).first<{body:string}>(),1500,'CMC 4h status timed out')
  ]);
  let four:FourHourContext|null=null;
  if(saved){try{four=JSON.parse(saved.body)}catch{}}
  if(cmcSaved){try{const v=JSON.parse(cmcSaved.body);if(validFourContext(v,now)||!validFourContext(four,now))four=v}catch{}}
  return {checkedAt:now,cadenceMinutes:1,retentionHours:24,observations:rows?.count??0,firstObservationAt:rows?.first??null,latestObservationAt:rows?.latest??null,fourHour:{source:four?.source??'CoinLore',asOf:four?.at??null,baselineMinutes:four?.baselineMinutes??null,usable:validFourContext(four,now),expiresAt:four?four.at+FOUR_CONTEXT_AGE:null},note:'CoinLore collection runs every minute on this PC. With a configured key, CMC four-hour context uses verified history and is cached for about one hour. Original provider timestamps and the 75-minute expiry are preserved.'};
}
async function okx(path:string,ttl:number|((value:any[])=>number)=120000,timeoutMs=7000):Promise<any[]>{
  return sharedOKX(path,ttl,timeoutMs);
}
export async function btcContext(){
  return cache.get('btc:structure:v2',v=>Math.max(15000,Math.min(300000,v.quarterClose+900000+30000-Date.now())),async()=>{
    const h=candles(await sharedOKXCandles('BTC','1H',80),3600000);
    const q=candles(await sharedOKXCandles('BTC','15m',80),900000);
    return {at:Date.now(),hour:structure(h),quarter:breakout(q),hourClose:h.at(-1)!.t+3600000,quarterClose:q.at(-1)!.t+900000,source:'OKX BTC-USDT perpetual, closed candles',note:'BTC structure only. Altcoin-index breakout/retest is not connected.'};
  });
}
export async function flowContext(){
  return cache.get('spot:sample:v2',v=>v.errors.length?30000:180000,()=>flowSample(async symbol=>{
    const raw=await okx(`/api/v5/rubik/stat/taker-volume?ccy=${symbol}&instType=SPOT&period=5m`,180000,6000);
    return spotFlow(raw);
  }));
}
export async function interestContext(){
  // Live quote transport is shared/cached, while recovered history is read now.
  // A stale aggregate cache must not hide newly repaired comparison windows.
  return aggregateInterest();
}
