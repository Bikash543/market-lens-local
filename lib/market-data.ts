// Shared validation keeps hosted and browser-direct OKX snapshots identical.
export function normalizeOKXMarket(info:any[],tickers:any[],marks:any[],funding:any[],now=Date.now()){
  const mm=new Map<string,any>(marks.map(x=>[x.instId,x])),tm=new Map<string,any>(tickers.map(x=>[x.instId,x])),fm=new Map<string,any>(funding.map(x=>[x.instId,x]));
  const rows=info.filter(s=>s.state==='live'&&s.settleCcy==='USDT'&&s.ctType==='linear'&&s.instCategory==='1'&&s.instId.endsWith('-USDT-SWAP')).flatMap(s=>{
    const t=tm.get(s.instId),m=mm.get(s.instId),f=fm.get(s.instId);if(!t||!m||!f)return [];
    const hours=(+f.fundingTime-+f.prevFundingTime)/3600000 || (+f.nextFundingTime-+f.fundingTime)/3600000;
    const updated=Math.min(+m.ts,+t.ts,+f.ts);
    if(!Number.isFinite(hours)||hours<=0||![+m.ts,+t.ts,+f.ts].every(ts=>Number.isFinite(ts)&&ts<=now+60000&&now-ts<=180000)||![+m.markPx,+t.open24h,+t.last].every(n=>Number.isFinite(n)&&n>0)||f.fundingRate===''||!Number.isFinite(+f.fundingRate)||!Number.isFinite(+t.volCcy24h)||+t.volCcy24h<0||!Number.isFinite(+t.volCcy24h*+t.last))return [];
    return [{symbol:s.instId.replace('-USDT-SWAP','USDT'),base:s.instId.split('-')[0],exchange:'OKX',instrument:s.instId,price:+m.markPx,change:(+t.last/+t.open24h-1)*100,volume:+t.volCcy24h*+t.last,funding:+f.fundingRate,fundingHours:hours,nextFunding:+f.fundingTime,updated}];
  }).sort((a,b)=>b.volume-a.volume);
  if(!rows.length)throw new Error('No fresh OKX crypto perpetual contracts returned');
  return {rows,updated:now,exchange:'OKX',source:'OKX USDT perpetuals',fallbackReason:''};
}
