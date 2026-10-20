import {sharedOKX,sharedOKXCandles} from '../shared-feeds';
import { env, waitUntil } from 'cloudflare:workers';
import { createFeedCache, deadline } from './feed-cache';
import { upstreamJSON, type RequestGate } from '../upstream';
import { analyze, safeSnapshot, MAX_AGE, FOUR_CONTEXT_AGE, captureFourContext, carryFourContext, validFourContext, type FourHourContext } from './compass';
import { candles, structure, breakout, spotFlow, interest, compareInterest, type Interest } from './context';
import { convertCoinLore,stableIds,type MarketObservation } from './coinlore';
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
export async function market(){
  const value=await cache.get('compass:coinlore:v3',60000,async()=>{
    const first=await upstreamJSON('https://api.coinlore.net/api/tickers/?start=0&limit=100',{timeoutMs:4000,attempts:1});
    // Follow CoinLore's recommended one request per second, even on cold start.
    await new Promise(resolve=>setTimeout(resolve,1100));
    const second=await upstreamJSON('https://api.coinlore.net/api/tickers/?start=100&limit=25',{timeoutMs:4000,attempts:1});
    const stored=await deadline(env.DB!.prepare('SELECT body FROM market_history WHERE time>=? ORDER BY time').bind(Date.now()-21600000).all<{body:string}>(),1500,'Market baseline unavailable');
    const history=stored.results.map(v=>JSON.parse(v.body) as MarketObservation);
    const {tickers,snapshot,baselineMinutes,baselineFourHoursMinutes,historyMinutes}=convertCoinLore([first,second],history);
    await deadline(env.DB!.batch([
      env.DB!.prepare('INSERT OR IGNORE INTO market_history (time,body) VALUES (?,?)').bind(snapshot.at,JSON.stringify(snapshot)),
      env.DB!.prepare('DELETE FROM market_history WHERE time<?').bind(snapshot.at-86400000)
    ]),1500,'Market baseline save timed out');
    const result=analyze(tickers,stableIds);
    result.source='CoinLore';result.baselineMinutes=baselineMinutes;result.baselineFourHoursMinutes=baselineFourHoursMinutes;result.historyMinutes=historyMinutes;
    result.sourceNote='1h return from CoinLore; 15m and 4h from stored same-provider price observations. Local background collection runs every five minutes while this PC is awake. Saved 4h context retains its own timestamp and expires after 75 minutes. Provider response timestamps; individual quote ages are not exposed.';
    result.collection={cadenceMinutes:5,latestObservationAt:snapshot.at,observations:new Set([...history.map(h=>h.at),snapshot.at]).size};
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
// Readback only: an unattended caller can verify durable writes without causing
// another collection. No private data, supplied records or arbitrary SQL exposed.
export async function historyStatus(){
  const now=Date.now();
  const [rows,saved]=await Promise.all([
    deadline(env.DB!.prepare('SELECT COUNT(*) AS count,MIN(time) AS first,MAX(time) AS latest FROM market_history WHERE time>=?').bind(now-86400000).first<{count:number;first:number|null;latest:number|null}>(),1500,'History status timed out'),
    deadline(env.DB!.prepare('SELECT body FROM feed_cache WHERE key=?').bind('compass:four-hour:v1').first<{body:string}>(),1500,'4h status timed out')
  ]);
  let four:FourHourContext|null=null;
  if(saved){try{four=JSON.parse(saved.body)}catch{}}
  return {checkedAt:now,cadenceMinutes:5,retentionHours:24,observations:rows?.count??0,firstObservationAt:rows?.first??null,latestObservationAt:rows?.latest??null,fourHour:{asOf:four?.at??null,baselineMinutes:four?.baselineMinutes??null,usable:validFourContext(four,now),expiresAt:four?four.at+FOUR_CONTEXT_AGE:null},note:'Collection is scheduled every five minutes on this PC. Provider failures or gaps can delay the baseline. Browser reads also refresh observations.'};
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
  return cache.get('spot:sample:v1',180000,async()=>{
    const rows:{symbol:string;at:number;imbalance:number;delta:number;volume:number}[]=[],errors:string[]=[];
    const finish=Date.now()+11000;
    // Bound the entire optional sample; a slow member cannot hold it open.
    for(const symbol of ['SOL','XRP','DOGE','LINK']){
      if(finish-Date.now()<1800){errors.push(`${symbol}: Refresh budget reached`);continue}
      try{
        const raw=await okx(`/api/v5/rubik/stat/taker-volume?ccy=${symbol}&instType=SPOT&period=5m`,180000,Math.min(2500,finish-Date.now()-1000));
        rows.push({symbol,...spotFlow(raw)});
      }catch(e){errors.push(`${symbol}: ${err(e)}`)}
      if(symbol!=='LINK')await new Promise(resolve=>setTimeout(resolve,1500));
    }
    // Ratios can be averaged. Raw base-currency quantities cannot be summed.
    const aligned=rows.length===4&&Math.max(...rows.map(v=>v.at))-Math.min(...rows.map(v=>v.at))<=300000;
    return {at:Date.now(),rows,errors,average:aligned?rows.reduce((s,v)=>s+v.imbalance,0)/4:null,source:'OKX spot • four-alt sample',note:'Equal-weight taker imbalance. Not a market-wide USD CVD series.'};
  });
}
export async function interestContext(){
  return cache.get('oi:aggregate:v2',120000,async()=>{
    const current=interest(await okx('/api/v5/public/open-interest?instType=SWAP',120000));
    const stored=await deadline(env.DB!.prepare('SELECT body FROM observations WHERE time >= ? ORDER BY time').bind(current.at-21600000).all<{body:string}>(),2000,'OI history read timed out');
    const history=stored.results.map(v=>JSON.parse(v.body) as Interest);
    await deadline(env.DB!.batch([
      env.DB!.prepare('INSERT OR IGNORE INTO observations (time,body) VALUES (?,?)').bind(current.at,JSON.stringify(current)),
      env.DB!.prepare('DELETE FROM observations WHERE time < ?').bind(current.at-86400000)
    ]),2000,'OI history write timed out');
    return {at:current.at,total:Object.values(current.values).reduce((s,v)=>s+v,0),count:Object.keys(current.values).length,quarter:compareInterest(current,history,15),hour:compareInterest(current,history,60),fourHour:compareInterest(current,history,240),source:'OKX USDT perpetuals',note:'USD notional; changes include price effects. Local five-minute collection and manual refreshes save observations. Missing intervals stay unavailable.'};
  });
}
