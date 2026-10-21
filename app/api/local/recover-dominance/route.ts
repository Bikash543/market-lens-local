import {recoverDominance} from '@/lib/provider-feeds';
import {sharedFeedCache} from '@/lib/shared-feeds';
import {json} from '@/lib/local-store';
import {env} from 'cloudflare:workers';
export async function POST(req:Request){
  if(req.headers.get('origin')!==new URL(req.url).origin||!req.headers.get('content-type')?.includes('application/json'))return json({error:'Local app requests only'},403);
  return sharedFeedCache.scope(async()=>{
    try{
      const value=await recoverDominance();
      if(!value)return json({error:'A CoinMarketCap API key is required.'},428);
      const baseline=await env.DB!.prepare('SELECT time FROM dominance WHERE source=? AND time BETWEEN ? AND ? LIMIT 1').bind('CoinMarketCap',value.time-4500000,value.time-3300000).first();
      return baseline?json({message:'Verified CoinMarketCap history is available. Click Refresh on All Markets to use it.'}):json({error:'Current quote received, but comparable historical dominance is still unavailable. No baseline was invented.'},503);
    }
    catch(e){return json({error:(e as Error).message},503)}
  });
}
