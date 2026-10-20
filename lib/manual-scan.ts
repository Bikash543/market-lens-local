export type ScanProgress={total:number;completed:number;succeeded:number;failed:number;active:number;cancelled:boolean};

// Pagination and signal/search filters are presentation only. A market refresh
// covers the whole venue; a watchlist refresh covers only current watchlist members.
export function manualScanTargets(rows:{symbol:string}[],selected:string,options:{onlySelected?:boolean;watchOnly?:boolean;watch?:string[]}={}){
  const eligible=[...new Set(rows.map(r=>r.symbol))].filter(s=>options.onlySelected?s===selected:!options.watchOnly||options.watch?.includes(s));
  return eligible.includes(selected)?[selected,...eligible.filter(s=>s!==selected)]:eligible;
}

// One finite pass per user click. Bounded concurrency, paced starts, no polling
// or automatic retries. A stalled or rejected asset cannot block the whole queue.
export async function runManualScan<T>(options:{
  symbols:string[];signal:AbortSignal;spacingMs?:number;concurrency?:number;timeoutMs?:number;
  run:(symbol:string,signal:AbortSignal)=>Promise<T>;
  success:(symbol:string,result:T)=>void;failure:(symbol:string,error:unknown)=>void;
  progress:(remaining:number,state:ScanProgress)=>void;
}){
  const symbols=[...new Set(options.symbols)];
  let cursor=0,nextStart=0;
  const state:ScanProgress={total:symbols.length,completed:0,succeeded:0,failed:0,active:0,cancelled:false};
  const report=()=>options.progress(state.total-state.completed,{...state,cancelled:options.signal.aborted});
  const pause=(ms:number)=>new Promise<void>(resolve=>{
    const finish=()=>{clearTimeout(timer);options.signal.removeEventListener('abort',finish);resolve()};
    const timer=setTimeout(finish,ms);
    options.signal.addEventListener('abort',finish,{once:true});
    if(options.signal.aborted)finish();
  });
  const runOne=async(symbol:string)=>{
    const abort=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    let rejectAbort:(error:unknown)=>void=()=>{};
    const cancelled=new Promise<never>((_,reject)=>{rejectAbort=reject});
    const stop=()=>{abort.abort();rejectAbort(new Error('Scan stopped'))};
    options.signal.addEventListener('abort',stop,{once:true});
    timer=setTimeout(()=>{
      abort.abort();
      rejectAbort(new Error('Analysis timed out. Click Refresh to retry.'));
    },options.timeoutMs??30000);
    try{
      if(options.signal.aborted)stop();
      return await Promise.race([Promise.resolve().then(()=>{abort.signal.throwIfAborted();return options.run(symbol,abort.signal)}),cancelled]);
    }finally{clearTimeout(timer);options.signal.removeEventListener('abort',stop)}
  };
  const worker=async()=>{
    while(cursor<symbols.length&&!options.signal.aborted){
      const symbol=symbols[cursor++];
      const at=Math.max(Date.now(),nextStart);nextStart=at+(options.spacingMs??1600);
      if(at>Date.now())await pause(at-Date.now());
      if(options.signal.aborted)break;
      state.active++;report();
      try{
        const value=await runOne(symbol);
        if(!options.signal.aborted){state.succeeded++;options.success(symbol,value)}
      }catch(error){
        if(!options.signal.aborted){state.failed++;options.failure(symbol,error)}
      }finally{
        state.active--;state.completed=state.succeeded+state.failed;report();
      }
    }
  };
  report();
  await Promise.all(Array.from({length:Math.min(symbols.length,Math.max(1,Math.min(4,options.concurrency??1)))},worker));
  report();
}
