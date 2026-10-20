import { env } from 'cloudflare:workers';
import {sharedOKX,sharedOKXCandles} from './shared-feeds';
import {reusableAnalysis} from './analysis-reuse';
import { analyze } from './engine';
import { normalizeOKX } from './okx';
import { createFeedCache, deadline } from './feed-cache';
import { upstreamJSON, type UpstreamOptions, type RequestGate } from './upstream';
import { windowCacheMs,unverifiedWindowCacheMs } from './window-cache';
import { normalizeOKXMarket } from './market-data';
type Venue='Binance'|'OKX';
// OKX's dedicated REST host, recommended in its 2026-05-20 API changelog.
// Use one fixed official host; never rotate hosts or IPs on rate limits.
const BASE='https://fapi.binance.com', OKX='https://openapi.okx.com';
// Separate reserved keys use the existing cache table as an atomic slot clock.
// No new schema or destructive migration; these rows never hold market data.
const rateGate:RequestGate={
  reserve:async(key,spacing,maxQueue)=>{
    if(!env.DB)throw new Error('No shared rate gate');
    const now=Date.now();
    const row=await env.DB.prepare("INSERT INTO feed_cache (key,body,expires) VALUES (?,'{}',?) ON CONFLICT(key) DO UPDATE SET expires=MAX(?,feed_cache.expires)+? WHERE feed_cache.expires<=? RETURNING expires")
      .bind(`rate:v1:${key}`,now+spacing,now,spacing,now+maxQueue).first<{expires:number}>();
    if(row)return row.expires-spacing;
    // Preserve a shared provider cooldown instead of telling each visitor to
    // retry every five seconds throughout a longer exchange pause.
    const queued=await env.DB.prepare('SELECT expires FROM feed_cache WHERE key=?').bind(`rate:v1:${key}`).first<{expires:number}>();
    return queued?{retryAfterMs:queued.expires-now}:null;
  },
  defer:async(key,until)=>env.DB?.prepare("INSERT INTO feed_cache (key,body,expires) VALUES (?,'{}',?) ON CONFLICT(key) DO UPDATE SET expires=MAX(feed_cache.expires,excluded.expires)")
    .bind(`rate:v1:${key}`,until).run(),
};
const json=(url:string,options:UpstreamOptions={})=>upstreamJSON(url,{...options,gate:rateGate});
const feedCache=createFeedCache({
  read:async key=>env.DB?env.DB.prepare('SELECT body, expires FROM feed_cache WHERE key = ?').bind(key).first<{body:string;expires:number}>():null,
  write:async(key,box)=>env.DB?env.DB.prepare('INSERT INTO feed_cache (key,body,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires=excluded.expires').bind(key,box.body,box.expires).run():undefined,
  acquire:async(key,owner)=>{
    if(!env.DB)return true;
    const now=Date.now();
    const row=await env.DB.prepare("INSERT INTO feed_cache (key,body,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires=excluded.expires WHERE feed_cache.expires<=? RETURNING key")
      .bind(`lease:v1:${key}`,owner,now+18000,now).first();
    return !!row;
  },
  release:async(key,owner)=>env.DB?.prepare('DELETE FROM feed_cache WHERE key=? AND body=?').bind(`lease:v1:${key}`,owner).run(),
});
const cache=feedCache.get;
export const feedScope=feedCache.scope;
const staleMarket={staleMs:90000,onStale:(value:any,error:Error)=>({...value,stale:true,refreshError:error.message})};
let forcedFallback:{until:number;reason:string}|undefined;
async function okx(path:string){return sharedOKX(path,path.includes('/instruments?')?3600000:30000)}
// Preserve successful components if a different component is briefly unavailable.
const okxRecent=(path:string)=>cache(`okx:recent:v1:${path}`,30000,()=>okx(path));
async function chooseVenue(){return cache('venue:v4',900000,async()=>{
  try{await json(BASE+'/fapi/v1/time',{timeoutMs:1800,attempts:1});return {exchange:'Binance' as Venue,fallbackReason:''}}
  catch(e){return {exchange:'OKX' as Venue,fallbackReason:`Binance unavailable: ${(e as Error).message}`}}
})}
const binanceInfo=()=>cache<any>('exchange:v4',3600000,()=>json(BASE+'/fapi/v1/exchangeInfo'));
const binanceMarks=()=>cache<any[]>('binance:marks:v4',25000,()=>json(BASE+'/fapi/v1/premiumIndex'));
const binanceIntervals=()=>cache<any[]>('funding-intervals:v4',3600000,()=>json(BASE+'/fapi/v1/fundingInfo'));
const okxInfo=()=>cache<any[]>('okx:instruments:v4',3600000,()=>okx('/api/v5/public/instruments?instType=SWAP'));
const okxFunding=()=>cache<any[]>('okx:funding:v4',30000,()=>okx('/api/v5/public/funding-rate?instId=ANY'));
async function binanceMarket(){return cache('market:Binance:v4',25000,async()=>{
  const [info,tickers,marks,fundingInfo]=await Promise.all([
    binanceInfo(),json(BASE+'/fapi/v1/ticker/24hr'),binanceMarks(),binanceIntervals(),
  ]);
  if(!Array.isArray(tickers)||!Array.isArray(marks)||!Array.isArray(info.symbols))throw new Error('Unexpected market feed response');
  const markMap=new Map(marks.map((x:any)=>[x.symbol,x])), tickMap=new Map(tickers.map((x:any)=>[x.symbol,x]));
  const fundingMap=new Map(fundingInfo.map((x:any)=>[x.symbol,+x.fundingIntervalHours]));
  const rows=info.symbols.filter((s:any)=>s.status==='TRADING'&&s.contractType==='PERPETUAL'&&s.quoteAsset==='USDT').map((s:any)=>{
    const t:any=tickMap.get(s.symbol),m:any=markMap.get(s.symbol);if(!t||!m||Date.now()-m.time>180000)return null;
    return {symbol:s.symbol,base:s.baseAsset,exchange:'Binance',instrument:s.symbol,price:+m.markPrice,change:+t.priceChangePercent,volume:+t.quoteVolume,funding:+m.lastFundingRate,fundingHours:fundingMap.get(s.symbol)||8,nextFunding:+m.nextFundingTime,updated:+m.time};
  }).filter(Boolean).sort((a:any,b:any)=>b.volume-a.volume);
  return {rows,updated:Date.now(),exchange:'Binance',source:'Binance USDⓈ-M',fallbackReason:''};
},staleMarket)}
async function okxMarket(){return cache('market:OKX:v4',25000,async()=>{
  const [info,tickers,marks,funding]=await Promise.all([
    okxInfo(),okx('/api/v5/market/tickers?instType=SWAP'),okx('/api/v5/public/mark-price?instType=SWAP'),okxFunding(),
  ]);
  return normalizeOKXMarket(info,tickers,marks,funding);
},staleMarket)}
export async function market(){
  if(forcedFallback&&forcedFallback.until>Date.now())return {...await okxMarket(),fallbackReason:forcedFallback.reason};
  const choice=await chooseVenue();
  if(choice.exchange==='OKX')return {...await okxMarket(),fallbackReason:choice.fallbackReason};
  try{return await binanceMarket()}catch(e){
    forcedFallback={until:Date.now()+900000,reason:`Binance unavailable: ${(e as Error).message}`};
    return {...await okxMarket(),fallbackReason:forcedFallback.reason};
  }
}
let globalProvider='CoinPaprika';
export async function globalMarket(){return cache('global:v4',300000,async()=>{
  let btc:number,usdt:number,time:number,marketCap:number,source:string;
  async function load(provider:string){
    if(provider==='CoinGecko'){
      const g=(await json('https://api.coingecko.com/api/v3/global',{timeoutMs:3500,attempts:1})).data;
      return {btc:+g?.market_cap_percentage?.btc,usdt:+g?.market_cap_percentage?.usdt,time:+g?.updated_at*1000,marketCap:+g.total_market_cap?.usd,source:provider};
    }
    const [g,t]=await Promise.all([json('https://api.coinpaprika.com/v1/global',{timeoutMs:3500}),json('https://api.coinpaprika.com/v1/tickers/usdt-tether',{timeoutMs:3500})]);
    return {btc:+g.bitcoin_dominance_percentage,usdt:+t.quotes?.USD?.market_cap/+g.market_cap_usd*100,time:Math.min(+g.last_updated*1000,Date.parse(t.last_updated)),marketCap:+g.market_cap_usd,source:provider};
  }
  const checked=async(provider:string)=>{
    const d=await load(provider);
    if(![d.btc,d.usdt,d.time,d.marketCap].every(Number.isFinite)||d.marketCap<=0||d.btc<=0||d.usdt<=0||d.btc>100||d.usdt>100||Date.now()-d.time>1800000)throw new Error(`${provider} dominance data is invalid or stale`);
    return d;
  };
  let data;
  try{data=await checked(globalProvider)}catch{data=await checked(globalProvider==='CoinPaprika'?'CoinGecko':'CoinPaprika')}
  ({btc,usdt,time,marketCap,source}=data);globalProvider=source;
  if(![btc,usdt,time,marketCap].every(Number.isFinite)||!(marketCap>0)||btc<=0||usdt<=0||btc>100||usdt>100)throw new Error('Dominance fields are unavailable');
  if(Date.now()-time>1800000)throw new Error(`${source} dominance data is stale`);
  let history:{time:number;btc:number;usdt:number}[]=[],historyError:string|undefined;
  if(env.DB){try{
    await deadline(env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO dominance (time,btc,usdt,source) VALUES (?,?,?,?)').bind(time,btc,usdt,source),
      env.DB.prepare('DELETE FROM dominance WHERE time < ?').bind(time-172800000),
    ]),1000,'Dominance history write timed out');
    history=(await deadline(env.DB.prepare('SELECT time,btc,usdt FROM dominance WHERE source = ? AND time >= ? ORDER BY time').bind(source,time-7200000).all<{time:number;btc:number;usdt:number}>(),1000,'Dominance history read timed out')).results;
  }catch{historyError='Dominance history is temporarily unavailable; full setups are withheld'}}
  const baseline=[...history].reverse().find(x=>x.time<=time-3300000&&x.time>=time-4500000);
  return {btc,usdt,updated:time,btcChange:baseline?btc-baseline.btc:null,usdtChange:baseline?usdt-baseline.usdt:null,baseline:baseline?.time??null,history,marketCap,source,historyError};
})}
export async function reuseSavedScan(symbol:string,interval:string,exchange:Venue){
  const saved=await env.DB!.prepare('SELECT body,error FROM local_analyses WHERE exchange=? AND symbol=? AND interval=?').bind(exchange,symbol,interval).first<{body:string|null;error:string|null}>();
  if(saved?.body&&!saved.error){
    try{
      const quotes:any=await market();
      const quote=!quotes.stale&&quotes.exchange===exchange?quotes.rows.find((r:any)=>r.symbol===symbol):undefined;
      const reuse=reusableAnalysis(JSON.parse(saved.body),quote,exchange,interval);
      if(reuse)return reuse;
    }catch{/* An unavailable bulk quote does not prevent a direct venue scan. */}
  }
  return null;
}
export async function scan(symbol:string,interval:string,exchange:Venue){return cache(`scan:v5:${exchange}:${symbol}:${interval}`,(v:any)=>Math.min(60000,windowCacheMs(interval,v.closedAt)),async()=>{
  const reuse=await reuseSavedScan(symbol,interval,exchange);
  if(reuse)return reuse;
  let k:any[],oi:any[],dataNote:string|undefined,funding:number,instrument:string;
  if(exchange==='OKX'){
    instrument=symbol.slice(0,-4)+'-USDT-SWAP';
    const query=`instId=${encodeURIComponent(instrument)}`,period=interval==='1h'?'1H':'15m';
    const [info,rates,n]=await Promise.all([
      okxInfo(),okxFunding(),
      cache(`window:v1:OKX:${symbol}:${interval}`,(v:ReturnType<typeof normalizeOKX>)=>windowCacheMs(interval,v.raw.at(-1)?.[6]??0),async()=>{
        // Candles are the dependency for both other series. Do not spend their
        // quotas if the candle endpoint is already cooling down.
        const bars=await sharedOKXCandles(symbol.slice(0,-4),period,99);
        const [flow,interest]=await Promise.all([
          okxRecent(`/api/v5/rubik/stat/taker-volume-contract?${query}&period=${period}&unit=2&limit=100`),
          okxRecent(`/api/v5/rubik/stat/contracts/open-interest-history?${query}&period=${period}&limit=8`),
        ]);
        const window=normalizeOKX(bars,flow,interest,interval);
        // Validate the entire window before keeping it for the rest of this bar.
        analyze(symbol,interval,window.raw,window.oi,0);
        return window;
      }),
    ]);
    const contract=info.find((s:any)=>s.instId===instrument&&s.state==='live'&&s.instCategory==='1'&&s.settleCcy==='USDT'&&s.ctType==='linear');
    const f=rates.find((s:any)=>s.instId===instrument),hours=f?((+f.fundingTime-+f.prevFundingTime)/3600000||(+f.nextFundingTime-+f.fundingTime)/3600000):0;
    if(!contract)throw new Error('Contract is not an active OKX USDT crypto perpetual');
    if(!f||!(hours>0)||f.fundingRate===''||Date.now()-Number(f.ts)>180000)throw new Error('Waiting for fresh OKX funding');
    funding=Number(f.fundingRate)*8/hours;
    k=n.raw;oi=n.oi;dataNote=n.dataNote;
  }else{
    const querySymbol=encodeURIComponent(symbol);
    const [info,marks,intervals,window]=await Promise.all([binanceInfo(),binanceMarks(),binanceIntervals(),
      cache(`window:v2:Binance:${symbol}:${interval}`,(v:any)=>windowCacheMs(interval,v.closedAt),async()=>{
        const [bars,interest]=await Promise.all([json(`${BASE}/fapi/v1/klines?symbol=${querySymbol}&interval=${interval}&limit=99`),json(`${BASE}/futures/data/openInterestHist?symbol=${querySymbol}&period=${interval}&limit=8`)]);
        const validated=analyze(symbol,interval,bars,interest,0);
        return {bars,interest,closedAt:validated.closedAt};
      })]);
    const {bars,interest}=window;
    const contract=info.symbols.find((s:any)=>s.symbol===symbol&&s.status==='TRADING'&&s.contractType==='PERPETUAL'&&s.quoteAsset==='USDT'),m=marks.find((r:any)=>r.symbol===symbol);
    if(!contract||!m||Date.now()-Number(m.time)>180000)throw new Error('Contract or fresh Binance funding unavailable');
    funding=Number(m.lastFundingRate)*8/(Number(intervals.find((x:any)=>x.symbol===symbol)?.fundingIntervalHours)||8);
    instrument=symbol;k=bars;oi=interest;
  }
  return {...analyze(symbol,interval,k,oi,funding),exchange,instrument,dataNote};
})}

// Public OKX statistics for the browser's candle analysis. Never accept browser
// candles into the shared cache: each browser validates and analyzes them locally.
export async function okxContext(symbol:string,interval:string){
  const instrument=symbol.slice(0,-4)+'-USDT-SWAP';
  const query=`instId=${encodeURIComponent(instrument)}`,period=interval==='1h'?'1H':'15m';
  const step=interval==='1h'?3600000:900000;
  const [info,rates,series]=await Promise.all([
    okxInfo(),okxFunding(),
    cache(`context:v2:OKX:${symbol}:${interval}`,(v:{flow:any[];interest:any[]})=>{
      const last=(items:any[])=>Math.max(0,...items.filter(x=>+x[0]+step<=Date.now()).map(x=>+x[0]+step-1));
      // These statistics have not yet been compared with browser candles.
      // Recheck partial/revised exchange publications within 30s, not next hour.
      return unverifiedWindowCacheMs(interval,Math.min(last(v.flow),last(v.interest)));
    },async()=>{
      const [flow,interest]=await Promise.all([
        okxRecent(`/api/v5/rubik/stat/taker-volume-contract?${query}&period=${period}&unit=2&limit=100`),
        okxRecent(`/api/v5/rubik/stat/contracts/open-interest-history?${query}&period=${period}&limit=8`),
      ]);
      if(flow.length<35||interest.length<5)throw new Error('Insufficient OKX statistics coverage');
      return {flow,interest};
    }),
  ]);
  const contract=info.find((s:any)=>s.instId===instrument&&s.state==='live'&&s.instCategory==='1'&&s.settleCcy==='USDT'&&s.ctType==='linear');
  const f=rates.find((s:any)=>s.instId===instrument),hours=f?((+f.fundingTime-+f.prevFundingTime)/3600000||(+f.nextFundingTime-+f.fundingTime)/3600000):0;
  if(!contract)throw new Error('Contract is not an active OKX USDT crypto perpetual');
  if(!f||!(hours>0)||f.fundingRate===''||Date.now()-Number(f.ts)>180000)throw new Error('Waiting for fresh OKX funding');
  return {...series,symbol,interval,exchange:'OKX',instrument,funding:Number(f.fundingRate)*8/hours,fundingAt:+f.ts};
}

