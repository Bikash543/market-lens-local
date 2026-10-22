import { globalMarket,feedScope } from '@/lib/feeds';
import { deadline } from '@/lib/feed-cache';
export async function GET(){return feedScope(async()=>{
  const start=Date.now();
  try{return Response.json(await deadline(globalMarket(),12000,'Dominance refresh timed out; click Refresh to try again'),{headers:{'Cache-Control':'no-store','Server-Timing':`feed;dur=${Date.now()-start}`}})}
  catch(e){console.warn(JSON.stringify({route:'global',elapsed:Date.now()-start,error:(e as Error).message}));return Response.json({error:(e as Error).message,retryAfterMs:30000},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'30'}})}
})}
