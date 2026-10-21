import {interestCoverage,bestInterestBaseline,compareInterest,type Interest} from './context';

export const OI_STEP=300000;
export const OI_HISTORY_PREFIX='oi:history:contract:v1:';
export type OIPoint={at:number;usd:number;bucketAt?:number};
export type OIRecord={instId:string;points:OIPoint[];checkedAt:number;retryAt:number;error?:string;failures?:number};
// OKX contract history: [timestamp, contracts, base currency, USD notional].
// Preserve the original bucket timestamp and use its end as availability time,
// consistent with the scanner. Never use a still-forming history bucket.
export function parseOIHistory(raw:unknown,now=Date.now()):OIPoint[]{
  if(!Array.isArray(raw))throw new Error('Malformed OKX OI history');
  const points=new Map<number,number>();
  for(const row of raw){
    if(!Array.isArray(row)||row[0]==null||row[3]==null||row[3]==='')throw new Error('Missing historical USD OI');
    const at=Number(row[0]),usd=Number(row[3]);
    if(!Number.isSafeInteger(at)||at%OI_STEP!==0||!Number.isFinite(usd)||usd<0)throw new Error('Invalid historical OI timestamp or USD value');
    if(at+OI_STEP>now||at<now-12*3600000)continue;
    if(points.has(at)&&points.get(at)!==usd)throw new Error('Conflicting historical OI timestamp');
    points.set(at,usd);
  }
  if(!points.size)throw new Error('No recent historical OI available');
  return [...points].map(([bucketAt,usd])=>({at:bucketAt+OI_STEP,bucketAt,usd})).sort((a,b)=>a.at-b.at).slice(-100);
}
// Upgrade the recovery cache created during development without downloading
// valid records twice. A point's original receipt time still gates availability.
export function normalizeOIRecord(r:OIRecord):OIRecord{
  return {...r,points:r.points.map(p=>p.bucketAt===undefined?{...p,bucketAt:p.at,at:p.at+OI_STEP}:p).filter(p=>p.at<=r.checkedAt)};
}
export function historySnapshots(current:Interest,records:OIRecord[]):Interest[]{
  const buckets=new Map<number,Interest>();
  for(const record of records){
    if(!(current.values[record.instId]>0)||!record.instId.endsWith('-USDT-SWAP'))continue;
    for(const p of record.points){
      if(!Number.isFinite(p.usd)||p.usd<=0||p.at%OI_STEP||p.at>=current.at||p.at<current.at-12*3600000)continue;
      const snapshot=buckets.get(p.at)??{at:p.at,values:{},source:'OKX historical API'};
      snapshot.values[record.instId]=p.usd;buckets.set(p.at,snapshot);
    }
  }
  return [...buckets.values()].sort((a,b)=>a.at-b.at);
}
export function usableHistory(current:Interest,records:OIRecord[]){
  return historySnapshots(current,records).filter(s=>{const c=interestCoverage(current,s);return c.keys.length>=50&&c.coverage>=.9&&c.notionalCoverage>=.9});
}
export function historyJobs(current:Interest,records:OIRecord[],windows:number[],now=Date.now()){
  if(!windows.length)return [];
  const saved=new Map(records.map(v=>[v.instId,v]));
  return Object.keys(current.values).filter(id=>{
    const r=saved.get(id);if(r&&r.retryAt>now)return false;
    return !r||windows.some(m=>!r.points.some(p=>p.usd>0&&Math.abs(p.at-(current.at-m*60000))<=(m===15?180000:300000)));
  }).sort((a,b)=>current.values[b]-current.values[a]);
}
// Usable (90%) is not complete (100%). Keep requesting unmatched contracts
// even while a partial comparison is available to display. Local full-coverage
// baselines avoid unnecessary history downloads after recovery has finished.
export function recoveryPlan(current:Interest,history:Interest[],records:OIRecord[],now=Date.now()){
  const all=[...history,...historySnapshots(current,records)],ids=Object.keys(current.values);
  const saved=new Map(records.map(r=>[r.instId,r]));
  const windows=[15,60,240].map(minutes=>{
    const best=bestInterestBaseline(current,all,minutes),keys=new Set(best?.keys??[]);
    return {minutes,count:keys.size,total:ids.length,from:best?.baseline.at??null,notionalCoverage:best?.notionalCoverage??0,
      ready:!!compareInterest(current,all,minutes),missing:ids.filter(id=>!keys.has(id))};
  });
  const details=ids.flatMap(instId=>{
    const pending=windows.filter(w=>w.missing.includes(instId)).map(w=>w.minutes);if(!pending.length)return [];
    const record=saved.get(instId);
    return [{instId,windows:pending,reason:record?.error??(record?'No positive OI at the aligned baseline yet':'Not requested yet'),retryAt:record?.retryAt??0}];
  });
  const jobs=details.filter(v=>v.retryAt<=now).map(v=>v.instId).sort((a,b)=>
    Number(saved.has(a))-Number(saved.has(b))||(saved.get(a)?.checkedAt??0)-(saved.get(b)?.checkedAt??0)||current.values[b]-current.values[a]);
  const four=windows[2];
  return {jobs,state:details.length?'recovering':'ready',usable:windows.every(w=>w.ready),matched:four.count,total:ids.length,notionalCoverage:four.notionalCoverage,
    remaining:details.length,unattempted:details.filter(d=>!saved.has(d.instId)).length,failed:details.filter(d=>!!saved.get(d.instId)?.error).length,
    windowsPending:windows.filter(w=>!w.ready).map(w=>w.minutes),windowsIncomplete:windows.filter(w=>w.count<w.total).map(w=>w.minutes),
    windows:windows.map(({missing,...w})=>w),details};
}
// Only write new or changed historical snapshots. Merge exact timestamps so
// a later incomplete response cannot erase previously recovered contracts.
export function historicalUpgrades(history:Interest[],recovered:Interest[]):Interest[]{
  const existing=new Map(history.map(s=>[s.at,s]));
  return recovered.flatMap(s=>{
    const old=existing.get(s.at);if(old&&old.source!=='OKX historical API')return [];
    if(old&&Object.entries(s.values).every(([id,value])=>old.values[id]===value))return [];
    return [{...s,values:Object.fromEntries(Object.entries({...old?.values,...s.values}).sort(([a],[b])=>a.localeCompare(b)))}];
  });
}
export function historyProgress(current:Interest,records:OIRecord[]){
  const target=current.at-240*60000;
  const candidates=historySnapshots(current,records).filter(s=>Math.abs(s.at-target)<=300000);
  const best=candidates.map(s=>interestCoverage(current,s)).sort((a,b)=>b.keys.length-a.keys.length||b.notionalCoverage-a.notionalCoverage)[0];
  const relevant=records.filter(r=>current.values[r.instId]>0);
  return {source:'OKX historical API',matched:best?.keys.length??0,total:Object.keys(current.values).length,notionalCoverage:best?.notionalCoverage??0,checked:relevant.length,failed:relevant.filter(r=>r.error).length};
}

// Small resumable batches share the same exchange limiter as normal scans.
// Errors retain prior valid history and defer retries; no fabricated zeroes.
export async function fetchHistoryBatch(jobs:string[],saved:OIRecord[],options:{fetch:(id:string)=>Promise<unknown>;save:(r:OIRecord)=>Promise<unknown>;now?:()=>number;budgetMs?:number}){
  const clock=options.now??Date.now,end=clock()+(options.budgetMs??8000);
  const map=new Map(saved.map(r=>[r.instId,r]));let fetched=0,retryAfterMs=1000;
  for(const id of jobs.slice(0,6)){
    if(clock()>=end)break;
    let record:OIRecord;
    try{record={instId:id,points:parseOIHistory(await options.fetch(id),clock()),checkedAt:clock(),retryAt:clock()+60000};fetched++}
    catch(e){
      const error=e as Error&{retryAfterMs?:number};
      const failures=(map.get(id)?.failures??0)+1;
      const contractDelay=Math.max(60000,Math.min(900000,error.retryAfterMs??60000*2**Math.min(failures-1,4)));
      if(/rate limit|cooling down|queue is busy/i.test(error.message))retryAfterMs=contractDelay;
      record={instId:id,points:map.get(id)?.points??[],checkedAt:clock(),retryAt:clock()+contractDelay,error:error.message.slice(0,300),failures};
    }
    await options.save(record);map.set(id,record);
    if(record.error&&/rate limit|cooling down|queue is busy/i.test(record.error))break;
  }
  return {records:[...map.values()],fetched,retryAfterMs};
}
