// Pure, testable signal rules. Scores measure agreement, not win probability.
export type Candle = { time:number; end:number; open:number; high:number; low:number; close:number; volume:number; buy:number };
export type Dominance = { btc:number; usdt:number; updated:number; btcChange:number|null; usdtChange:number|null; baseline:number|null; history:{time:number;btc:number;usdt:number}[]; source?:string };
export type Analysis = { symbol:string; interval:string; updated:number; closedAt:number; oiAt:number; oi:number; oiChange:number; cvd:number; imbalance:number; momentum:number; atr:number; ema:number; price:number; funding:number; candles:Candle[]; cvdSeries:number[]; error?:string; dataNote?:string };
export function analyze(symbol:string, interval:string, raw:any[], oi:any[], funding:number, now=Date.now()):Analysis {
  if(!['15m','1h'].includes(interval))throw new Error('Unsupported analysis timeframe');
  const duration=interval==='15m'?900000:3600000;
  const candles:Candle[]=raw.filter(k=>Number(k[6])<now).map(k=>({time:+k[0],end:+k[6],open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[7],buy:+k[10]}));
  if(candles.length<35 || oi.length<5) throw new Error('Insufficient closed candles or open-interest history');
  const last=candles.at(-1)!;
  if(now-last.end>duration+120000) throw new Error('Candle feed is stale');
  if(candles.some((c,i)=>![c.time,c.end].every(Number.isFinite)||c.end-c.time!==duration-1||![c.open,c.high,c.low,c.close].every(x=>Number.isFinite(x)&&x>0)||c.high<Math.max(c.open,c.close,c.low)||c.low>Math.min(c.open,c.close)||!Number.isFinite(c.volume)||c.volume<0||!Number.isFinite(c.buy)||c.buy<0||c.buy>c.volume*1.001||(i>0&&c.time-candles[i-1].time!==duration))) throw new Error('Invalid or discontinuous candle data');
  // Match OI boundaries to the exact four closed candles used by CVD and price.
  const end=last.end+1, start=end-4*duration;
  const before=oi.find(x=>Math.abs(+x.timestamp-start)<60000);
  const after=oi.find(x=>Math.abs(+x.timestamp-end)<60000);
  if(!before||!after||![+before.sumOpenInterest,+after.sumOpenInterest].every(x=>Number.isFinite(x)&&x>0)||+after.timestamp>now+1000) throw new Error('Waiting for aligned open-interest sample');
  if(now-(+after.timestamp)>duration+120000) throw new Error('Open-interest feed is stale');
  let ema=candles[0].close, atr=0, cumulative=0;
  const series:number[]=[];
  candles.forEach((c,i)=>{ema=c.close*2/21+ema*19/21;const prev=candles[Math.max(i-1,0)].close;const tr=Math.max(c.high-c.low,Math.abs(c.high-prev),Math.abs(c.low-prev));atr=i===0?tr:(atr*13+tr)/14;cumulative+=2*c.buy-c.volume;series.push(cumulative)});
  const window=candles.slice(-4), volume=window.reduce((s,c)=>s+c.volume,0), cvd=window.reduce((s,c)=>s+2*c.buy-c.volume,0);
  if(!Number.isFinite(funding)||!Number.isFinite(+after.sumOpenInterestValue)||+after.sumOpenInterestValue<=0) throw new Error('Funding or OI unavailable');
  return {symbol,interval,updated:now,closedAt:last.end,oiAt:+after.timestamp,oi:+after.sumOpenInterestValue,oiChange:(+after.sumOpenInterest/+before.sumOpenInterest-1)*100,cvd,imbalance:volume?cvd/volume:0,momentum:(last.close/window[0].open-1)*100,atr,ema,price:last.close,funding,candles: candles.slice(-48),cvdSeries:series.slice(-48)};
}
export function analysisCurrent(a:Analysis,now=Date.now()){
  const duration=a.interval==='15m'?900000:3600000;
  return !a.error&&['15m','1h'].includes(a.interval)&&
    [a.updated,a.closedAt,a.oiAt,a.oi,a.oiChange,a.cvd,a.imbalance,a.momentum,a.atr,a.ema,a.price,a.funding].every(Number.isFinite)&&
    a.price>0&&a.ema>0&&a.atr>=0&&a.oi>0&&Math.abs(a.imbalance)<=1.001&&
    a.updated<=now+30000&&a.closedAt<now&&a.oiAt<=now+1000&&
    now-a.updated<=600000&&now-a.closedAt<=duration+120000&&now-a.oiAt<=duration+120000;
}
export function dominanceStatus(d:Dominance|null,now=Date.now()){
  const fresh=!!d&&[d.btc,d.usdt,d.updated].every(Number.isFinite)&&d.btc>0&&d.btc<=100&&d.usdt>0&&d.usdt<=100&&d.updated<=now+30000&&now-d.updated<1800000;
  const ready=fresh&&d!.baseline!==null&&Number.isFinite(d!.baseline)&&
    d!.updated-d!.baseline!>=3300000&&d!.updated-d!.baseline!<=4500000&&
    d!.btcChange!==null&&d!.usdtChange!==null&&Number.isFinite(d!.btcChange)&&Number.isFinite(d!.usdtChange);
  const long=ready&&d!.usdtChange!<=-.015,short=ready&&d!.usdtChange!>=.015;
  const change=ready?`${d!.usdtChange!>=0?'+':''}${d!.usdtChange!.toFixed(3)} pp`:'';
  const message=!fresh?'Global data is missing or stale. Click Refresh; full setups are withheld.':
    !ready?'A comparable ~1h dominance baseline is unavailable. Derivatives-only ideas remain on Watch.':
    !long&&!short?`USDT dominance ${change}: neither direction passes. Long needs ≤ −0.015 pp; short needs ≥ +0.015 pp.`:
    `USDT dominance ${change}: ${long?'long':'short'} gate passes. Each coin still needs all other checks.`;
  return {fresh,ready,long,short,message};
}
export function signalCoverage(symbols:string[],analyses:Record<string,Analysis>,errors:Record<string,unknown>,now=Date.now()){
  const counts={current:0,stale:0,unavailable:0,unscanned:0};
  for(const symbol of symbols){if(errors[symbol])counts.unavailable++;else if(!analyses[symbol])counts.unscanned++;else if(analysisCurrent(analyses[symbol],now))counts.current++;else counts.stale++}
  return counts;
}
export function signal(a:Analysis|undefined,d:Dominance|null,now=Date.now()) {
  if(!a) return {side:'waiting',label:'Waiting',score:0,reasons:['Analysis is queued'],direction:0,checks:[] as {name:string;ok:boolean;detail:string}[]};
  if(!analysisCurrent(a,now)) return {side:'stale',label:'Stale',score:0,reasons:['Refresh required; stale or invalid inputs suppress this setup'],direction:0,checks:[]};
  const direction=a.momentum>=0?1:-1;
  const dominance=dominanceStatus(d,now),domReady=dominance.ready;
  const checks=[
    {name:'Price & trend',ok:Math.abs(a.momentum)>=.15&&(direction>0?a.price>a.ema:a.price<a.ema),detail:`${a.momentum.toFixed(2)}% over 4 candles; EMA20 filter`},
    {name:'Open interest',ok:a.oiChange>=.25,detail:`${a.oiChange.toFixed(2)}% in contract units; needs +0.25%`},
    {name:'Taker flow / CVD',ok:a.imbalance*direction>=.03,detail:`${(a.imbalance*100).toFixed(1)}% net taker imbalance; needs 3% agreement`},
    {name:'Funding',ok:direction>0?a.funding<=.0003:a.funding>=-.0003,detail:`${(a.funding*100).toFixed(4)}% normalized to 8h; avoids crowded side`},
    {name:'USDT dominance',ok:direction>0?dominance.long:dominance.short,detail:domReady?`${d!.usdtChange!.toFixed(3)} pp / ~1h; ${direction>0?'long needs ≤ −0.015':'short needs ≥ +0.015'} pp`:dominance.message},
    {name:'BTC dominance',ok:domReady&&(a.symbol==='BTCUSDT'?(direction>0?d!.btcChange!>=0:d!.btcChange!<=0):(direction>0?d!.btcChange!<=.1:d!.btcChange!>=-.1)),detail:domReady?`${d!.btcChange!.toFixed(3)} pp / ~1h; BTC and altcoins use different filters`:'Dominance baseline warming up'},
  ];
  const score=checks.filter(c=>c.ok).length;
  const core=checks.slice(0,4).every(c=>c.ok);
  const complete=core&&checks.slice(4).every(c=>c.ok);
  const side=complete?(direction>0?'long':'short'):core?'watch':'neutral';
  const label=complete?(direction>0?'Long setup':'Short setup'):core?(direction>0?'Long watch':'Short watch'):'Neutral';
  return {side,label,score,reasons:checks.filter(c=>!c.ok).map(c=>c.detail),direction,checks};
}
