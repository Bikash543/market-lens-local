import { scan,feedScope } from '@/lib/feeds';
import {saveAnalysis} from '@/lib/local-store';
import { deadline } from '@/lib/feed-cache';
import {isContractSymbol} from '@/lib/contract-symbol';
export async function POST(req:Request){return feedScope(async()=>{
  try{
    const body:any=await deadline(req.json(),1500,'Invalid request body');
    if(!body || typeof body!=='object')return Response.json({error:'Invalid scan request'},{status:400});
    if(!['Binance','OKX'].includes(body.exchange))return Response.json({error:'Choose the displayed exchange: Binance or OKX'},{status:400});
    if(!['15m','1h'].includes(body.interval)||!Array.isArray(body.symbols)||body.symbols.length<1||body.symbols.length>6||body.symbols.some((s:unknown)=>!isContractSymbol(s)))return Response.json({error:'Choose 1–6 valid contracts and a 15m or 1h interval'},{status:400});
    const symbols=[...new Set(body.symbols)] as string[];
    const start=Date.now();
    const rows=await Promise.all(symbols.map(async symbol=>{try{return await deadline(scan(symbol,body.interval,body.exchange),15000,'Analysis timed out; retrying automatically')}catch(e){
      const retry=Number((e as {retryAfterMs?:number})?.retryAfterMs);
      return {symbol,exchange:body.exchange,error:(e as Error).message,updated:Date.now(),retryAfterMs:Number.isFinite(retry)?Math.max(1000,Math.min(300000,retry)):15000};
    }}));
    await Promise.all(rows.map(row=>saveAnalysis(body.exchange,row.symbol,body.interval,row)));
    return Response.json({rows},{headers:{'Cache-Control':'no-store','Server-Timing':`feed;dur=${Date.now()-start}`}});
  }catch{return Response.json({error:'Unable to process scan request'},{status:500})}
})}
