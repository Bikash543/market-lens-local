import {scan,feedScope} from '@/lib/feeds';
import {saveAnalysis,json} from '@/lib/local-store';
import {isContractSymbol} from '@/lib/contract-symbol';
import {deadline} from '@/lib/feed-cache';
export async function POST(req:Request){return feedScope(async()=>{
  const body:any=await req.json();
  if(!['OKX','Binance'].includes(body.exchange)||!['15m','1h'].includes(body.interval)||!isContractSymbol(body.symbol))return json({error:'Invalid scan job'},400);
  let row:any;
  try{row=await deadline(scan(body.symbol,body.interval,body.exchange),16000,'Analysis timed out')}
  catch(e){row={symbol:body.symbol,exchange:body.exchange,error:(e as Error).message,updated:Date.now(),retryAfterMs:(e as any).retryAfterMs||60000}}
  await saveAnalysis(body.exchange,body.symbol,body.interval,row);
  return json(row);
})}
