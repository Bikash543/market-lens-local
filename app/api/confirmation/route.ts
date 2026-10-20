import {analyze,directory,scope} from '@/lib/confirmation-data';
import {type Side} from '@/lib/confirmation';
import {normalizeCoin} from '@/lib/confirmation-symbols';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  if(+(request.headers.get('content-length')??0)>250000)return Response.json({error:'Analysis input too large'},{status:413});
  try{
    const text=await request.text();
    if(text.length>250000)return Response.json({error:'Analysis input too large'},{status:413});
    const body=JSON.parse(text),symbol=normalizeCoin(body.symbol??''),side=body.side??'AUTO';
    if(!symbol||!['AUTO','LONG','SHORT'].includes(side)||(body.direct!==undefined&&typeof body.direct!=='object'))return Response.json({error:'Invalid analysis inputs'},{status:400});
    return await scope(async()=>{
      if(!(await directory()).some(m=>m.symbol===symbol))return Response.json({error:'Select an active OKX USDT perpetual.'},{status:400});
      return Response.json(await analyze(symbol,side,body.direct),{headers:{'Cache-Control':'no-store'}});
    });
  }catch(e){return Response.json({error:e instanceof Error?e.message:'Analysis unavailable'},{status:503,headers:{'Cache-Control':'no-store'}})}
}
export async function GET(request:Request){
  const params=new URL(request.url).searchParams,symbol=normalizeCoin(params.get('symbol')??''),side=params.get('side')??'AUTO';
  if(!symbol||!['AUTO','LONG','SHORT'].includes(side))return Response.json({error:'Select an available coin and side before analysing.'},{status:400});
  try{return await scope(async()=>{
    if(!(await directory()).some(m=>m.symbol===symbol))return Response.json({error:'This coin does not have an active OKX USDT perpetual. Search and select another coin.'},{status:400});
    return Response.json(await analyze(symbol,side as 'AUTO'|Side),{headers:{'Cache-Control':'no-store'}});
  })}
  catch(e){return Response.json({error:e instanceof Error?e.message:'Analysis unavailable',retryAfterMs:60000},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'60'}})}
}
