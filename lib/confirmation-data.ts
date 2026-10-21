import {sharedOKX,sharedOKXCandles,sharedFeedCache} from './shared-feeds';
import {market as localBroadMarket,scope as broadScope} from './local-compass/data';
import {bars,evaluate,formingRange,Q,H,type Inputs,type Side,type Snapshot} from './confirmation';
import {env} from 'cloudflare:workers';
import {rememberRetirement} from './plan-retirement';
import {confirmationMarkets} from './confirmation-symbols';
import {applyDirectInputs,type DirectBundle} from './confirmation-direct';
export const scope=sharedFeedCache.scope;
async function get(path:string,ttl:number|((value:any[])=>number)=45000,timeoutMs=7500):Promise<any[]>{
  // Preserve the original bounded fallback; evaluate() still checks source times.
  return sharedOKX(path,ttl,timeoutMs,90000);
}
async function closedCandles(symbol:string,bar:'15m'|'1H',step:number){
  return bars(await sharedOKXCandles(symbol,bar,100),step);
}
async function currentRange(symbol:string){
  // Cache the acquisition timestamp along with the range. A short shared lease
  // lets simultaneous browser requests reuse it without extending its age.
  return sharedFeedCache.get('confirmation:range:v1:'+symbol,2000,async()=>formingRange(await sharedOKX(`/api/v5/market/candles?instId=${symbol}-USDT-SWAP&bar=15m&limit=2`,0,7500,0)));
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
    // Separate short-lived range cache: closed-candle caches can be held until
    // the next close and must not supply live stop/target invalidation.
    take('Current candle range',()=>currentRange(symbol),v=>input.intrabar=v),
    take('Spot CVD',()=>get(`/api/v5/rubik/stat/taker-volume?ccy=${symbol}&instType=SPOT&period=5m`,60000),v=>input.spot=v),
    take('Open interest',()=>get(`/api/v5/rubik/stat/contracts/open-interest-history?instId=${symbol}-USDT-SWAP&period=5m&limit=30`,60000),v=>input.oi=v),
    take('Funding',()=>get(`/api/v5/public/funding-rate?instId=${symbol}-USDT-SWAP`,60000),v=>input.funding=v[0]??null),
    // Reuse one public ticker snapshot across requests; evaluate only the selected
    // instrument. The individual-ticker endpoint is rate limited on this host.
    direct?Promise.resolve():take('Quote',()=>get('/api/v5/market/tickers?instType=SWAP',30000),v=>input.ticker=v.find((t:any)=>t.instId===`${symbol}-USDT-SWAP`)??null),
    take('Broad market',broadMarket,v=>input.market=v)
  ]);
  const now=Date.now();
  async function retainRetirement(s:Snapshot){
    return rememberRetirement(s,{
      write:(key,reason,expires)=>env.DB!.prepare('INSERT OR IGNORE INTO local_retired_plans(key,reason,retiredAt,expires) VALUES (?,?,?,?)').bind(key,reason,now,expires).run(),
      read:async key=>(await env.DB!.prepare('SELECT reason FROM local_retired_plans WHERE key=?').bind(key).first<{reason:string}>())?.reason??null
    });
  }
  const [long,short]=await Promise.all([retainRetirement(evaluate(input,'LONG',now)),retainRetirement(evaluate(input,'SHORT',now))]);
  const selected=requested==='LONG'?long:requested==='SHORT'?short:long.verdict==='LONG SETUP'?long:short.verdict==='SHORT SETUP'?short:short.passed>long.passed?short:long;
  return {...selected,selection:requested,alternative:{side:selected.side==='LONG'?'SHORT':'LONG',passed:selected.side==='LONG'?short.passed:long.passed}};
}

