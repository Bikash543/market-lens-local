export const MAX_AGE = 10 * 60_000;
// An hourly cloud collection can arrive a little late. This is the age of a
// completed 4h observation, never a wider tolerance for the 4h return itself.
export const FOUR_CONTEXT_AGE = 75 * 60_000;
export type Horizon = '15m' | '1h' | '4h';
export const HORIZONS:Horizon[]=['15m','1h','4h'];
export type Coin = { id:string; symbol:string; name:string; rank:number; cap:number; price:number; volume:number; at:number; changes:Record<Horizon,number|null> };
export type Breadth = { up:number; down:number; flat:number; total:number; available:number; advance:number; median:number|null };
export type Reading = { horizon:Horizon; alt:number|null; altWithEth:number|null; smaller:number|null; btc:number|null; btcDom:number|null; usdtDom:number|null; breadth:Breadth; coverage:number; bias:'LONG'|'SHORT'|'WAIT'; reasons:string[] };
export type FourHourContext = {source?:string;rows?:Coin[];constituents?:number;stableCount?:number;historyCredits?:number;at:number;baselineMinutes:number;reading:Reading;changes:Record<string,number|null>;altCap:number;btcPrice:number;btcDominance:number;usdtDominance:number};
export type Compass = { at:number; fetchedAt:number; source:string; baselineMinutes?:number|null; baselineFourHoursMinutes?:number|null; historyMinutes?:number; sourceNote?:string; totalCap:number; altCap:number; altWithEthCap:number; smallCap:number; btcPrice:number; btcDominance:number; usdtDominance:number; count:number; expected:number; stableCount:number; coverage:number; rows:Coin[]; readings:Record<Horizon,Reading>; signal:'LONG BIAS'|'SHORT BIAS'|'WAIT'; alignedSignal:'LONG BIAS'|'SHORT BIAS'|'WAIT'; alignment:'ALIGNED'|'CONFLICT'|'MIXED'|'COLLECTING'|'UNAVAILABLE'; reasons:string[]; stale:boolean; refreshing?:boolean; refreshError?:string;fourContext?:FourHourContext;fourStatus?:'live'|'saved'|'expired';fourError?:string;sourceSync?:{mode:'current'|'buffered';warning?:string;checkedAt:number;pageTimes:number[];latestPageTimes:(number|null)[];skewMs:number};collection?:{cadenceMinutes:number;latestObservationAt:number;observations:number} };
const valid=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const sum=(rows:Coin[])=>rows.reduce((s,c)=>s+c.cap,0);
const change=(x:unknown)=>valid(x)&&x>-100&&x<100000?Number(x.toFixed(6)):null;
export function normalize(raw:any):Coin|null {
  const q=raw?.quotes?.USD;
  if(!q||typeof raw.id!=='string'||typeof raw.symbol!=='string'||!valid(q.market_cap)||q.market_cap<=0||!valid(q.price)||q.price<=0||!valid(raw.rank)||raw.rank<1)return null;
  const at=Date.parse(raw.last_updated);
  if(!Number.isFinite(at))return null;
  return {id:raw.id,symbol:raw.symbol,name:raw.name,rank:raw.rank,cap:q.market_cap,price:q.price,volume:valid(q.volume_24h)?q.volume_24h:0,at,changes:{'15m':change(q.percent_change_15m),'1h':change(q.percent_change_1h),'4h':change(q.percent_change_4h)}};
}
// Fixed current constituents and current supply: a price-return estimate, not
// an observed historical capitalization series or a TradingView index.
export function basketReturn(rows:Coin[],h:Horizon):number|null {
  if(!rows.length||rows.some(c=>c.changes[h]===null))return null;
  const before=rows.reduce((s,c)=>s+c.cap/(1+c.changes[h]!/100),0);
  return before>0?(sum(rows)/before-1)*100:null;
}
export function breadth(rows:Coin[],h:Horizon):Breadth {
  const values=rows.map(c=>c.changes[h]).filter((v):v is number=>v!==null).sort((a,b)=>a-b);
  const up=values.filter(x=>x>.05).length,down=values.filter(x=>x<-.05).length;
  return {up,down,flat:values.length-up-down,total:rows.length,available:values.length,advance:values.length?up/values.length*100:0,median:values.length?(values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2:null};
}
export function decide(r:Omit<Reading,'bias'|'reasons'>,ready:boolean):Reading {
  const reasons:string[]=[];
  if(!ready||r.coverage<.9||r.breadth.available<50||r.breadth.available/r.breadth.total<.9||[r.alt,r.btc,r.usdtDom,r.btcDom].some(v=>v===null))return {...r,bias:'WAIT',reasons:['Insufficient fresh, aligned market data. Direction withheld.']};
  const threshold=r.horizon==='4h'?.30:r.horizon==='1h'?.15:.08;
  const share=r.horizon==='4h'?.01:.005,btcLimit=r.horizon==='4h'?.30:.10;
  const bull=r.alt!>=threshold&&r.breadth.advance>=60&&r.usdtDom!<=-share&&r.btc!>=-btcLimit;
  const bear=r.alt!<=-threshold&&r.breadth.down/r.breadth.available>=.6&&r.usdtDom!>=share&&r.btc!<=btcLimit;
  reasons.push(`Alt basket ${r.alt!>=0?'+':''}${r.alt!.toFixed(2)}% over ${r.horizon}.`);
  reasons.push(`${r.breadth.up} advancing, ${r.breadth.down} declining, ${r.breadth.flat} flat (±0.05%).`);
  reasons.push(`USDT share ${r.usdtDom!>=0?'+':''}${r.usdtDom!.toFixed(4)} percentage points.`);
  if(r.btcDom!>.03)reasons.push('BTC share is rising: altcoin relative strength is weaker.');
  else if(r.btcDom!<-.03)reasons.push('BTC share is falling: altcoins are outperforming relatively.');
  if(r.btc!<-1)reasons.push('BTC fell more than 1% in this window; elevated downside volatility.');
  if(!bull&&!bear)reasons.push('Basket, breadth, BTC and USDT-share conditions do not all agree.');
  return {...r,bias:bull?'LONG':bear?'SHORT':'WAIT',reasons};
}
export function analyze(raw:any[],stableIds:string[],now=Date.now()):Compass {
  if(!Array.isArray(raw)||!Array.isArray(stableIds)||!stableIds.includes('usdt-tether')||!stableIds.includes('usdc-usdc'))throw new Error('Market data or stablecoin classification unavailable');
  const unique=new Map<string,Coin>();
  for(const r of raw){const c=normalize(r);if(c&&!unique.has(c.id))unique.set(c.id,c)}
  const selected=[...unique.values()].sort((a,b)=>a.rank-b.rank).slice(0,125);
  if(selected.length<100)throw new Error('Incomplete market universe');
  const fresh=selected.filter(c=>now-c.at<=MAX_AGE&&c.at<=now+30_000);
  const stable=new Set(stableIds),alts=fresh.filter(c=>!stable.has(c.id)&&c.id!=='btc-bitcoin'&&c.id!=='eth-ethereum');
  const withEth=fresh.filter(c=>!stable.has(c.id)&&c.id!=='btc-bitcoin'),small=alts.filter(c=>c.rank>10);
  const btc=fresh.find(c=>c.id==='btc-bitcoin'),usdt=fresh.find(c=>c.id==='usdt-tether');
  if(!btc||!usdt||!alts.length)throw new Error('Fresh BTC, USDT and altcoin observations required');
  const cap=sum(fresh),coverage=sum(fresh)/sum(selected);
  const aligned=Math.max(...fresh.map(c=>c.at))-Math.min(...fresh.map(c=>c.at))<=120_000;
  const ready=aligned&&fresh.length/selected.length>=.9&&coverage>=.98;
  const readings={} as Record<Horizon,Reading>;
  for(const h of HORIZONS){
    const complete=fresh.filter(c=>c.changes[h]!==null);
    const coverageH=sum(complete)/cap;
    const altComplete=alts.filter(c=>c.changes[h]!==null);
    const priorTotal=complete.reduce((s,c)=>s+c.cap/(1+c.changes[h]!/100),0);
    // Compare exactly the same constituents in the current and prior denominator.
    const currentTotal=sum(complete);
    const dominance=(c:Coin)=>c.changes[h]!==null&&priorTotal>0?(c.cap/currentTotal-c.cap/(1+c.changes[h]!/100)/priorTotal)*100:null;
    readings[h]=decide({horizon:h,alt:basketReturn(altComplete,h),altWithEth:basketReturn(withEth.filter(c=>c.changes[h]!==null),h),smaller:basketReturn(small.filter(c=>c.changes[h]!==null),h),btc:btc.changes[h],btcDom:dominance(btc),usdtDom:dominance(usdt),breadth:breadth(alts,h),coverage:Math.min(coverageH,sum(altComplete)/sum(alts))},ready);
  }
  const hour=readings['1h'],quarter=readings['15m'];
  const signal=hour.bias==='LONG'&&quarter.bias==='LONG'?'LONG BIAS':hour.bias==='SHORT'&&quarter.bias==='SHORT'?'SHORT BIAS':'WAIT';
  const four=readings['4h'],fourReady=four.coverage>=.9&&four.breadth.available>=50&&four.breadth.available/four.breadth.total>=.9&&[four.alt,four.btc,four.usdtDom,four.btcDom].every(v=>v!==null);
  const alignedSignal=signal!=='WAIT'&&four.bias===hour.bias?signal:'WAIT';
  const alignment=!ready?'UNAVAILABLE':!fourReady?'COLLECTING':alignedSignal!=='WAIT'?'ALIGNED':signal!=='WAIT'&&four.bias!=='WAIT'?'CONFLICT':'MIXED';
  const reasons=signal==='WAIT'?[hour.bias==='WAIT'?'The 1-hour market direction is mixed.':`The 1-hour ${hour.bias.toLowerCase()} bias lacks 15-minute agreement.`,...quarter.reasons]:[`${hour.bias==='LONG'?'Bullish':'Bearish'} basket movement and broad participation agree in both windows.`,...quarter.reasons];
  if(!ready)reasons.unshift('Coverage or timestamp alignment is insufficient; signals are withheld.');
  return {at:Math.min(...fresh.map(c=>c.at)),fetchedAt:now,source:'CoinLore',totalCap:cap,altCap:sum(alts),altWithEthCap:sum(withEth),smallCap:sum(small),btcPrice:btc.price,btcDominance:btc.cap/cap*100,usdtDominance:usdt.cap/cap*100,count:fresh.length,expected:selected.length,stableCount:fresh.filter(c=>stable.has(c.id)).length,coverage,rows:alts,readings,signal,alignedSignal,alignment,reasons,stale:false};
}
const fourReady=(r:Reading)=>r?.horizon==='4h'&&r.coverage>=.9&&r.breadth?.available>=50&&r.breadth.available/r.breadth.total>=.9&&[r.alt,r.btc,r.usdtDom,r.btcDom].every(valid);
export function validFourContext(value:FourHourContext|undefined|null,now=Date.now()):value is FourHourContext {
  return !!value&&(value.source!=='CoinMarketCap'||(Array.isArray(value.rows)&&value.rows.length>=50&&value.rows.length<=125&&value.rows.every(c=>typeof c.id==='string'&&typeof c.symbol==='string'&&typeof c.name==='string'&&valid(c.price)&&valid(c.cap)&&valid(c.at)&&c.changes&&HORIZONS.every(h=>c.changes[h]===null||valid(c.changes[h])))))&&valid(value.at)&&value.at<=now+30000&&now-value.at<=FOUR_CONTEXT_AGE&&value.baselineMinutes>=230&&value.baselineMinutes<=250&&fourReady(value.reading)&&['LONG','SHORT','WAIT'].includes(value.reading.bias)&&Array.isArray(value.reading.reasons)&&[value.altCap,value.btcPrice,value.btcDominance,value.usdtDominance].every(valid)&&!!value.changes&&typeof value.changes==='object'&&Object.values(value.changes).every(v=>v===null||valid(v));
}
export function captureFourContext(value:Compass,now=Date.now()):FourHourContext|null {
  if(value.fourStatus==='saved'||(value.fourContext&&value.fourContext.at!==value.at)||value.stale||value.alignment==='UNAVAILABLE'||now-value.at>MAX_AGE||value.at>now+30000||value.baselineFourHoursMinutes==null||!fourReady(value.readings['4h']))return null;
  const context={at:value.at,baselineMinutes:value.baselineFourHoursMinutes,reading:value.readings['4h'],changes:Object.fromEntries(value.rows.map(c=>[c.id,c.changes['4h']])),altCap:value.altCap,btcPrice:value.btcPrice,btcDominance:value.btcDominance,usdtDominance:value.usdtDominance};
  return validFourContext(context,now)?context:null;
}
export function carryFourContext(value:Compass,saved:FourHourContext|null,now=Date.now()):Compass {
  const current=captureFourContext(value,now);
  if(current)return {...value,fourContext:current,fourStatus:'live'};
  if(!validFourContext(saved,now))return saved?{...value,fourStatus:'expired'}:value;
  const hour=value.readings['1h'];
  const alignedSignal=value.signal!=='WAIT'&&saved.reading.bias===hour.bias?value.signal:'WAIT';
  const alignment=value.stale||value.alignment==='UNAVAILABLE'?'UNAVAILABLE':alignedSignal!=='WAIT'?'ALIGNED':value.signal!=='WAIT'&&saved.reading.bias!=='WAIT'?'CONFLICT':'MIXED';
  return {...value,fourContext:saved,fourStatus:'saved',baselineFourHoursMinutes:saved.baselineMinutes,alignedSignal,alignment,readings:{...value.readings,'4h':saved.reading},rows:value.rows.map(c=>({...c,changes:{...c.changes,'4h':saved.changes[c.id]??null}}))};
}
// Independent CMC context: preserve the intraday model and its CoinLore rows.
// The UI selects CMC rows only for the CMC four-hour view.
export function attachFourContext(value:Compass,context:FourHourContext,now=Date.now()):Compass {
  if(!validFourContext(context,now))return value;
  const alignedSignal=value.signal!=='WAIT'&&context.reading.bias===value.readings['1h'].bias?value.signal:'WAIT';
  const alignment=value.stale||value.alignment==='UNAVAILABLE'?'UNAVAILABLE':alignedSignal!=='WAIT'?'ALIGNED':value.signal!=='WAIT'&&context.reading.bias!=='WAIT'?'CONFLICT':'MIXED';
  return {...value,fourContext:context,fourStatus:now-context.at<=MAX_AGE?'live':'saved',baselineFourHoursMinutes:context.baselineMinutes,alignedSignal,alignment,readings:{...value.readings,'4h':context.reading},rows:value.rows.map(c=>({...c,changes:{...c.changes,'4h':null}}))};
}
export function safeSnapshot(value:Compass,now=Date.now()):Compass {
  let result=value;
  if(value.fourContext&&!validFourContext(value.fourContext,now)){
    const r=value.readings['4h'];
    result={...value,fourContext:undefined,fourStatus:'expired',baselineFourHoursMinutes:null,alignedSignal:'WAIT',alignment:'COLLECTING',readings:{...value.readings,'4h':{...r,bias:'WAIT',alt:null,altWithEth:null,smaller:null,btc:null,btcDom:null,usdtDom:null,coverage:0,breadth:{...r.breadth,available:0,up:0,down:0,flat:0,advance:0,median:null},reasons:['Saved 4h observation expired; waiting for collection.']}},rows:value.rows.map(c=>({...c,changes:{...c.changes,'4h':null}}))};
  }
  if(now-result.at<=MAX_AGE&&result.at<=now+30_000)return result;
  return {...result,stale:true,signal:'WAIT',alignedSignal:'WAIT',alignment:'UNAVAILABLE',reasons:['Snapshot is stale. Waiting for a fresh provider update.'],readings:{'1h':{...result.readings['1h'],bias:'WAIT'},'15m':{...result.readings['15m'],bias:'WAIT'},'4h':{...result.readings['4h'],bias:'WAIT'}}};
}
