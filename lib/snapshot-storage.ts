import { HORIZONS, safeSnapshot, type Compass, type Horizon } from './compass';
export const SNAPSHOT_KEY='compass-market-v2';
export const DIRECTION_VIEW_KEY='market-lens-direction-view-v1';
const RETAIN_FOR=24*60*60_000;
export function restoreSnapshot(text:string|null,now=Date.now()):Compass|null {
  if(!text||text.length>250000)return null;
  try{
    const envelope=JSON.parse(text),v=envelope.snapshot;
    // Keep the last observation visible across navigation and restarts. Safety
    // expiry still withholds its bias; restoration must not erase the view.
    if(envelope.version!==2||!v||!Number.isFinite(v.at)||now-v.at>RETAIN_FOR||v.at>now+30000||!Number.isFinite(v.fetchedAt))return null;
    if(!['LONG BIAS','SHORT BIAS','WAIT'].includes(v.signal)||!Array.isArray(v.reasons)||!Array.isArray(v.rows)||v.rows.length>125)return null;
    if(!HORIZONS.every(h=>v.readings?.[h]?.horizon===h&&v.readings[h].breadth&&Array.isArray(v.readings[h].reasons)))return null;
    if(!v.rows.every((c:any)=>typeof c.id==='string'&&typeof c.symbol==='string'&&typeof c.name==='string'&&c.changes&&HORIZONS.every(h=>c.changes[h]===null||Number.isFinite(c.changes[h]))))return null;
    return safeSnapshot(v,now);
  }catch{return null}
}
export type DirectionView={
  snapshot:Compass|null;
  context:Record<string,any>;
  contextErrors:Record<string,string>;
  horizon:Horizon;
  requireFour:boolean;
  search:string;
  showAll:boolean;
};
export function restoreDirectionView(text:string|null,now=Date.now()):DirectionView|null{
  if(!text||text.length>500000)return null;
  try{
    const v=JSON.parse(text);
    if(v.version!==1)return null;
    const context:Record<string,any>={},contextErrors:Record<string,string>={};
    for(const kind of ['btc','oi','flow']){
      const c=v.context?.[kind];
      if(c&&typeof c==='object'&&Number.isFinite(c.at)&&c.at<=now+30000&&now-c.at<=RETAIN_FOR)context[kind]=c;
      if(typeof v.contextErrors?.[kind]==='string')contextErrors[kind]=v.contextErrors[kind].slice(0,1000);
    }
    return {snapshot:restoreSnapshot(JSON.stringify({version:2,snapshot:v.snapshot}),now),context,contextErrors,
      horizon:HORIZONS.includes(v.horizon)?v.horizon:'15m',requireFour:v.requireFour===true,
      search:typeof v.search==='string'?v.search.slice(0,100):'',showAll:v.showAll===true};
  }catch{return null}
}
export function serializeDirectionView(view:DirectionView){
  return JSON.stringify({version:1,...view});
}
