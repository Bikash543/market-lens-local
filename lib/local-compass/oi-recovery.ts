import {env} from 'cloudflare:workers';
import {sharedOKX} from '../shared-feeds';
import {compareInterest,type Interest} from './context';
import {cryptoInterest,cryptoHistory,CRYPTO_OI_UNIVERSE} from '../oi-universe';
import {OI_HISTORY_PREFIX,fetchHistoryBatch,usableHistory,recoveryPlan,historicalUpgrades,normalizeOIRecord,type OIRecord} from './oi-history';

const RECOVERY_LOOKBACK_MS=6*3600000;
async function inputs(){
  const [raw,instruments]=await Promise.all([
    sharedOKX('/api/v5/public/open-interest?instType=SWAP',120000),
    sharedOKX('/api/v5/public/instruments?instType=SWAP',3600000)
  ]);
  const {current,coverage:universeCoverage}=cryptoInterest(raw,instruments);
  const [observations,records]=await Promise.all([
    env.DB!.prepare('SELECT body FROM observations WHERE time >= ? ORDER BY time').bind(current.at-RECOVERY_LOOKBACK_MS).all<{body:string}>(),
    env.DB!.prepare('SELECT body FROM feed_cache WHERE key LIKE ? AND expires>?').bind(OI_HISTORY_PREFIX+'%',Date.now()).all<{body:string}>()
  ]);
  const history=cryptoHistory(observations.results.map(v=>JSON.parse(v.body) as Interest),current);
  const cryptoRecords=records.results.map(v=>JSON.parse(v.body) as OIRecord).filter(r=>current.values[r.instId]>0).map(normalizeOIRecord);
  return {current,universeCoverage,history,records:cryptoRecords};
}
function comparisons(current:Interest,history:Interest[]){
  return {quarter:compareInterest(current,history,15),hour:compareInterest(current,history,60),fourHour:compareInterest(current,history,240)};
}
export async function aggregateInterest(){
  const {current,universeCoverage,history,records}=await inputs();
  await env.DB!.batch([
    env.DB!.prepare('INSERT OR IGNORE INTO observations(time,body) VALUES (?,?)').bind(current.at,JSON.stringify(current)),
    env.DB!.prepare('DELETE FROM observations WHERE time<?').bind(current.at-86400000)
  ]);
  const windows=comparisons(current,[...history,...usableHistory(current,records)]);
  const {jobs,...recovery}=recoveryPlan(current,history,records);
  return {at:current.at,total:Object.values(current.values).reduce((s,v)=>s+v,0),count:Object.keys(current.values).length,...windows,
    recovery,universe:CRYPTO_OI_UNIVERSE,universeCoverage,source:'OKX crypto USDT perpetuals',scope:'Crypto only · active USDT perpetual futures',
    note:'Only OKX crypto-category active linear USDT perpetuals are eligible. Both comparison endpoints use the same crypto contracts. USD notional includes price effects. At least 90% of crypto contracts and current USD notional must match; recovery continues toward 100% coverage. Screen updates remain manual.'};
}

export async function recoverAggregateInterest(){
  const owner=crypto.randomUUID(),key='lease:oi-history:worker';
  const acquired=await env.DB!.prepare('INSERT INTO feed_cache(key,body,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires=excluded.expires WHERE feed_cache.expires<=? RETURNING key')
    .bind(key,owner,Date.now()+60000,Date.now()).first();
  if(!acquired)return {state:'busy',retryAfterMs:5000};
  try{
    const {current,history,records}=await inputs();
    const plan=recoveryPlan(current,history,records);
    const result=plan.jobs.length?await fetchHistoryBatch(plan.jobs,records,{
      fetch:id=>sharedOKX(`/api/v5/rubik/stat/contracts/open-interest-history?instId=${encodeURIComponent(id)}&period=5m&limit=100`,60000,5000),
      save:r=>env.DB!.prepare('INSERT INTO feed_cache(key,body,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires=excluded.expires')
        .bind(OI_HISTORY_PREFIX+r.instId,JSON.stringify(r),Date.now()+12*3600000).run()
    }):{records,fetched:0,retryAfterMs:1000};
    // Keep persistence inside the same range read by inputs(). Older API points
    // cannot serve these <=4h windows and would otherwise be resubmitted forever.
    const recovered=usableHistory(current,result.records).filter(s=>s.at>=current.at-RECOVERY_LOOKBACK_MS);
    // Persist real, aligned history so a restart or closed browser loses no progress.
    // A richer recovered point can replace an older partial historical point;
    // it never overwrites an original locally collected observation.
    const upgrades=historicalUpgrades(history,recovered);
    if(upgrades.length)await env.DB!.batch(upgrades.map(s=>env.DB!.prepare("INSERT INTO observations(time,body) VALUES (?,?) ON CONFLICT(time) DO UPDATE SET body=excluded.body WHERE json_extract(observations.body,'$.source')='OKX historical API' AND observations.body<>excluded.body").bind(s.at,JSON.stringify(s))));
    const {jobs,...status}=recoveryPlan(current,[...history,...upgrades],result.records);
    return {...status,fetched:result.fetched,snapshotsWritten:upgrades.length,
      retryAfterMs:status.state==='ready'?300000:jobs.length?result.retryAfterMs:60000};
  }finally{await env.DB!.prepare('DELETE FROM feed_cache WHERE key=? AND body=?').bind(key,owner).run()}
}
