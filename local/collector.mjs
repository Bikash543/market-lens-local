import {mkdir,writeFile,rename,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {nextCollectionAt} from './cadence.mjs';

export async function runCollector({root,dataDirectory=path.join(root,'data'),origin='http://127.0.0.1:8787',signal:parentSignal,log}){
  const lifetime=new AbortController(),signal=AbortSignal.any([parentSignal,lifetime.signal]);
  let rows=[],exchange='',watch=[],lastProfile=0,nextStart=0,scanCooldown=0;
  const attempted=new Map(),pending=new Set();
  const state={startedAt:Date.now(),phase:'Starting collector',marketAt:null,contextAt:null,directionAt:null,nextContextAt:null,contextFeeds:{},scanned:0,loaded:0,failed:0,errors:[]};
  const pause=ms=>sleep(ms,undefined,{signal}).catch(()=>{});
  function failure(label,e){
    const text=`${new Date().toISOString()} · ${label}: ${e.message||e}`;
    state.errors=[text,...state.errors].slice(0,12);log(text);
  }
  async function request(route,body,timeout=25000){
    const r=await fetch(origin+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)])});
    const d=await r.json();if(!r.ok)throw new Error(d.error||`Local API ${r.status}`);return d;
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
      }catch(e){if(!signal.aborted)failure('Market snapshot',e)}
      next=nextCollectionAt(next,60000);
    }
  }
  async function contexts(){
    let next=Date.now();
    while(!signal.aborted){
      state.nextContextAt=next;
      await pause(Math.max(0,next-Date.now()));if(signal.aborted)break;
      // Market history has its own cadence, independent of quote/scan failures.
      // Fetch it first; optional context cannot delay the four-hour baseline.
      for(const route of ['/api/direction','/api/global','/api/direction?kind=btc','/api/direction?kind=oi','/api/direction?kind=flow']){
        if(signal.aborted)break;
        const attemptedAt=Date.now();
        try{
          const result=await request(route);
          const error=result.stale?(result.refreshError||'Provider snapshot is stale'):null;
          state.contextFeeds[route]={attemptedAt,completedAt:Date.now(),observationAt:result.at??result.updated??null,error};
          if(error)failure(route,new Error(error));
          else{state.contextAt=Date.now();if(route==='/api/direction')state.directionAt=result.at}
        }catch(e){
          state.contextFeeds[route]={attemptedAt,completedAt:Date.now(),error:e.message};
          if(!signal.aborted)failure(route,e);
        }
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
      if(pending.has(key)||now-previous<(watch.includes(row.symbol)?180000:480000))continue;
      jobs.push({key,symbol:row.symbol,interval,exchange,previous,watched:watch.includes(row.symbol)});
    }
    jobs.sort((a,b)=>Number(b.watched)-Number(a.watched)||a.previous-b.previous);
    const job=jobs[0];if(job){pending.add(job.key);attempted.set(job.key,now)}return job;
  }
  async function scanLoop(){
    while(!signal.aborted){
      if(Date.now()<scanCooldown){await pause(Math.min(5000,scanCooldown-Date.now()));continue}
      const job=nextJob();if(!job){await pause(2000);continue}
      const at=Math.max(Date.now(),nextStart);nextStart=at+1600;
      await pause(Math.max(0,at-Date.now()));
      if(signal.aborted){pending.delete(job.key);break}
      state.phase=`Collecting ${job.symbol} ${job.interval}`;
      try{
        const result=await request('/api/scan',{exchange:job.exchange,symbols:[job.symbol],interval:job.interval},22000);
        const row=result.rows?.[0];
        if(row?.error&&/rate limit|cooling down|queue is busy/i.test(row.error)){
          // Let the shared exchange endpoint recover instead of walking every
          // contract into the same known cooldown. No alternate host/IP retry.
          scanCooldown=Math.max(scanCooldown,Date.now()+Math.max(5000,Math.min(300000,row.retryAfterMs||60000)));
          state.phase='Exchange cooldown; collection resumes automatically';
        }
        if(!row||row.error)throw new Error(row?.error||'No analysis returned');
        state.loaded++;
      }catch(e){state.failed++;if(!signal.aborted)failure(`${job.symbol} ${job.interval}`,e)}
      finally{state.scanned++;pending.delete(job.key)}
    }
  }
  async function pulseLoop(){
    while(!signal.aborted){await heartbeat();await pause(15000)}
  }
  const tasks=[quotes(),contexts(),scanLoop(),scanLoop(),pulseLoop()];
  try{await Promise.all(tasks)}
  finally{lifetime.abort();await Promise.allSettled(tasks)}
}
