import {env} from 'cloudflare:workers';
import {json,hydrateChart} from '@/lib/local-store';
import {isContractSymbol} from '@/lib/contract-symbol';
export async function GET(req:Request){
  const p=new URL(req.url).searchParams,exchange=p.get('exchange'),symbol=p.get('symbol'),interval=p.get('interval'),closedAt=Number(p.get('closedAt'));
  if(!['OKX','Binance'].includes(exchange??'')||!isContractSymbol(symbol)||!['15m','1h'].includes(interval??'')||!Number.isSafeInteger(closedAt))return json({error:'Invalid saved detail request'},400);
  const exact=await env.DB!.prepare('SELECT body FROM local_analysis_details WHERE exchange=? AND symbol=? AND interval=? AND closedAt=?').bind(exchange,symbol,interval,closedAt).first<{body:string}>();
  const latest=exact??await env.DB!.prepare('SELECT body FROM local_analyses WHERE exchange=? AND symbol=? AND interval=?').bind(exchange,symbol,interval).first<{body:string}>();
  const a=latest?.body?await hydrateChart(JSON.parse(latest.body)):null;
  if(!a||a.closedAt!==closedAt)return json({error:'This saved chart is unavailable. Click Refresh selected asset.'},404);
  return json({symbol,interval,exchange,closedAt,candles:a.candles,cvdSeries:a.cvdSeries});
}
