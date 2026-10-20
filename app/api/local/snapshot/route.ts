import {env} from 'cloudflare:workers';
import {json,saveAnalysisDetails} from '@/lib/local-store';
import {reusableAnalysis,compactAnalysis} from '@/lib/analysis-reuse';
import {market,feedScope} from '@/lib/feeds';
import {isContractSymbol} from '@/lib/contract-symbol';
export async function GET(req:Request){
  const p=new URL(req.url).searchParams,exchange=p.get('exchange'),interval=p.get('interval');
  if(!['OKX','Binance'].includes(exchange??'')||!['15m','1h'].includes(interval??''))return json({error:'Invalid view'},400);
  const stored=await env.DB!.prepare('SELECT symbol,body,error,attempted FROM local_analyses WHERE exchange=? AND interval=?').bind(exchange,interval).all<{symbol:string;body:string|null;error:string|null;attempted:number}>();
  const analyses:Record<string,any>={},errors:Record<string,any>={};
  for(const r of stored.results){
    if(r.body)analyses[r.symbol]=p.get('summary')==='1'?compactAnalysis(JSON.parse(r.body)):JSON.parse(r.body);
    if(r.error)errors[r.symbol]={symbol:r.symbol,error:r.error,updated:r.attempted,retryAt:r.attempted+60000,attempts:1};
  }
  return json({exchange,interval,analyses,errors});
}
// Validate the whole saved window in one read, without a per-coin queue delay.
export async function POST(req:Request){return feedScope(async()=>{
  try{
    const body:any=await req.json(),{exchange,interval}=body;
    if(!['OKX','Binance'].includes(exchange)||!['15m','1h'].includes(interval)||!Array.isArray(body.symbols)||body.symbols.length>1500||body.symbols.some((s:unknown)=>!isContractSymbol(s)))return json({error:'Invalid refresh view'},400);
    const symbols=[...new Set(body.symbols)] as string[],wanted=new Set(symbols);
    const [quotes,stored]=await Promise.all([market(),env.DB!.prepare('SELECT symbol,body,error,attempted FROM local_analyses WHERE exchange=? AND interval=?').bind(exchange,interval).all<{symbol:string;body:string|null;error:string|null;attempted:number}>()]);
    const quoteMap=new Map<string,any>(quotes.exchange===exchange&&!quotes.stale?quotes.rows.map((r:any)=>[r.symbol,r]):[]);
    const analyses:Record<string,any>={},errors:Record<string,any>={},reused:string[]=[],details:any[]=[],now=Date.now();
    for(const row of stored.results){
      if(!wanted.has(row.symbol))continue;
      const a=row.body?JSON.parse(row.body):null;
      if(a)details.push(a);
      const current=!row.error?reusableAnalysis(a,quoteMap.get(row.symbol),exchange,interval,now):null;
      if(current){analyses[row.symbol]=compactAnalysis(current);reused.push(row.symbol)}
      else{
        if(a)analyses[row.symbol]=compactAnalysis(a);
        if(row.error)errors[row.symbol]={symbol:row.symbol,error:row.error,updated:row.attempted,retryAt:row.attempted+60000,attempts:1};
      }
    }
    if(!body.background)await saveAnalysisDetails(exchange,interval,details);
    const good=new Set(reused);
    return json({exchange,interval,analyses,errors,reused,pending:symbols.filter(s=>!good.has(s)),checkedAt:now});
  }catch(e){return json({error:(e as Error).message},503)}
})}
