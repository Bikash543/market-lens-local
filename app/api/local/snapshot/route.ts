import {env} from 'cloudflare:workers';
import {json} from '@/lib/local-store';
export async function GET(req:Request){
  const p=new URL(req.url).searchParams,exchange=p.get('exchange'),interval=p.get('interval');
  if(!['OKX','Binance'].includes(exchange??'')||!['15m','1h'].includes(interval??''))return json({error:'Invalid view'},400);
  const stored=await env.DB!.prepare('SELECT symbol,body,error,attempted FROM local_analyses WHERE exchange=? AND interval=?').bind(exchange,interval).all<{symbol:string;body:string|null;error:string|null;attempted:number}>();
  const analyses:Record<string,any>={},errors:Record<string,any>={};
  for(const r of stored.results){
    if(r.body)analyses[r.symbol]=JSON.parse(r.body);
    if(r.error)errors[r.symbol]={symbol:r.symbol,error:r.error,updated:r.attempted,retryAt:r.attempted+60000,attempts:1};
  }
  return json({exchange,interval,analyses,errors});
}
