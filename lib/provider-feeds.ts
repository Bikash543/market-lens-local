import {env} from 'cloudflare:workers';
import {sharedFeedCache,sharedGate} from './shared-feeds';
import {upstreamJSON} from './upstream';
import {cmcLatest,cmcHistory,gateStatistics} from './provider-data';
import {writeSetting} from './local-store';
const get=(url:string)=>upstreamJSON(url,{timeoutMs:5500,attempts:1,gate:sharedGate});
async function cmcConfigured(){
  const response=await fetch((process.env.MARKET_LENS_CONTROL_ORIGIN||'http://127.0.0.1:8788')+'/providers',{signal:AbortSignal.timeout(2500)});
  if(!response.ok)throw new Error('Local provider settings are unavailable');
  const settings:any=await response.json();
  return !!settings.cmc?.configured;
}
export async function cmcCurrent(configured?:boolean){
  const keyed=configured??await cmcConfigured();
  // Use the configured account for current quotes as well as history. The
  // keyless IP pool can be throttled independently of a healthy keyed account.
  // Five-minute reuse limits credits; original provider timestamps never move.
  return sharedFeedCache.get(`cmc:current:v3:${keyed?'keyed':'public'}`,300000,async()=>{
    const base='https://pro-api.coinmarketcap.com'+(keyed?'':'/public-api');
    const [g,t]=await Promise.all([get(base+'/v1/global-metrics/quotes/latest?convert=USD'),get(base+'/v3/cryptocurrency/quotes/latest?id=825&convert=USD')]);
    return cmcLatest(g,t);
  });
}
export async function recoverDominance(){
  try{
    if(!await cmcConfigured()){await writeSetting('dominance-recovery',{at:Date.now(),state:'key-required',message:'Add a free CoinMarketCap API key in Local settings. Missing history remains unavailable.'});return null}
    const current=await cmcCurrent(true);
    const findBaseline=()=>env.DB!.prepare('SELECT time FROM dominance WHERE source=? AND time BETWEEN ? AND ? ORDER BY time DESC LIMIT 1').bind('CoinMarketCap',current.time-4500000,current.time-3300000).first<{time:number}>();
    let baseline=await findBaseline(),restored=0,message='';
    if(!baseline){
      // Backfill only the missing same-provider window, and cache failed
      // attempts too. A current quote remains useful when history is denied.
      const result=await sharedFeedCache.get('cmc:history-recovery:v3',300000,async()=>{
        try{
          const end=Math.floor(current.time/1000)-3300,query=`time_start=${end-1200}&time_end=${end}&interval=5m&convert=USD`;
          const [g,t]=await Promise.all([get('https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/historical?'+query),get('https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/historical?id=825&'+query)]);
          const rows=cmcHistory(g,t);
          await env.DB!.batch(rows.map(r=>env.DB!.prepare('INSERT OR IGNORE INTO dominance (time,btc,usdt,source) VALUES (?,?,?,?)').bind(r.time,r.btc,r.usdt,r.source)));
          return {restored:rows.length,message:''};
        }catch(e){return {restored:0,message:(e as Error).message}}
      });
      restored=result.restored;message=result.message;
      // Verify what was actually saved, rather than an old recovery success.
      baseline=await findBaseline();
    }
    await writeSetting('dominance-recovery',{
      at:Date.now(),state:baseline?'ready':'unavailable',restored,source:'CoinMarketCap',
      observationAt:current.time,baselineAt:baseline?.time??null,
      message:baseline?'Verified same-provider historical dominance is available.':message||'CMC has no comparable ~1h baseline yet.'
    });
    return current;
  }catch(e){
    // Include current-quote and settings failures; never retain an old Ready.
    await writeSetting('dominance-recovery',{at:Date.now(),state:'unavailable',source:'CoinMarketCap',message:(e as Error).message}).catch(()=>{});
    throw e;
  }
}
export async function gateContext(symbol:string,interval:string){
  return sharedFeedCache.get(`gate:context:v1:${symbol}:${interval}`,60000,async()=>{
    const instrument=symbol+'_USDT';
    const [rows,contract]=await Promise.all([get(`https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=${instrument}&interval=${interval}&limit=8`),get(`https://api.gateio.ws/api/v4/futures/usdt/contracts/${instrument}`)]);
    if(contract.name!==instrument||contract.in_delisting)throw new Error('Unsupported or delisting Gate instrument');
    return gateStatistics(rows,contract,interval);
  });
}
