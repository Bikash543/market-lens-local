export type ScanTask={symbol:string;priority:number;updated:number;retryAt?:number};
export function chooseTask(tasks:ScanTask[],active:Set<string>,now:number){
  let chosen:ScanTask|undefined;
  for(const task of tasks){
    if(active.has(task.symbol)||(task.retryAt&&task.retryAt>now))continue;
    if(task.retryAt===undefined&&now-task.updated<(task.priority===0?60000:task.priority<3?120000:360000))continue;
    if(!chosen||task.priority<chosen.priority||(task.priority===chosen.priority&&task.updated<chosen.updated))chosen=task;
  }
  return chosen;
}
export function startScanner<T>(options:{
  tasks:()=>ScanTask[];run:(symbol:string,signal:AbortSignal)=>Promise<T>;
  success:(symbol:string,result:T)=>void;failure:(symbol:string,error:unknown)=>void;
  busy:(count:number)=>void;spacingMs?:number;concurrency?:number;
}){
  const active=new Set<string>(),controller=new AbortController();
  let stopped=false;
  function tick(){
    if(stopped||active.size>=(options.concurrency??3))return;
    const task=chooseTask(options.tasks(),active,Date.now());
    if(!task)return;
    active.add(task.symbol);options.busy(active.size);
    Promise.resolve().then(()=>options.run(task.symbol,controller.signal)).then(
      result=>{if(!stopped)options.success(task.symbol,result)},
      error=>{if(!stopped)options.failure(task.symbol,error)},
    ).finally(()=>{active.delete(task.symbol);if(!stopped)options.busy(active.size)});
  }
  const timer=setInterval(tick,options.spacingMs??1600);
  tick();
  return {stop:()=>{stopped=true;controller.abort();clearInterval(timer);active.clear();options.busy(0)}};
}
