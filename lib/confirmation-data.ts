import {env} from 'cloudflare:workers';
import {market as localBroadMarket,scope as broadScope} from './local-compass/data';
import {createFeedCache,deadline} from './feed-cache';
import {upstreamJSON,type RequestGate} from './upstream';
import {bars,evaluate,Q,H,type Inputs,type Side} from './confirmation';
import {confirmationMarkets} from './confirmation-symbols';
import {applyDirectInputs,type DirectBundle} from './confirmation-direct';
const ORIGIN='https://openapi.okx.com';
const gate:RequestGate={
  reserve:async(key,spacing,maxQueue)=>{
    const now=Date.now();
    const result=await env.DB!.prepare("INSERT INTO feed_cache (key,body,expires) VALUES (?,'{}',?) ON CONFLICT(key) DO UPDATE SET expires=MAX(?,feed_cache.expires)+? WHERE feed_cache.expires<=? RETURNING expires").bind(`rate:v1:${key}`,now+spacing,now,spacing,now+maxQueue).first<{expires:number}>();
    if(result)return result.expires-spacing;
    const saved=await env.DB!.prepare('SELECT expires FROM feed_cache WHERE key=?').bind(`rate:v1:${key}`).first<{expires:number}>();
    return saved?{retryAfterMs:saved.expires-now}:null;
  },
  defer:async(key,until)=>env.DB!.prepare("INSERT INTO feed_cache (key,body,expires) VALUES (?,'{}',?) ON CONFLICT(key) DO UPDATE SET expires=MAX(feed_cache.expires,excluded.expires)").bind(`rate:v1:${key}`,until).run()
};
const cache=createFeedCache({
  read:async key=>env.DB!.prepare('SELECT body,expires FROM feed_cache WHERE key=?').bind(key).first(),
  write:async(key,v)=>env.DB!.prepare('INSERT INTO feed_cache (key,body,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires=excluded.expires').bind(key,v.body,v.expires).run(),
  acquire:async(key,owner)=>!!await env.DB!.prepare('INSERT INTO feed_cache (key,body,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires=excluded.expires WHERE feed_cache.expires<=? RETURNING key').bind(`lease:${key}`,owner,Date.now()+18000,Date.now()).first(),
  release:async(key,owner)=>env.DB!.prepare('DELETE FROM feed_cache WHERE key=? AND body=?').bind(`lease:${key}`,owner).run()
},1200);
export const scope=cache.scope;
async function get(path:string,ttl:number|((value:any[])=>number)=45000,timeoutMs=7500):Promise<any[]>{
  return cache.get(`confirmation:v1:${path}`,ttl,async()=>{
    const raw=await upstreamJSON(ORIGIN+path,{gate,timeoutMs,attempts:1});
    if(!Array.isArray(raw.data))throw new Error('Exchange returned an invalid series');
    return raw.data;
  },{staleMs:90000,onStale:value=>value});
}
async function closedCandles(symbol:string,bar:'15m'|'1H',step:number){
  const ttl=(rows:any[])=>{
    const last=Math.max(0,...rows.filter(v=>v[8]==='1').map(v=>+v[0]+step));
    // Reuse the closed series until the next candle can be published. Late
    // publication gets a short retry rather than a full-interval stale cache.
    return Math.max(15000,Math.min(step,last+step+5000-Date.now()));
  };
  const query=`?instId=${symbol}-USDT-SWAP&bar=${bar}&limit=100`;
  try{return bars(await get('/api/v5/market/candles'+query,ttl,5000),step)}
  catch{
    // Same exchange and instrument, using its documented history endpoint.
    // It has its own paced quota and cooldown; no host/IP rotation or retry loop.
    return bars(await get('/api/v5/market/history-candles'+query,ttl,5000),step);
  }
}
const message=(e:unknown)=>(e instanceof Error?e.message:'Provider unavailable').replace(/automatic retry scheduled/gi,'click Analyse it after the cooldown to retry');
async function broadMarket(){return broadScope(()=>localBroadMarket())}
export async function directory(){
  const rows=confirmationMarkets(await get('/api/v5/public/instruments?instType=SWAP',3600000));
  if(!rows.length)throw new Error('No active crypto perpetuals returned by the exchange');
  return rows;
}
export async function analyze(symbol:string,requested:'AUTO'|Side,direct?:DirectBundle){
  const input:Inputs={symbol,q:null,btcQ:null,btcH:null,spot:null,oi:null,funding:null,ticker:null,market:null,errors:[]};
  if(direct)applyDirectInputs(input,direct);
  const take=async(name:string,fn:()=>Promise<any>,set:(v:any)=>void)=>{try{set(await fn())}catch(e){input.errors.push(`${name}: ${message(e)}`)}};
  const candleTask=(async()=>{
    if(direct)return;
    await take('Coin candles',()=>closedCandles(symbol,'15m',Q),v=>input.q=v);
    if(symbol==='BTC')input.btcQ=input.q;
    else await take('BTC 15m',()=>closedCandles('BTC','15m',Q),v=>input.btcQ=v);
    await take('BTC 1h',()=>closedCandles('BTC','1H',H),v=>input.btcH=v);
  })();
  await Promise.all([
    candleTask,
    take('Spot CVD',()=>get(`/api/v5/rubik/stat/taker-volume?ccy=${symbol}&instType=SPOT&period=5m`,60000),v=>input.spot=v),
    take('Open interest',()=>get(`/api/v5/rubik/stat/contracts/open-interest-history?instId=${symbol}-USDT-SWAP&period=5m&limit=30`,60000),v=>input.oi=v),
    take('Funding',()=>get(`/api/v5/public/funding-rate?instId=${symbol}-USDT-SWAP`,60000),v=>input.funding=v[0]??null),
    // Reuse one public ticker snapshot across requests; evaluate only the selected
    // instrument. The individual-ticker endpoint is rate limited on this host.
    direct?Promise.resolve():take('Quote',()=>get('/api/v5/market/tickers?instType=SWAP',30000),v=>input.ticker=v.find((t:any)=>t.instId===`${symbol}-USDT-SWAP`)??null),
    take('Broad market',broadMarket,v=>input.market=v)
  ]);
  const now=Date.now(),long=evaluate(input,'LONG',now),short=evaluate(input,'SHORT',now);
  const selected=requested==='LONG'?long:requested==='SHORT'?short:long.verdict==='LONG SETUP'?long:short.verdict==='SHORT SETUP'?short:short.passed>long.passed?short:long;
  return {...selected,selection:requested,alternative:{side:selected.side==='LONG'?'SHORT':'LONG',passed:selected.side==='LONG'?short.passed:long.passed}};
}
