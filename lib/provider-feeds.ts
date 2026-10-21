import {env} from 'cloudflare:workers';
import {sharedFeedCache,sharedGate} from './shared-feeds';
import {upstreamJSON} from './upstream';
import {cmcLatest,cmcHistory,gateStatistics} from './provider-data';
import {writeSetting} from './local-store';
const get=(url:string)=>upstreamJSON(url,{timeoutMs:5500,attempts:1,gate:sharedGate});
export async function cmcCurrent(){
  return sharedFeedCache.get('cmc:current:v2',60000,async()=>{
  const [g,t]=await Promise.all([get('https://pro-api.coinmarketcap.com/public-api/v1/global-metrics/quotes/latest?convert=USD'),get('https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?id=825&convert=USD')]);
  return cmcLatest(g,t);
  });
}
export async function recoverDominance(){
  const settings:any=await fetch((process.env.MARKET_LENS_CONTROL_ORIGIN||'http://127.0.0.1:8788')+'/providers',{signal:AbortSignal.timeout(2500)}).then(r=>r.json());
  if(!settings.cmc?.configured){await writeSetting('dominance-recovery',{at:Date.now(),state:'key-required',message:'Add a free CoinMarketCap API key in Local settings. Missing history remains unavailable.'});return null}
  const current=await cmcCurrent();
  // Current quotes have an independent short TTL. Backfill only a missing
  // same-provider baseline, never six hours on every ordinary refresh.
  const existing=await env.DB!.prepare('SELECT time FROM dominance WHERE source=? AND time BETWEEN ? AND ? LIMIT 1').bind('CoinMarketCap',current.time-4500000,current.time-3300000).first();
  if(existing)return current;
  await sharedFeedCache.get('cmc:history-recovery:v2',300000,async()=>{
    try{
      const end=Math.floor(current.time/1000)-3300,query=`time_start=${end-1200}&time_end=${end}&interval=5m&convert=USD`;
      const [g,t]=await Promise.all([get('https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/historical?'+query),get('https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/historical?id=825&'+query)]);
      const rows=cmcHistory(g,t);
      await env.DB!.batch(rows.map(r=>env.DB!.prepare('INSERT OR IGNORE INTO dominance (time,btc,usdt,source) VALUES (?,?,?,?)').bind(r.time,r.btc,r.usdt,r.source)));
      const baseline=rows.find(r=>current.time-r.time>=3300000&&current.time-r.time<=4500000);
      if(!baseline)throw new Error('CMC returned history, but no comparable ~1h baseline');
      await writeSetting('dominance-recovery',{at:Date.now(),state:'ready',restored:rows.length,source:'CoinMarketCap',message:'Verified same-provider historical dominance is available.'});
      return {ready:true};
    }catch(e){await writeSetting('dominance-recovery',{at:Date.now(),state:'unavailable',message:(e as Error).message});return {ready:false}}
  });
  return current;
}
export async function gateContext(symbol:string,interval:string){
  return sharedFeedCache.get(`gate:context:v1:${symbol}:${interval}`,60000,async()=>{
    const instrument=symbol+'_USDT';
    const [rows,contract]=await Promise.all([get(`https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=${instrument}&interval=${interval}&limit=8`),get(`https://api.gateio.ws/api/v4/futures/usdt/contracts/${instrument}`)]);
    if(contract.name!==instrument||contract.in_delisting)throw new Error('Unsupported or delisting Gate instrument');
    return gateStatistics(rows,contract,interval);
  });
}
