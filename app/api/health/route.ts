// Fixed public-data endpoints only. No credentials or arbitrary URL forwarding.
import {inspectHealth} from '@/lib/health-check';
import {localFetch} from '@/lib/local-fetch';
export async function GET(){
  const urls=[
    'https://fapi.binance.com/fapi/v1/time',
    'https://api.coingecko.com/api/v3/global',
    'https://api.coinpaprika.com/v1/global',
    'https://openapi.okx.com/api/v5/public/instruments?instType=SWAP',
  ];
  const checks=await Promise.all(urls.map(async url=>{try{const r=await localFetch(url,{signal:AbortSignal.timeout(10000),headers:{Accept:'application/json','User-Agent':'MarketLensLocal/1.0'}});return {provider:new URL(url).hostname,status:r.status,...inspectHealth(r.status,await r.text())}}catch{return {provider:new URL(url).hostname,status:0,healthy:false,message:'Connection failed'}}}));
  return Response.json({checks,checkedAt:Date.now()},{headers:{'Cache-Control':'no-store'}});
}
