// OKX contract-specific candles and taker flow, both bucketed by opening time.
// unit=2 requests quote-currency taker volume: [timestamp, sellVolume, buyVolume].
// OI is [timestamp, contracts, base currency, USD notional].
export function normalizeOKX(bars:any[], flow:any[], oi:any[], interval:string, now=Date.now()) {
  const duration=interval==='15m'?900000:3600000;
  const byTime=new Map(flow.map(v=>[+v[0],v]));
  const closed=bars.filter(k=>k[8]==='1'&&+k[0]+duration<=now).sort((a,b)=>+a[0]-+b[0]);
  // Drop only leading candles beyond flow coverage. Never fill missing flow with zero.
  const first=closed.findIndex(k=>byTime.has(+k[0]));
  const currentStart=closed.at(-1)?+closed.at(-1)![0]-3*duration:Infinity;
  let historicalDifferences=0;
  const raw=closed.slice(first<0?closed.length:first).map(k=>{
    const f=byTime.get(+k[0]);if(!f)throw new Error('Waiting for matching OKX taker-volume bucket');
    const sell=+f[1],buy=+f[2],total=sell+buy,quote=+k[7];
    if(!Number.isFinite(total)||sell<0||buy<0)throw new Error('Invalid OKX taker volume');
    if(Math.abs(total-quote)>Math.max(1,quote*.015)){
      if(+k[0]>=currentStart)throw new Error(`OKX taker volume and candle volume do not match at ${new Date(+k[0]).toISOString()} (${(Math.abs(total-quote)/Math.max(quote,1)*100).toFixed(2)}% difference). Waiting for reconciled exchange data.`);
      historicalDifferences++;
    }
    return [+k[0],+k[1],+k[2],+k[3],+k[4],+k[5],+k[0]+duration-1,total,0,0,buy];
  });
  // The newest OI bucket changes while it forms (confirmed against live responses).
  // Use completed buckets only and mark their availability at the period end.
  const closedOI=oi.filter(v=>+v[0]+duration<=now).map(v=>({timestamp:+v[0]+duration,sumOpenInterest:+v[1],sumOpenInterestValue:+v[3]}));
  return {raw,oi:closedOI,dataNote:historicalDifferences?`${historicalDifferences} older taker-flow bucket(s) differ from total candle volume. CVD uses reported taker flow; the current 4-candle window matches.`:undefined};
}
