export type RefreshOutcome={kind:'success'|'warning'|'error';title:string;detail:string};
export function refreshOutcome({loaded,failed=0,cancelled=false,detail='',action='Refresh'}:{
  loaded:number;failed?:number;cancelled?:boolean;detail?:string;action?:string;
}):RefreshOutcome{
  if(cancelled)return {kind:'warning',title:`${action} stopped`,detail:detail||'The remaining data was not loaded.'};
  if(failed)return {kind:loaded?'warning':'error',title:loaded?`${action} partially completed`:`${action} failed`,detail:detail||`${failed} data request${failed===1?'':'s'} unavailable. Please try again.`};
  if(!loaded)return {kind:'warning',title:'Nothing to refresh',detail:detail||'Select an asset or add coins to your watchlist.'};
  return {kind:'success',title:`${action} succeeded`,detail:detail||'The latest available data is now displayed.'};
}
