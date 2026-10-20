import {analysisCurrent,type Analysis} from './engine';

export type FundingQuote={symbol:string;exchange:string;funding:number;fundingHours:number;updated:number};
export function reusableAnalysis(a:Analysis|undefined,quote:FundingQuote|undefined,exchange:string,interval:string,now=Date.now()):Analysis|null{
  if(!a||!quote||a.symbol!==quote.symbol||a.interval!==interval||(a as any).exchange!==exchange||quote.exchange!==exchange)return null;
  const step=interval==='15m'?900000:interval==='1h'?3600000:0;
  if(!step||a.closedAt!==Math.floor(now/step)*step-1||Math.abs(a.oiAt-(a.closedAt+1))>=60000)return null;
  if(![quote.funding,quote.fundingHours,quote.updated].every(Number.isFinite)||quote.fundingHours<=0||quote.updated>now+1000||now-quote.updated>180000)return null;
  // Refresh only the funding dependency and evaluation time. Closed observations
  // retain their original timestamps; an old candle can never be relabelled new.
  const candidate={...a,funding:quote.funding*8/quote.fundingHours,updated:now,fundingAt:quote.updated};
  return analysisCurrent(candidate,now)?candidate:null;
}
export function compactAnalysis<T extends Analysis>(a:T):T{
  return {...a,candles:[],cvdSeries:[],detailKey:a.closedAt};
}
export function analysisDueAt(interval:string,closedAt:number,now=Date.now()){
  const step=interval==='15m'?900000:3600000;
  const boundary=Math.floor(now/step)*step;
  // Delayed statistics are retried shortly; completed windows wait until the
  // next close plus a publication allowance. Funding is refreshed separately.
  return closedAt===boundary-1?boundary+step+15000:now+60000;
}
