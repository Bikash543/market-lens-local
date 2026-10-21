function usd(q:any){return Array.isArray(q)?q.find(v=>v.symbol==='USD'||v.id===2781):q?.USD}
function positive(v:any){return v!==null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0}
export function cmcLatest(global:any,tether:any,now=Date.now()){
  const g=global?.data,t=Array.isArray(tether?.data)?tether.data.find((v:any)=>v.id===825):tether?.data?.['825'];
  const total=usd(g?.quote),coin=usd(t?.quote),gt=Date.parse(total?.last_updated??g?.last_updated),tt=Date.parse(coin?.last_updated??t?.last_updated);
  if(!positive(total?.total_market_cap)||!positive(coin?.market_cap)||!positive(g?.btc_dominance)||g.btc_dominance>100||![gt,tt].every(Number.isFinite)||Math.abs(gt-tt)>120000||now-Math.min(gt,tt)>600000||Math.max(gt,tt)>now+30000)throw new Error('CMC dominance timestamps or values are invalid');
  const usdt=Number(coin.market_cap)/Number(total.total_market_cap)*100;
  if(usdt>100)throw new Error('Invalid USDT share');
  return {btc:Number(g.btc_dominance),usdt,time:Math.min(gt,tt),marketCap:Number(total.total_market_cap),source:'CoinMarketCap'};
}
export function cmcHistory(global:any,tether:any,now=Date.now()){
  const globals=global?.data?.quotes,quotes=tether?.data?.['825']?.quotes;
  if(!Array.isArray(globals)||!Array.isArray(quotes))throw new Error('CMC historical response shape is unavailable for this account');
  const result:{time:number;btc:number;usdt:number;source:string}[]=[];
  for(const g of globals){
    const total=usd(g.quote),at=Date.parse(total?.timestamp??g.timestamp);
    const candidates=quotes.map((t:any)=>({q:usd(t.quote),at:Date.parse(usd(t.quote)?.timestamp??t.timestamp)})).filter((t:any)=>Math.abs(t.at-at)<=120000).sort((a:any,b:any)=>Math.abs(a.at-at)-Math.abs(b.at-at));
    const t=candidates[0];
    if(!t||!positive(total?.total_market_cap)||!positive(t.q?.market_cap)||!positive(g.btc_dominance)||g.btc_dominance>100||!Number.isFinite(at)||Math.max(at,t.at)>now||now-Math.min(at,t.at)>86400000)continue;
    const usdt=Number(t.q.market_cap)/Number(total.total_market_cap)*100;
    if(usdt>0&&usdt<100)result.push({time:Math.min(at,t.at),btc:Number(g.btc_dominance),usdt,source:'CoinMarketCap'});
  }
  const unique=[...new Map(result.map(r=>[r.time,r])).values()].sort((a,b)=>a.time-b.time);
  if(unique.length<2)throw new Error('No aligned historical BTC/USDT dominance samples returned');
  return unique;
}
export function gateStatistics(raw:any[],contract:any,interval:string,now=Date.now()){
  const step=interval==='15m'?900000:interval==='1h'?3600000:interval==='4h'?14400000:0;
  if(!step||!Array.isArray(raw))throw new Error('Invalid Gate interval or response');
  const closed=raw.filter(r=>Number.isFinite(+r.time)&&+r.time*1000+step<=now).sort((a,b)=>+a.time-+b.time);
  const rows=closed.slice(-5),last=rows.at(-1),first=rows[0];
  if(rows.length!==5||now-(+last.time*1000+step)>step+120000||rows.some((r,i)=>!positive(r.open_interest)||!positive(r.open_interest_usd)||(i>0&&(+r.time-+rows[i-1].time)*1000!==step)))throw new Error('Gate OI history is missing, stale or discontinuous');
  const number=(v:any)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(+v)?+v:null;
  const funding=number(contract?.funding_rate),hours=Number(contract?.funding_interval)/3600;
  const sum=(field:string)=>rows.slice(1).every(r=>number(r[field])!==null&&+r[field]>=0)?rows.slice(1).reduce((s,r)=>s+Number(r[field]),0):null;
  return {provider:'Gate',instrument:contract.name,interval,at:+last.time*1000+step,fetchedAt:now,
    openInterestUsd:+last.open_interest_usd,oiChange:(+last.open_interest/+first.open_interest-1)*100,
    funding8h:funding!==null&&hours>0?funding*8/hours:null,fundingHours:hours>0?hours:null,
    longLiquidationsUsd:sum('long_liq_usd'),shortLiquidationsUsd:sum('short_liq_usd'),
    note:'Gate venue only. OI compares contract units over four completed buckets. Liquidations are recorded events, not a heatmap. Supporting context does not change Binance/OKX signal checks.'};
}
