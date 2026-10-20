// Verified CoinLore IDs against named stablecoins, 2026-10-20. Classification
// uses IDs, never price-near-$1 or a guessed symbol substring.
export const STABLE_IDS=['518','33285','158405','32417','164809','111357','100423','146447','154209','69801','32479','111413','111393'];
const canonical=(id:string)=>({'90':'btc-bitcoin','80':'eth-ethereum','518':'usdt-tether','33285':'usdc-usdc'}[id]??`coinlore:${id}`);
export const stableIds=STABLE_IDS.map(canonical);
export type MarketObservation={at:number;prices:Record<string,number>};
function numeric(v:unknown){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null}
export function convertCoinLore(pages:any[],history:MarketObservation[],now=Date.now()){
  if(pages.some(p=>!Array.isArray(p?.data)||!Number.isFinite(+p?.info?.time)))throw new Error('Invalid CoinLore market response');
  const times=pages.map(p=>+p.info.time*1000),at=Math.min(...times);
  if(now-at>600000||at>now+30000||Math.max(...times)-at>120000)throw new Error('CoinLore response timestamps are stale or misaligned');
  const raw=pages.flatMap(p=>p.data),unique=new Map<string,any>();
  for(const c of raw)if(!unique.has(String(c.id)))unique.set(String(c.id),c);
  const rows=[...unique.values()].sort((a,b)=>+a.rank-+b.rank).slice(0,125);
  const snapshot:MarketObservation={at,prices:{}};
  for(const c of rows){const p=numeric(c.price_usd);if(p!==null&&p>0)snapshot.prices[String(c.id)]=p}
  const target=at-900000;
  const prior=history.filter(s=>s.at<at&&Math.abs(s.at-target)<=90000).sort((a,b)=>Math.abs(a.at-target)-Math.abs(b.at-target))[0];
  // Never derive 4h from a multiple of 1h/24h. Match actual same-provider prices.
  const fourTarget=at-14400000;
  const four=history.filter(s=>s.at<at&&Math.abs(s.at-fourTarget)<=600000).sort((a,b)=>Math.abs(a.at-fourTarget)-Math.abs(b.at-fourTarget))[0];
  const tickers=rows.map(c=>{
    const p=numeric(c.price_usd),before=prior?.prices[String(c.id)],fourBefore=four?.prices[String(c.id)];
    return {id:canonical(String(c.id)),symbol:c.symbol,name:c.name,rank:+c.rank,last_updated:new Date(at).toISOString(),quotes:{USD:{price:p,market_cap:numeric(c.market_cap_usd),volume_24h:numeric(c.volume24),percent_change_1h:numeric(c.percent_change_1h),percent_change_15m:p!==null&&before>0?(p/before-1)*100:null,percent_change_4h:p!==null&&fourBefore>0?(p/fourBefore-1)*100:null}}};
  });
  const earlier=history.filter(s=>s.at<=at);
  return {tickers,snapshot,baselineMinutes:prior?(at-prior.at)/60000:null,baselineFourHoursMinutes:four?(at-four.at)/60000:null,historyMinutes:earlier.length?(at-Math.min(...earlier.map(s=>s.at)))/60000:0};
}
