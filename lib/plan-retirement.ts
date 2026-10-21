import type {Snapshot} from './confirmation';
export function planKey(s:Snapshot){return s.pattern?.retestAt?`OKX:${s.symbol}:${s.side}:${s.pattern.breakAt}:${s.pattern.retestAt}`:null}
export function touchedPlan(s:Snapshot){return s.plan?.reason.startsWith('Stop or first target already touched')===true}
export function retireSavedPlan(s:Snapshot,reason:string):Snapshot{
  if(!s.plan)return s;
  return {...s,verdict:s.verdict==='DATA UNAVAILABLE'?s.verdict:'WAIT',plan:{...s.plan,state:'retired',reason},reasons:[reason,...s.reasons.filter(r=>r!==reason)]};
}
export async function rememberRetirement(s:Snapshot,store:{read:(key:string)=>Promise<string|null>;write:(key:string,reason:string,expires:number)=>Promise<unknown>}):Promise<Snapshot>{
  const key=planKey(s);if(!key)return s;
  try{
    if(touchedPlan(s))await store.write(key,s.plan!.reason,s.plan!.validUntil+86400000);
    const old=await store.read(key);
    return old?retireSavedPlan(s,old):s;
  }catch{return retireSavedPlan(s,'Saved invalidation history unavailable; entry withheld.')}
}
