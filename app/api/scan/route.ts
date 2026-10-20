import {deadline} from '@/lib/feed-cache';
import {compactAnalysis} from '@/lib/analysis-reuse';
import {isContractSymbol} from '@/lib/contract-symbol';
import {saveAnalysisDetails} from '@/lib/local-store';
import {reuseSavedScan,feedScope} from '@/lib/feeds';
export async function POST(req:Request){
  try{
    const body:any=await deadline(req.json(),1500,'Invalid request body');
    if(!body||!['Binance','OKX'].includes(body.exchange)||!['15m','1h'].includes(body.interval)||!Array.isArray(body.symbols)||body.symbols.length<1||body.symbols.length>6||body.symbols.some((s:unknown)=>!isContractSymbol(s)))return Response.json({error:'Choose 1–6 valid contracts and a 15m or 1h interval'},{status:400});
    const start=Date.now();
    const rows=await Promise.all([...new Set(body.symbols)].map(async symbol=>{
      try{
        // The collector may have completed this coin since the initial bulk
        // check. A disk/cache hit needs no scarce scan slot or queue delay.
        const cached=await feedScope(()=>reuseSavedScan(String(symbol),body.interval,body.exchange)).catch(()=>null);
        if(cached){
          if(!body.background)await saveAnalysisDetails(body.exchange,body.interval,[cached]);
          return body.summary?compactAnalysis(cached):cached;
        }
        const control=process.env.MARKET_LENS_CONTROL_ORIGIN||'http://127.0.0.1:8788';
        if(!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(control))throw new Error('Invalid local control origin');
        const r=await fetch(control+'/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol,interval:body.interval,exchange:body.exchange,priority:body.background?0:body.selected?8:4}),signal:AbortSignal.timeout(45000)});
        const row:any=await r.json();
        if(!r.ok)throw new Error(row.error||'Shared scan unavailable');
        if(!body.background&&!row.error)await saveAnalysisDetails(body.exchange,body.interval,[row]);
        return body.summary&&!row.error?compactAnalysis(row):row;
      }catch(e){return {symbol,exchange:body.exchange,error:(e as Error).message,updated:Date.now(),retryAfterMs:60000}}
    }));
    return Response.json({rows},{headers:{'Cache-Control':'no-store','Server-Timing':`feed;dur=${Date.now()-start}`}});
  }catch{return Response.json({error:'Unable to process scan request'},{status:500})}
}
