import {analyze,captureFourContext,MAX_AGE,type FourHourContext} from './compass';

const canonical=(id:number)=>({1:'btc-bitcoin',1027:'eth-ethereum',825:'usdt-tether',3408:'usdc-usdc'} as Record<number,string>)[id]??`cmc:${id}`;
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
function checkStatus(body:any){
  if(!body?.status||Number(body.status.error_code)!==0)throw new Error('CoinMarketCap returned an unsuccessful data response');
}
// Never join providers by ticker symbol. All prices and classifications in this
// independent four-hour basket come from CMC's numeric asset IDs.
export function cmcConstituents(body:any,now=Date.now()){
  checkStatus(body);
  if(!Array.isArray(body.data)||body.data.length<100||body.data.length>125)throw new Error('CMC top-125 universe is incomplete');
  const ids=new Set<number>();
  const coins:Array<{id:number;key:string;symbol:string;name:string;rank:number;at:number;price:number;cap:number;volume:number;stable:boolean}>=body.data.map((c:any)=>{
    const q=Array.isArray(c.quote)?c.quote.find((v:any)=>v.symbol==='USD'):c.quote?.USD;
    const at=Date.parse(q?.last_updated);
    if(!Number.isSafeInteger(c.id)||c.id<=0||ids.has(c.id)||typeof c.symbol!=='string'||typeof c.name!=='string'||!Number.isSafeInteger(c.cmc_rank)||c.cmc_rank<1||!Array.isArray(c.tags)||!positive(q?.price)||!positive(q?.market_cap)||!Number.isFinite(at)||at>now+30000||now-at>MAX_AGE)throw new Error('CMC current quotes are invalid, stale or duplicated');
    ids.add(c.id);
    return {id:c.id,key:canonical(c.id),symbol:c.symbol,name:c.name,rank:c.cmc_rank,at,price:q.price as number,cap:q.market_cap as number,volume:positive(q.volume_24h)?q.volume_24h:0,stable:c.tags.includes('stablecoin')};
  });
  if(![1,1027,825,3408].every(id=>ids.has(id))||![825,3408].every(id=>coins.find(c=>c.id===id)?.stable))throw new Error('CMC BTC, ETH or stablecoin classification unavailable');
  const at=Math.min(...coins.map(c=>c.at));
  if(Math.max(...coins.map(c=>c.at))-at>120000)throw new Error('CMC current quote timestamps are misaligned');
  return {coins,at};
}
export function cmcHistoryQuery(current:ReturnType<typeof cmcConstituents>){
  // A bounded ten-minute range reliably returns the nearest published quote.
  // count=1 with only time_end can return an empty quotes array from CMC.
  const target=Math.floor(current.at/1000)-14400;
  return new URLSearchParams({id:current.coins.map(c=>c.id).join(','),time_start:String(target-300),time_end:String(target+300),interval:'5m',convert:'USD'}).toString();
}
export function cmcFourHour(current:ReturnType<typeof cmcConstituents>,history:any,now=Date.now()):FourHourContext{
  checkStatus(history);
  const target=current.at-14400000,baselines:number[]=[];
  const raw=current.coins.map(c=>{
    const asset=history.data?.[String(c.id)];
    const points=asset?.id===c.id&&Array.isArray(asset.quotes)?asset.quotes:[];
    const candidates=points.map((p:any)=>({at:Date.parse(p.timestamp),q:p.quote?.USD})).filter((p:any)=>{
      const quoteAt=Date.parse(p.q?.timestamp),minutes=(c.at-p.at)/60000;
      return positive(p.q?.price)&&Number.isFinite(p.at)&&quoteAt===p.at&&Math.abs(p.at-target)<=300000&&minutes>=230&&minutes<=250;
    }).sort((a:any,b:any)=>Math.abs(a.at-target)-Math.abs(b.at-target));
    const prior=candidates[0];
    if(prior)baselines.push(prior.at);
    return {id:c.key,symbol:c.symbol,name:c.name,rank:c.rank,last_updated:new Date(c.at).toISOString(),quotes:{USD:{price:c.price,market_cap:c.cap,volume_24h:c.volume,percent_change_4h:prior?(c.price/prior.q.price-1)*100:null}}};
  });
  if(!baselines.length||Math.max(...baselines)-Math.min(...baselines)>120000)throw new Error('CMC historical quote timestamps are missing or misaligned');
  const result=analyze(raw,current.coins.filter(c=>c.stable).map(c=>c.key),now);
  result.baselineFourHoursMinutes=(result.at-Math.min(...baselines))/60000;
  const context=captureFourContext(result,now);
  if(!context)throw new Error('CMC four-hour history has insufficient fresh, matched price and breadth coverage');
  return {...context,source:'CoinMarketCap',rows:result.rows,constituents:result.count,stableCount:result.stableCount,historyCredits:Number(history.status.credit_count)||0};
}
