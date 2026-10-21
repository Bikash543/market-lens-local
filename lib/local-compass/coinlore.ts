// Verified CoinLore IDs against named stablecoins, 2026-10-20. Classification
// uses IDs, never price-near-$1 or a guessed symbol substring.
export const STABLE_IDS=['518','33285','158405','32417','164809','111357','100423','146447','154209','69801','32479','111413','111393'];
const canonical=(id:string)=>({'90':'btc-bitcoin','80':'eth-ethereum','518':'usdt-tether','33285':'usdc-usdc'}[id]??`coinlore:${id}`);
export const stableIds=STABLE_IDS.map(canonical);
export type MarketObservation={at:number;prices:Record<string,number>;times?:Record<string,number>;version?:number};
function numeric(v:unknown){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null}
export function coinLoreTiming(pages:any[],now=Date.now()){
  const times=pages.map(p=>Number(p?.info?.time)*1000),valid=pages.length===2&&times.every(t=>Number.isFinite(t)&&t>0);
  const min=valid?Math.min(...times):null,max=valid?Math.max(...times):null;
  const state=!valid?'invalid':max!>now+30000?'future':now-min!>600000?'stale':max!-min!>120000?'misaligned':'fresh';
  return {checkedAt:now,pageTimes:times.map(t=>Number.isFinite(t)?t:null),ageMs:min===null?null:now-min,skewMs:min===null||max===null?null:max-min,state,olderPage:valid?times.indexOf(min!):null};
}
export function convertCoinLore(pages:any[],history:MarketObservation[],now=Date.now()){
  if(pages.some(p=>!Array.isArray(p?.data)||!Number.isFinite(+p?.info?.time)))throw new Error('Invalid CoinLore market response');
  const times=pages.map(p=>+p.info.time*1000),at=Math.min(...times);
  const timing=coinLoreTiming(pages,now);
  if(timing.state!=='fresh')throw new Error(`CoinLore response timestamps are stale or misaligned (${timing.state}; age ${Math.round((timing.ageMs??0)/1000)}s; page difference ${Math.round((timing.skewMs??0)/1000)}s)`);
  const raw=pages.flatMap(p=>p.data.map((c:any)=>({...c,observedAt:+p.info.time*1000}))),unique=new Map<string,any>();
  for(const c of raw)if(!unique.has(String(c.id)))unique.set(String(c.id),c);
  const rows=[...unique.values()].sort((a,b)=>+a.rank-+b.rank).slice(0,125);
  const snapshot:MarketObservation={at,prices:{},times:{},version:2};
  for(const c of rows){const p=numeric(c.price_usd);if(p!==null&&p>0){snapshot.prices[String(c.id)]=p;snapshot.times![String(c.id)]=c.observedAt}}
  // Each page has its own provider timestamp. Old records lost that detail;
  // retain them on disk but never invent per-coin timestamps for a 15m return.
  const baseline=(id:string,currentAt:number,window:number,tolerance:number)=>history
    .filter(s=>s.version===2&&s.prices[id]>0&&Number.isFinite(s.times?.[id])&&Math.abs(currentAt-s.times![id]-window)<=tolerance)
    .sort((a,b)=>Math.abs(currentAt-a.times![id]-window)-Math.abs(currentAt-b.times![id]-window))[0];
  const quarterMinutes:number[]=[],fourMinutes:number[]=[];
  const tickers=rows.map(c=>{
    const id=String(c.id),p=numeric(c.price_usd),prior=baseline(id,c.observedAt,900000,90000),four=baseline(id,c.observedAt,14400000,600000);
    if(prior)quarterMinutes.push((c.observedAt-prior.times![id])/60000);
    if(four)fourMinutes.push((c.observedAt-four.times![id])/60000);
    return {id:canonical(id),symbol:c.symbol,name:c.name,rank:+c.rank,last_updated:new Date(c.observedAt).toISOString(),quotes:{USD:{price:p,market_cap:numeric(c.market_cap_usd),volume_24h:numeric(c.volume24),percent_change_1h:numeric(c.percent_change_1h),percent_change_15m:p!==null&&prior?(p/prior.prices[id]-1)*100:null,percent_change_4h:p!==null&&four?(p/four.prices[id]-1)*100:null}}};
  });
  const earlier=history.filter(s=>s.at<=at);
  const average=(a:number[])=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null;
  return {tickers,snapshot,baselineMinutes:average(quarterMinutes),baselineFourHoursMinutes:average(fourMinutes),baselineRange:quarterMinutes.length?[Math.min(...quarterMinutes),Math.max(...quarterMinutes)]:null,historyMinutes:earlier.length?(at-Math.min(...earlier.map(s=>s.at)))/60000:0};
}
