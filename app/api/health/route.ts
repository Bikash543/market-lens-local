// Fixed public-data endpoints only. No credentials or arbitrary URL forwarding.
import {inspectHealth} from '@/lib/health-check';
import {localFetch} from '@/lib/local-fetch';
import {env} from 'cloudflare:workers';
import {dataReadiness} from '@/lib/data-readiness.mjs';
import {readSetting} from '@/lib/local-store';
import {cmcCurrent} from '@/lib/provider-feeds';
import {upstreamJSON} from '@/lib/upstream';
import {sharedGate} from '@/lib/shared-feeds';
export async function GET(){
  const urls=[
    'https://fapi.binance.com/fapi/v1/time',
    'https://api.coingecko.com/api/v3/global',
    'https://api.coinpaprika.com/v1/global',
    'https://openapi.okx.com/api/v5/public/instruments?instType=SWAP',
    'https://pro-api.coinmarketcap.com/public-api/v1/global-metrics/quotes/latest?convert=USD',
    'https://api.coinlore.net/api/tickers/?start=0&limit=100',
    'https://api.gateio.ws/api/v4/futures/usdt/contracts/BTC_USDT',
  ];
  const checks=await Promise.all(urls.map(async url=>{
    try{
      if(new URL(url).hostname==='pro-api.coinmarketcap.com'){
        const d=await cmcCurrent();return {provider:new URL(url).hostname,status:200,healthy:true,observationAt:d.time,message:'Validated current dominance received through the shared cache and rate limiter.'};
      }
      if(new URL(url).hostname==='api.coinlore.net'){
        const d=await upstreamJSON(url,{timeoutMs:10000,attempts:1,gate:sharedGate});return {provider:new URL(url).hostname,status:200,...inspectHealth(200,JSON.stringify(d))};
      }
      const r=await localFetch(url,{signal:AbortSignal.timeout(10000),headers:{Accept:'application/json','User-Agent':'MarketLensLocal/1.0'}});return {provider:new URL(url).hostname,status:r.status,...inspectHealth(r.status,await r.text())};
    }catch(e){const message=(e as Error).message;return {provider:new URL(url).hostname,status:0,healthy:false,message:message&&!/internal error; reference/i.test(message)?message:'Connection failed; other available providers remain active.'}}
  }));
  const saved=await env.DB!.prepare('SELECT body FROM local_snapshots WHERE key=?').bind('direction:market').first<{body:string}>();
  const direction=saved?dataReadiness('market',JSON.parse(saved.body)):{ready:false,pending:['No saved direction data.']};
  const [dominanceRecovery,timestamps]=await Promise.all([readSetting('dominance-recovery'),readSetting('direction-timestamps')]);
  return Response.json({checks,checkedAt:Date.now(),readiness:{direction,dominanceRecovery,timestamps},note:'Endpoint connectivity and saved-data readiness are separate checks. A responding API does not imply that every signal has sufficient history.'},{headers:{'Cache-Control':'no-store'}});
}
