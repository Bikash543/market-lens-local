import { okxContext,feedScope } from '@/lib/feeds';
import { deadline } from '@/lib/feed-cache';
import {isContractSymbol} from '@/lib/contract-symbol';
export async function POST(req:Request){return feedScope(async()=>{
  const start=Date.now();
  try{
    const body:any=await deadline(req.json(),1500,'Invalid request body');
    if(!body||!isContractSymbol(body.symbol)||!['15m','1h'].includes(body.interval))
      return Response.json({error:'Choose a valid OKX contract and a 15m or 1h interval'},{status:400});
    const data=await deadline(okxContext(body.symbol,body.interval),15000,'OKX statistics timed out');
    return Response.json(data,{headers:{'Cache-Control':'no-store','Server-Timing':`feed;dur=${Date.now()-start}`}});
  }catch(e){
    const retry=Number((e as {retryAfterMs?:number})?.retryAfterMs);
    const retryAfterMs=Number.isFinite(retry)?Math.max(1000,Math.min(300000,retry)):15000;
    return Response.json({error:(e as Error).message,retryAfterMs},{status:503,headers:{'Cache-Control':'no-store','Retry-After':String(Math.ceil(retryAfterMs/1000))}});
  }
})}
