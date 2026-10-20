import {market,btcContext,interestContext,flowContext,scope} from '@/lib/local-compass/data';
import {json,saveSnapshot} from '@/lib/local-store';
export async function GET(request:Request){return scope(async()=>{
  const kind=new URL(request.url).searchParams.get('kind');
  if(kind&&!['btc','oi','flow'].includes(kind))return json({error:'Unknown context'},400);
  try{
    const value=await (kind==='btc'?btcContext():kind==='oi'?interestContext():kind==='flow'?flowContext():market());
    await saveSnapshot('direction:'+(kind||'market'),value);
    return json(value);
  }catch(e){return json({error:e instanceof Error?e.message:'Direction feed unavailable'},503)}
})}
