import {env} from 'cloudflare:workers';
import {json} from '@/lib/local-store';
// Metadata only. No provider requests, candle arrays, or funding writes.
export async function GET(req:Request){
  const p=new URL(req.url).searchParams,exchange=p.get('exchange'),interval=p.get('interval');
  if(!['Binance','OKX'].includes(exchange??'')||!['15m','1h'].includes(interval??''))return json({error:'Invalid view'},400);
  const rows=await env.DB!.prepare(`SELECT symbol,error,attempted,closedAt,oiAt,venue,horizon FROM local_analysis_schedule WHERE exchange=? AND interval=?`).bind(exchange,interval).all();
  return json({exchange,interval,rows:rows.results,checkedAt:Date.now()});
}
