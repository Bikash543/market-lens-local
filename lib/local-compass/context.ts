export type Bar={t:number;o:number;h:number;l:number;c:number};
export function candles(raw:any[],step:number,now=Date.now()):Bar[]{
  const rows=raw.filter(v=>v[8]==='1'&&+v[0]+step<=now).map(v=>({t:+v[0],o:+v[1],h:+v[2],l:+v[3],c:+v[4]})).sort((a,b)=>a.t-b.t);
  if(rows.length<30||now-rows.at(-1)!.t-step>step+120_000||rows.some((b,i)=>![b.t,b.o,b.h,b.l,b.c].every(Number.isFinite)||b.l<=0||b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c)||(i>0&&b.t-rows[i-1].t!==step)))throw new Error('Closed BTC candles are incomplete or stale');
  return rows;
}
export function structure(rows:Bar[]){
  const highs:Bar[]=[],lows:Bar[]=[];
  for(let i=2;i<rows.length-2;i++){
    const window=rows.slice(i-2,i+3),b=rows[i];
    if(window.every((v,j)=>j===2||v.h<b.h))highs.push(b);
    if(window.every((v,j)=>j===2||v.l>b.l))lows.push(b);
  }
  const h=highs.slice(-2),l=lows.slice(-2);
  if(h.length<2||l.length<2)return 'No confirmed swing sequence';
  return h[1].h>h[0].h&&l[1].l>l[0].l?'Higher highs / higher lows':h[1].h<h[0].h&&l[1].l<l[0].l?'Lower highs / lower lows':'Mixed swing structure';
}
export function breakout(rows:Bar[]){
  const last=rows.at(-1)!,prior=rows.slice(-13,-1);
  const high=Math.max(...prior.map(b=>b.h)),low=Math.min(...prior.map(b=>b.l));
  if(last.c>high)return 'Closed above the prior 12-bar range';
  if(last.c<low)return 'Closed below the prior 12-bar range';
  return 'Inside the prior 12-bar range';
}
export function spotFlow(raw:any[],now=Date.now()){
  if(raw.some(v=>v[1]===''||v[1]==null||v[2]===''||v[2]==null))throw new Error('Missing spot volume');
  const rows=raw.map(v=>({at:+v[0]+300000,sell:+v[1],buy:+v[2]})).filter(v=>v.at<=now).sort((a,b)=>a.at-b.at).slice(-12);
  if(rows.length!==12||now-rows.at(-1)!.at>600000||rows.some((v,i)=>!Number.isFinite(v.sell)||!Number.isFinite(v.buy)||v.sell<0||v.buy<0||(i>0&&v.at-rows[i-1].at!==300000)))throw new Error('Incomplete closed spot-flow hour');
  const volume=rows.reduce((s,v)=>s+v.buy+v.sell,0);
  if(volume<=0)throw new Error('No measured spot taker volume');
  const delta=rows.reduce((s,v)=>s+v.buy-v.sell,0);
  return {at:rows.at(-1)!.at,imbalance:delta/volume*100,delta,volume};
}
export type Interest={at:number;values:Record<string,number>};
export function interest(raw:any[],now=Date.now()):Interest{
  const relevant=raw.filter(v=>v.instId?.endsWith('-USDT-SWAP'));
  const rows=relevant.filter(v=>+v.oiUsd>0&&Number.isFinite(+v.oiUsd)&&now-(+v.ts)<=180000&&+v.ts<=now+10000);
  if(rows.length<50||rows.length<relevant.length*.9)throw new Error('Incomplete or stale OKX open interest');
  return {at:Math.min(...rows.map(v=>+v.ts)),values:Object.fromEntries(rows.map(v=>[v.instId,+v.oiUsd]))};
}
export function compareInterest(current:Interest,history:Interest[],minutes:number){
  const target=current.at-minutes*60000,tolerance=minutes===15?180000:300000;
  const baseline=history.filter(v=>v.at<current.at&&Math.abs(v.at-target)<=tolerance).sort((a,b)=>Math.abs(a.at-target)-Math.abs(b.at-target))[0];
  if(!baseline)return null;
  const keys=Object.keys(current.values).filter(k=>baseline.values[k]>0);
  if(keys.length<Object.keys(current.values).length*.9)return null;
  const before=keys.reduce((s,k)=>s+baseline.values[k],0),after=keys.reduce((s,k)=>s+current.values[k],0);
  return {change:(after/before-1)*100,minutes:(current.at-baseline.at)/60000,count:keys.length};
}
