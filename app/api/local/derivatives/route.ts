import {gateContext} from '@/lib/provider-feeds';
import {sharedFeedCache} from '@/lib/shared-feeds';
import {json} from '@/lib/local-store';
export async function GET(req:Request){return sharedFeedCache.scope(async()=>{
  const q=new URL(req.url).searchParams,symbol=q.get('symbol')??'',interval=q.get('interval')??'15m';
  if(!/^[A-Z0-9]{1,20}$/.test(symbol)||!['15m','1h','4h'].includes(interval))return json({error:'Invalid Gate contract or timeframe'},400);
  try{return json(await gateContext(symbol,interval))}catch(e){return json({provider:'Gate',symbol,interval,error:(e as Error).message},503)}
})}
