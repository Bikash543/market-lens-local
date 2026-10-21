import {readingReady} from './data-readiness.mjs';

// One status model for the badge and main copy: a recent saved observation is
// usable research context, but is not proof that the latest refresh succeeded.
export function directionDisplay(data:any,{error='',loading=false,savedView=false,requireFour=false,fourReady=false,supportingPending=false}={}){
  const fresh=!!data&&!data.stale;
  const savedIssue=data?.refreshError||data?.sourceSync?.warning||'';
  const issue=error||savedIssue;
  const collected=fresh&&readingReady(data?.readings?.['15m'])&&readingReady(data?.readings?.['1h']);
  const signal=(requireFour?data?.alignedSignal:data?.signal)??'WAIT';
  const state=!fresh?'DATA UNAVAILABLE':!collected?'COLLECTING HISTORY':requireFour&&!fourReady?'COLLECTING 4H':signal;
  const connection=loading?'Refreshing…':!fresh?'Data unavailable':issue?(savedIssue?'Saved data · refresh incomplete':'Refresh incomplete'):data?.refreshing?'Refresh pending':savedView?'Saved snapshot':!collected?'Collecting history':supportingPending?'Market updated · context pending':'Market snapshot updated';
  const copy=!fresh?'Direction is withheld until fresh, aligned data is available.':issue?(savedIssue?'Showing saved data; the latest refresh is incomplete.':'The latest refresh is incomplete. Check the pending feeds below; displayed observations retain their original timestamps.'):loading?'Refreshing feeds; values update as each response arrives.':state.startsWith('COLLECTING')?'The required historical comparison is not available yet.':savedView?'Showing your saved snapshot. Click Refresh to request updated data.':signal==='WAIT'?'The displayed snapshot is valid, but market conditions do not agree.':signal==='LONG BIAS'?'Broad participation in this snapshot is leaning higher.':'Broad participation in this snapshot is leaning lower.';
  return {connection,copy,state,issue,current:!loading&&fresh&&!issue&&!savedView&&!data?.refreshing&&!supportingPending&&collected,cached:fresh&&!!savedIssue};
}
