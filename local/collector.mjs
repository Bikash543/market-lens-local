import {mkdir,writeFile,rename,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {retryPolicy} from './retry-policy.mjs';
import {nextCollectionAt} from './cadence.mjs';
import {recoverHistory} from './recover-history.mjs';
import {dataReadiness} from '../lib/data-readiness.mjs';

export async function runCollector({root,dataDirectory=path.join(root,'data'),origin='http://127.0.0.1:8787',signal:parentSignal,log}){
  const lifetime=new AbortController(),signal=AbortSignal.any([parentSignal,lifetime.signal]);
  let rows=[],exchange='',watch=[],lastProfile=0,scanCooldown=0;
  const attempted=new Map(),pending=new Set(),due=new Map(),failures=new Map();
  const state={startedAt:Date.now(),phase:'Starting collector',marketAt:null,contextAt:null,directionAt:null,nextContextAt:null,contextFeeds:{},scanned:0,loaded:0,failed:0,reused:0,recovery:null,errors:[]};
  const pause=ms=>sleep(ms,undefined,{signal}).catch(()=>{});
  function failure(label,e){
    const text=`${new Date().toISOString()} · ${label}: ${e.message||e}`;
    state.errors=[text,...state.errors].slice(0,12);log(text);
  }
  async function request(route,body,timeout=25000){
    const r=await fetch(origin+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)])});
    const text=await r.text();let d;
    try{d=JSON.parse(text)}catch{throw new Error(`Local API ${r.status}: ${text.slice(0,240)}`)}
    if(!r.ok)throw new Error(d.error||`Local API ${r.status}`);return d;
  }
  async function heartbeat(){
    try{await request('/api/local/status',{...state,universe:rows.length,exchange,watchCount:watch.length},5000)}
    catch(e){if(!signal.aborted)log(`Heartbeat: ${e.message}`)}
  }
  async function profile(){
    if(Date.now()-lastProfile<60000)return;
    const p=await request('/api/local/profile',undefined,5000);watch=p.watchlist;lastProfile=Date.now();
  }
  async function backup(){
    const directory=path.join(dataDirectory,'backups');await mkdir(directory,{recursive:true});
    const name=`history-${new Date().toISOString().slice(0,10)}.json`;
    const files=await readdir(directory);
    if(files.includes(name))return;
    const data=await request('/api/local/backup',undefined,20000),target=path.join(directory,name);
    await writeFile(target+'.tmp',JSON.stringify(data));await rename(target+'.tmp',target);
    // Keep fourteen complete daily JSON backups, entirely inside this directory.
    const old=files.filter(f=>/^history-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0,-13);
    for(const file of old)await unlink(path.join(directory,file));
    log('Daily settings/history backup saved.');
  }
  async function quotes(){
    let next=Date.now();
    while(!signal.aborted){
      await pause(Math.max(0,next-Date.now()));if(signal.aborted)break;
      try{
        const market=await request('/api/market');
        if(!market.stale&&market.rows?.length){rows=market.rows;exchange=market.exchange;state.marketAt=market.updated}
        await profile();
        // One bulk read per horizon refreshes funding independently and skips
        // already completed candle windows, including after service restarts.
        for(const interval of ['15m','1h']){
          if(signal.aborted||!rows.length)break;
          const saved=await request(`/api/local/work-status?exchange=${exchange}&interval=${interval}`);
          const step=interval==='15m'?900000:3600000;
          for(const row of saved.rows??[]){
            if(!row.error&&row.venue===exchange&&row.horizon===interval&&row.closedAt===Math.floor(Date.now()/step)*step-1&&Math.abs(row.oiAt-(row.closedAt+1))<60000){due.set(`${exchange}:${row.symbol}:${interval}`,Math.floor(Date.now()/step)*step+step+15000);state.reused++}
          }
        }
      }catch(e){if(!signal.aborted)failure('Market snapshot',e)}
      next=nextCollectionAt(next,60000);
    }
  }
  async function collectContext(route){
    const attemptedAt=Date.now();
    try{
      const result=await request(route),kind=route==='/api/global'?'global':new URL(route,origin).searchParams.get('kind')||'market';
      const readiness=dataReadiness(kind,result);
      const error=result.stale?(result.refreshError||'Provider snapshot is stale'):null;
      state.contextFeeds[route]={attemptedAt,completedAt:Date.now(),observationAt:result.at??result.updated??null,error,...readiness};
      state.contextAt=Date.now();if(route==='/api/direction')state.directionAt=result.at;
      if(error)failure(route,new Error(error));
    }catch(e){
      state.contextFeeds[route]={attemptedAt,completedAt:Date.now(),ready:false,error:e.message};
      if(!signal.aborted)failure(route,e);
    }
  }
  async function directionLoop(){
    let next=Date.now();
    while(!signal.aborted){
      await pause(Math.max(0,next-Date.now()));if(signal.aborted)break;
      await collectContext('/api/direction');
      next=nextCollectionAt(next,60000);
    }
  }
  async function oiHistoryLoop(){
    let restarts=0;
    while(!signal.aborted){
      let delay=60000;
      try{
        const result=await request('/api/local/oi-history',{},25000);
        restarts=0;
        state.oiHistory={...result,checkedAt:Date.now()};
        delay=Math.max(1000,Math.min(300000,result.retryAfterMs||60000));
      }catch(e){
        // A local worker can restart between idempotent recovery batches.
        // Resume from disk promptly, without shortening upstream cooldowns.
        if(/worker restarted mid-request/i.test(e.message))delay=Math.min(60000,3000*2**Math.min(restarts++,4));
        if(!signal.aborted)failure('OI historical recovery',e);
      }
      await pause(delay);
    }
  }
  async function contexts(){
    let next=Date.now(),lastCycle=0;
    while(!signal.aborted){
      state.nextContextAt=next;
      await pause(Math.max(0,next-Date.now()));if(signal.aborted)break;
      if(!lastCycle||Date.now()-lastCycle>600000)state.recovery=await recoverHistory(root,request,log);
      lastCycle=Date.now();
      // Market history has its own cadence, independent of quote/scan failures.
      // Fetch it first; optional context cannot delay the four-hour baseline.
      for(const route of ['/api/global','/api/direction?kind=btc','/api/direction?kind=oi','/api/direction?kind=flow']){
        if(signal.aborted)break;
        await collectContext(route);
        await pause(1200);
      }
      if(!signal.aborted)try{await backup()}catch(e){failure('Backup',e)}
      next=nextCollectionAt(next,300000);state.nextContextAt=next;
    }
  }
  function nextJob(){
    const now=Date.now(),jobs=[];
    for(const row of rows)for(const interval of ['15m','1h']){
      const key=`${exchange}:${row.symbol}:${interval}`,previous=attempted.get(key)||0;
      if(pending.has(key)||now<(due.get(key)||0)||now-previous<60000)continue;
      jobs.push({key,symbol:row.symbol,interval,exchange,previous,watched:watch.includes(row.symbol)});
    }
    // Waiting age eventually outweighs watchlist priority.
    jobs.sort((a,b)=>(Number(b.watched)*120000+(now-b.previous))-(Number(a.watched)*120000+(now-a.previous)));
    const job=jobs[0];if(job){pending.add(job.key);attempted.set(job.key,now)}return job;
  }
  async function scanLoop(){
    while(!signal.aborted){
      if(Date.now()<scanCooldown){await pause(Math.min(5000,scanCooldown-Date.now()));continue}
      const job=nextJob();if(!job){await pause(2000);continue}
      if(signal.aborted){pending.delete(job.key);break}
      state.phase=`Collecting ${job.symbol} ${job.interval}`;
      try{
        const result=await request('/api/scan',{exchange:job.exchange,symbols:[job.symbol],interval:job.interval,background:true},55000);
        const row=result.rows?.[0];
        if(row?.error&&/rate limit|cooling down|queue is busy/i.test(row.error)){
          // Let the shared exchange endpoint recover instead of walking every
          // contract into the same known cooldown. No alternate host/IP retry.
          scanCooldown=Math.max(scanCooldown,Date.now()+Math.max(5000,Math.min(300000,row.retryAfterMs||60000)));
          state.phase='Exchange cooldown; collection resumes automatically';
        }
        if(!row||row.error)throw Object.assign(new Error(row?.error||'No analysis returned'),{retryAfterMs:row?.retryAfterMs});
        failures.delete(job.key);
        const step=job.interval==='15m'?900000:3600000,boundary=Math.floor(Date.now()/step)*step;
        due.set(job.key,row.closedAt===boundary-1?boundary+step+15000:Date.now()+60000);
        state.loaded++;
      }catch(e){
        const count=(failures.get(job.key)||0)+1;failures.set(job.key,count);
        const policy=retryPolicy(e,count);due.set(job.key,Date.now()+policy.delayMs);
        state.failed++;if(!signal.aborted)failure(`${job.symbol} ${job.interval} (${policy.kind}; retry in ${Math.round(policy.delayMs/1000)}s)`,e);
      }
      finally{state.scanned++;pending.delete(job.key)}
    }
  }
  async function pulseLoop(){
    while(!signal.aborted){await heartbeat();await pause(15000)}
  }
  const tasks=[quotes(),directionLoop(),contexts(),oiHistoryLoop(),scanLoop(),scanLoop(),pulseLoop()];
  try{await Promise.all(tasks)}
  finally{lifetime.abort();await Promise.allSettled(tasks)}
}
