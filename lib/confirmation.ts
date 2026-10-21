export type Side='LONG'|'SHORT';
export type State='pass'|'wait'|'missing'|'fail'|'na';
export type Bar={t:number;o:number;h:number;l:number;c:number;v:number};
export type Evidence={id:string;name:string;window:string;state:State;value:string;reason:string;source:string;at:number|null};
export type Pattern={side:Side;level:number;breakAt:number;retestAt:number|null;entry:number|null;stop:number|null;atr:number;rvol:number;invalid:boolean;expired:boolean};
export type Plan={entry:number;stop:number;target1:number;target2:number;riskPct:number;netRR:number;costPct:number;validUntil:number;state:'candidate'|'retired';reason:string};
export type Snapshot={
  symbol:string;at:number;asOf:number|null;price:number|null;change24:number|null;spread:number|null;
  verdict:'LONG SETUP'|'SHORT SETUP'|'WAIT'|'DATA UNAVAILABLE';side:Side;passed:number;required:number;
  checks:Evidence[];reasons:string[];plan:Plan|null;pattern:Pattern|null;
  context:{funding8h:number|null;fundingHours:number|null;btcDom:number|null;usdtDom:number|null;vwap:number|null;marketBias:string};
  errors:string[];provider:'OKX';marketMode:'BASKET PROXY';retryAfterMs:number;expiresAt:number;
};
export type Intrabar={bar:Bar;checkedAt:number};
export type Inputs={symbol:string;q:Bar[]|null;btcQ:Bar[]|null;btcH:Bar[]|null;spot:any[]|null;oi:any[]|null;funding:any|null;ticker:any|null;market:any|null;errors:string[];intrabar?:Intrabar|null};
export const MIN=60000,Q=15*MIN,H=60*MIN;
const mean=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const signed=(x:number,d=2)=>(x>=0?'+':'')+x.toFixed(d);
export function bars(raw:any[],step:number,now=Date.now()):Bar[]{
  if(!Array.isArray(raw))throw new Error('No candle series');
  const result=raw.filter(x=>x[8]==='1'&&+x[0]+step<=now).map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[7]})).sort((a,b)=>a.t-b.t);
  if(result.length<40)throw new Error('Fewer than 40 closed candles');
  if(result.some((b,i)=>!Object.values(b).every(finite)||b.t%step!==0||b.l<=0||b.v<0||b.h<Math.max(b.o,b.c,b.l)||b.l>Math.min(b.o,b.c)||(i>0&&b.t-result[i-1].t!==step)))throw new Error('Incomplete or invalid closed candles');
  // Allow two minutes for publication of the latest fully closed candle.
  if(now-result.at(-1)!.t-step>step+2*MIN)throw new Error('Closed candle series is stale');
  return result;
}
export function averageRange(b:Bar[]):number{
  return mean(b.slice(-15).slice(1).map((x,i)=>{const p=b.slice(-15)[i];return Math.max(x.h-x.l,Math.abs(x.h-p.c),Math.abs(x.l-p.c))}));
}
export function findPattern(b:Bar[],side:Side,now=Date.now()):Pattern|null{
  const sign=side==='LONG'?1:-1;
  let latest:Pattern|null=null;
  for(let i=Math.max(21,b.length-9);i<b.length;i++){
    const before=b.slice(i-20,i),bar=b[i],a=averageRange(b.slice(0,i));
    const level=side==='LONG'?Math.max(...before.map(v=>v.h)):Math.min(...before.map(v=>v.l));
    if(a<=0||sign*(bar.c-level)<=0||sign*(b[i-1].c-level)>0)continue;
    const vol=mean(before.map(v=>v.v));
    const p:Pattern={side,level,breakAt:bar.t+Q,retestAt:null,entry:null,stop:null,atr:a,rvol:vol?bar.v/vol:0,invalid:false,expired:false};
    for(let j=i+1;j<b.length;j++){
      const x=b[j];
      if(sign*(x.c-level)<-.25*a){p.invalid=true;break}
      if(j-i>6)break;
      const touched=side==='LONG'?x.l<=level+.2*a:x.h>=level-.2*a;
      if(touched&&sign*(x.c-level)>0&&sign*(x.c-x.o)>0){
        p.retestAt=x.t+Q;p.entry=x.c;
        const region=b.slice(i,j+1);
        p.stop=side==='LONG'?Math.min(...region.map(v=>v.l))-.25*a:Math.max(...region.map(v=>v.h))+.25*a;
        if(b.slice(j+1).some(v=>sign*(v.c-level)<-.25*a))p.invalid=true;
        break;
      }
    }
    p.expired=p.retestAt?now-p.retestAt>Q:now-p.breakAt>6*Q;
    latest=p;
  }
  return latest;
}
export function spotWindow(raw:any[]|null,end:number):{delta:number;imbalance:number;at:number}|null{
  if(!Array.isArray(raw))return null;
  const wanted=[end-15*MIN,end-10*MIN,end-5*MIN];
  const values=wanted.map(t=>raw.filter(x=>Array.isArray(x)&&+x[0]===t));
  if(values.some(x=>x.length!==1))return null;
  const rows=values.map(x=>x[0]);
  if(rows.some(x=>x[1]===''||x[2]===''||x[1]==null||x[2]==null||![+x[1],+x[2]].every(v=>finite(v)&&v>=0)))return null;
  const delta=rows.reduce((s,x)=>s+(+x[2])-(+x[1]),0),total=rows.reduce((s,x)=>s+(+x[2])+(+x[1]),0);
  return total>0?{delta,imbalance:delta/total*100,at:end}:null;
}
export function interestWindow(raw:any[]|null,end:number):{quarter:number;hour:number;at:number}|null{
  if(!Array.isArray(raw))return null;
  // This endpoint publishes completed 5m buckets under their opening timestamp,
  // just like the screener's OKX OI history. Align availability at bucket end;
  // never use the still-forming bucket that opens at the candle close.
  const point=(t:number)=>{const a=raw.filter(x=>Array.isArray(x)&&+x[0]+5*MIN===t);return a.length===1&&a[0][1]!==''&&+a[0][1]>0&&finite(+a[0][1])?+a[0][1]:null};
  const c=point(end),q=point(end-Q),h=point(end-H);
  return c!==null&&q!==null&&h!==null?{quarter:(c/q-1)*100,hour:(c/h-1)*100,at:end}:null;
}
export function fundingValue(f:any,now:number){
  if(!f||f.fundingRate===''||f.fundingRate==null||!finite(+f.fundingRate)||!finite(+f.ts)||now-(+f.ts)>180000||+f.ts>now+10000)return null;
  const hours=(+f.nextFundingTime-+f.fundingTime)/H;
  if(!finite(hours)||hours<=0||hours>24)return null;
  return {rate8h:+f.fundingRate*8/hours*100,hours};
}
// Forming candles can invalidate an entry, but can never confirm its pattern.
export function formingRange(raw:any[],now=Date.now()):Intrabar{
  const open=Math.floor(now/Q)*Q,rows=raw.filter(x=>+x[0]===open);
  if(rows.length!==1)throw new Error('Current candle range unavailable');
  const x=rows[0],bar={t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[7]};
  if(!Object.values(bar).every(finite)||bar.l<=0||bar.v<0||bar.h<Math.max(bar.o,bar.c,bar.l)||bar.l>Math.min(bar.o,bar.c))throw new Error('Invalid current candle range');
  return {bar,checkedAt:now};
}
export function makePlan(p:Pattern,b:Bar[],price:number|null,now:number,intrabar?:Intrabar|null):Plan|null{
  if(p.entry===null||p.stop===null||p.retestAt===null)return null;
  const s=p.side==='LONG'?1:-1,entry=p.entry,stop=p.stop,risk=s*(entry-stop);
  if(risk<=0||entry<=0)return null;
  const target1=entry+s*risk,target2=entry+s*2*risk;
  if(target1<=0||target2<=0)return null;
  // 0.05% taker fee and 0.02% slippage per side, charged on each fill's notional.
  const perFill=.0007,lossCost=(entry+stop)*perFill,winCost=(entry+target2)*perFill;
  const netRR=(2*risk-winCost)/(risk+lossCost);
  const rangeReady=!!intrabar&&intrabar.checkedAt<=now&&now-intrabar.checkedAt<=15000&&intrabar.bar.t===Math.floor(now/Q)*Q&&intrabar.bar.t>=p.retestAt;
  const after=b.filter(v=>v.t>=p.retestAt!);
  if(rangeReady)after.push(intrabar!.bar);
  const touched=after.some(v=>s===1?v.l<=stop||v.h>=target1:v.h>=stop||v.l<=target1)||(price!==null&&(s*(price-stop)<=0||s*(price-target1)>=0));
  const chased=price===null||Math.abs(price-entry)>.5*p.atr;
  const tooFar=risk/entry>.05;
  const prior=b.filter(x=>x.t+Q<=p.breakAt);
  const obstacles:number[]=[];
  for(let i=2;i<prior.length-2;i++){
    const key=s===1?'h':'l',v=prior[i][key];
    if(prior.slice(i-2,i+3).every((x,j)=>j===2||s*(v-x[key])>0)&&s*(v-entry)>0&&s*(v-target2)<0)obstacles.push(v);
  }
  const retired=p.invalid||p.expired||touched||!rangeReady||chased||tooFar||netRR<1.5||obstacles.length>0;
  const reason=touched?'Stop or first target already touched; do not reuse this plan.':p.invalid?'Retest level was reclaimed against the setup.':p.expired?'Retest entry window expired.':!rangeReady?'Fresh current-candle range unavailable; entry withheld.':chased?'Live price is more than 0.5 ATR from the confirmation close.':tooFar?'Structure stop exceeds 5% of entry.':obstacles.length?'A prior confirmed swing obstructs the 2R target.':netRR<1.5?'Estimated reward after costs is below 1.5R.':'Structure stop + 0.25 ATR buffer; targets at 1R and 2R before costs.';
  return {entry,stop,target1,target2,riskPct:risk/entry*100,netRR,costPct:winCost/entry*100,validUntil:p.retestAt+Q,state:retired?'retired':'candidate',reason};
}
export function evaluate(input:Inputs,side:Side,now=Date.now()):Snapshot{
  const {q,btcQ,btcH,market}=input,s=side==='LONG'?1:-1;
  const asOf=q?.at(-1)?.t!=null?q.at(-1)!.t+Q:null;
  const t=input.ticker;
  const freshTicker=t&&t.last!==''&&+t.last>0&&finite(+t.last)&&finite(+t.ts)&&now-(+t.ts)<=120000&&+t.ts<=now+10000;
  const price=freshTicker?+t.last:null;
  const spread=freshTicker&&+t.askPx>0&&+t.bidPx>0&&+t.askPx>=+t.bidPx?(+t.askPx-+t.bidPx)/((+t.askPx+ +t.bidPx)/2)*100:null;
  const p=q?findPattern(q,side,now):null;
  const checks:Evidence[]=[];
  const add=(id:string,name:string,window:string,state:State,value:string,reason:string,source:string,at:number|null)=>checks.push({id,name,window,state,value,reason,source,at});
  const r=market?.readings?.['1h'];
  const marketReady=!!r&&!market.stale&&finite(market.at)&&now-market.at<=10*MIN&&market.at<=now+30000&&r.coverage>=.9&&r.breadth?.available>=50&&finite(r.alt);
  add('market','Overall altcoin direction','1h',!marketReady?'missing':r.bias===side?'pass':'wait',marketReady?`${r.bias} · ${signed(r.alt)}%`:'Collecting',
    'Uses the existing cap-weighted altcoin basket and breadth. This is a labeled proxy, not TOTAL3ES swing structure.','CoinLore / Altcoin Compass',marketReady?market.at:null);
  const btcAligned=!!btcQ&&!!btcH&&!!asOf&&btcQ.at(-1)!.t+Q===asOf;
  const bq=btcAligned?(btcQ!.at(-1)!.c/btcQ!.at(-2)!.c-1)*100:null;
  const bh=btcAligned?(btcH!.at(-1)!.c/btcH!.at(-2)!.c-1)*100:null;
  const btcPass=bq!==null&&bh!==null&&s*bq>=-.1&&s*bh>=-.15;
  add('btc','Bitcoin direction','15m + 1h',!btcAligned?'missing':btcPass?'pass':'fail',bq!==null?`${signed(bq)}% / ${signed(bh!)}%`:'Unavailable','BTC must be stable or support the intended direction. Tolerance: 0.10% on 15m and 0.15% on the last closed hour.','OKX perpetual candles',btcAligned?asOf:null);
  const patternState:State=!q?'missing':!p?'wait':p.invalid?'fail':p.expired?'wait':p.retestAt?'pass':'wait';
  add('structure','Break & retest','15m',patternState,!q?'Unavailable':!p?'No confirmed break':p.invalid?'Invalidated':p.expired?'Expired':p.retestAt?'Retest confirmed':'Waiting for retest',
    'Close beyond the prior 20-bar range, then a separate confirming retest within 6 candles. Only closed bars; 15-minute entry window.','OKX perpetual candles',asOf);
  const flow=asOf?spotWindow(input.spot,asOf):null;
  add('cvd','Spot CVD change','15m',!flow?'missing':s*flow.imbalance>=3?'pass':'wait',flow?`${signed(flow.imbalance,1)}% imbalance`:'Unavailable','Three closed 5m spot taker-volume buckets aligned to the coin candle. Buy minus sell; ≥3% directional imbalance. Futures volume is never substituted.','OKX currency-level SPOT',flow?.at??null);
  const rvol=p?.rvol??(q? q.at(-1)!.v/mean(q.slice(-21,-1).map(v=>v.v)):null);
  add('rvol','Relative volume','15m',rvol===null||!finite(rvol)?'missing':rvol>=1.2?'pass':'wait',rvol!==null&&finite(rvol)?`${rvol.toFixed(2)}×`:'Unavailable',p?'Break candle quote volume / preceding 20-bar mean; needs 1.20×.':'Latest closed candle quote volume / preceding 20-bar mean; needs 1.20×.','OKX perpetual quote volume',p?.breakAt??asOf);
  const oi=asOf?interestWindow(input.oi,asOf):null;
  const coinRet=q?(q.at(-1)!.c/q.at(-5)!.c-1)*100:null;
  add('oi','Open interest participation','15m + 1h',!oi?'missing':(oi.quarter>=.1||oi.hour>=.1)&&coinRet!==null&&s*coinRet>0?'pass':'wait',oi?`${signed(oi.quarter)}% / ${signed(oi.hour)}%`:'Unavailable','Contract-count change from timestamp-matched observations. ≥0.10% in either window with price moving in the setup direction. OI does not identify new longs or shorts.','OKX contract OI history',oi?.at??null);
  const btcRet=btcAligned?(btcQ!.at(-1)!.c/btcQ!.at(-5)!.c-1)*100:null;
  const relative=coinRet!==null&&btcRet!==null?coinRet-btcRet:null;
  add('relative','Relative strength vs BTC','1h',input.symbol==='BTC'?'na':relative===null?'missing':s*relative>=.1?'pass':'wait',input.symbol==='BTC'?'Not applicable':relative===null?'Unavailable':`${signed(relative)} pp`,input.symbol==='BTC'?'BTC is the benchmark, so this check is excluded.':'Coin return minus BTC return across the same four closed 15m candles; needs 0.10 percentage points in the setup direction.','OKX matched perpetual candles',btcAligned?asOf:null);
  const fund=fundingValue(input.funding,now);
  const plan=p&&q?makePlan(p,q,price,now,input.intrabar):null;
  const required=checks.filter(c=>c.state!=='na').length,passed=checks.filter(c=>c.state==='pass').length;
  const reasons=checks.filter(c=>!['pass','na'].includes(c.state)).map(c=>`${c.name}: ${c.value}.`);
  const costCrowding=fund!==null&&s*fund.rate8h>.1;
  if(!fund)reasons.push('Funding rate or settlement interval is unavailable.');
  if(costCrowding)reasons.push('Funding is above 0.10% / 8h against this side.');
  if(spread===null||spread>.15)reasons.push('Fresh spread must be available and no wider than 0.15%.');
  const turnover=freshTicker?+t.volCcy24h*price!:0;
  if(!finite(turnover)||turnover<1e6)reasons.push('At least $1m in 24-hour perpetual turnover is required.');
  if(plan?.state==='retired')reasons.push(plan.reason);
  if(!price)reasons.push('Fresh price quote unavailable.');
  const ready=passed===required&&fund!==null&&!costCrowding&&spread!==null&&spread<=.15&&turnover>=1e6&&plan?.state==='candidate';
  if(!reasons.length)reasons.push(ready?'All applicable checks agree in proxy mode. Review the conditional plan and unconnected event risks.':'Waiting for a fresh structure-based entry plan.');
  const today=q?.filter(b=>new Date(b.t).toISOString().slice(0,10)===new Date(now).toISOString().slice(0,10))??[];
  const volume=today.reduce((a,b)=>a+b.v,0);
  // Quote-volume weighted typical price is deliberately labeled as an estimate.
  const vwap=volume>0?today.reduce((a,b)=>a+((b.h+b.l+b.c)/3)*b.v,0)/volume:null;
  const expiresAt=Math.min(now+90000,plan?.state==='candidate'?plan.validUntil:now+90000,
    freshTicker?+t.ts+120000:now+90000,fund?+input.funding.ts+180000:now+90000,
    marketReady?market.at+10*MIN:now+90000,asOf?asOf+Q+2*MIN:now+90000);
  return {symbol:input.symbol,at:now,asOf,price,change24:freshTicker&&+t.open24h>0?(price!/+t.open24h-1)*100:null,spread,verdict:ready?`${side} SETUP`:checks.some(c=>c.state==='missing')||!price||!fund||spread===null||plan?.reason.startsWith('Fresh current-candle range unavailable')?'DATA UNAVAILABLE':'WAIT',side,passed,required,checks,reasons,plan,pattern:p,context:{funding8h:fund?.rate8h??null,fundingHours:fund?.hours??null,btcDom:marketReady&&finite(r.btcDom)?r.btcDom:null,usdtDom:marketReady&&finite(r.usdtDom)?r.usdtDom:null,vwap,marketBias:marketReady?r.bias:'UNAVAILABLE'},errors:input.errors,provider:'OKX',marketMode:'BASKET PROXY',retryAfterMs:60000,expiresAt};
}
