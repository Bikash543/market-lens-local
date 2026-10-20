import { market,feedScope } from '@/lib/feeds';
import { deadline } from '@/lib/feed-cache';
import { FeedError } from '@/lib/upstream';
export async function GET(){return feedScope(async()=>{
  const start=Date.now();
  try{return Response.json(await deadline(market(),16000,'Market refresh timed out; retrying automatically'),{headers:{'Cache-Control':'no-store','Server-Timing':`feed;dur=${Date.now()-start}`}})}
  catch(e){const retryAfterMs=e instanceof FeedError?Math.max(15000,e.retryAfterMs):15000;console.warn(JSON.stringify({route:'market',elapsed:Date.now()-start,error:(e as Error).message}));return Response.json({error:(e as Error).message,retryAfterMs},{status:503,headers:{'Cache-Control':'no-store','Retry-After':String(Math.ceil(retryAfterMs/1000))}})}
})}
