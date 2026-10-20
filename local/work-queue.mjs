// One Node-owned queue for collector + UI requests. No cross-request Worker
// promises. Identical jobs coalesce; ageing prevents background starvation.
export function createWorkQueue({run,concurrency=2,spacingMs=1600,timeoutMs=20000,maxQueued=100,now=Date.now}){
  const jobs=new Map();let active=0,nextStart=0,timer=null,closed=false;
  const metrics={submitted:0,coalesced:0,completed:0,failed:0};
  function pump(){
    clearTimeout(timer);timer=null;
    if(closed||active>=concurrency)return;
    const waiting=[...jobs.values()].filter(j=>!j.started);
    if(!waiting.length)return;
    if(now()<nextStart){timer=setTimeout(pump,nextStart-now());return}
    waiting.sort((a,b)=>(b.priority+Math.floor((now()-b.at)/5000))-(a.priority+Math.floor((now()-a.at)/5000))||a.at-b.at);
    const job=waiting[0];job.started=true;active++;nextStart=now()+(typeof spacingMs==='function'?spacingMs(job.value):spacingMs);
    const controller=new AbortController();
    const deadline=setTimeout(()=>controller.abort(new Error('Shared scan timed out')),timeoutMs);
    const cancelled=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true}));
    Promise.race([Promise.resolve().then(()=>run(job.value,controller.signal)),cancelled]).then(value=>{
      metrics.completed++;job.resolve(value);
    },error=>{metrics.failed++;job.reject(error)}).finally(()=>{
      clearTimeout(deadline);active--;jobs.delete(job.key);pump();
    });
    pump();
  }
  return {
    submit(key,value,priority=0){
      metrics.submitted++;
      const existing=jobs.get(key);
      if(existing){metrics.coalesced++;existing.priority=Math.max(existing.priority,priority);return existing.promise}
      if(closed||jobs.size>=maxQueued)return Promise.reject(new Error('Shared scan queue is busy'));
      let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});
      jobs.set(key,{key,value,priority,at:now(),started:false,promise,resolve,reject});pump();return promise;
    },
    stats:()=>({...metrics,active,queued:[...jobs.values()].filter(j=>!j.started).length}),
    close(){closed=true;clearTimeout(timer);for(const [key,j] of jobs)if(!j.started){j.reject(new Error('Collector stopped'));jobs.delete(key)}}
  };
}
