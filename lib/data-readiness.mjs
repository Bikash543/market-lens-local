// Shared by the UI and background collector: transport success is not readiness.
export function readingReady(r){
  return !!r&&r.coverage>=.9&&r.breadth?.available>=50&&r.breadth.available/r.breadth.total>=.9&&[r.alt,r.btc,r.btcDom,r.usdtDom].every(Number.isFinite);
}
export function dataReadiness(kind,value,now=Date.now()){
  const pending=[];
  if(value?.refreshing)pending.push('Provider update is still pending.');
  if(value?.refreshError)pending.push(value.refreshError);
  if(value?.sourceSync?.warning)pending.push(value.sourceSync.warning);
  if(value?.stale)pending.push('The saved snapshot is stale.');
  if(kind==='market'){
    if(!Number.isFinite(value?.at)||now-value.at>600000||value.at>now+30000)pending.push('Fresh intraday observations are unavailable.');
    if(!readingReady(value?.readings?.['15m']))pending.push('15m direction is collecting timestamp-matched history.');
    if(!readingReady(value?.readings?.['1h']))pending.push('1h direction has insufficient aligned coverage.');
    if(!value?.fourContext||now-value.fourContext.at>4500000||!readingReady(value.fourContext.reading))pending.push(value?.fourError||'4h comparison is not ready.');
  }else if(kind==='global'){
    if(value?.historyError)pending.push(value.historyError);
    if(!Number.isFinite(value?.baseline)||!Number.isFinite(value?.btcChange)||!Number.isFinite(value?.usdtChange))pending.push('Comparable ~1h dominance history is pending.');
    if(!Number.isFinite(value?.updated)||now-value.updated>1800000)pending.push('Current dominance is stale.');
  }else if(kind==='oi'){
    if(!Number.isFinite(value?.at)||now-value.at>300000||value.at>now+10000)pending.push('Fresh aggregate OI is unavailable.');
    for(const [key,label] of [['quarter','15m'],['hour','1h'],['fourHour','4h']])if(value?.[key]==null)pending.push(`${label} aggregate OI history is pending.`);
    if(pending.length&&value?.recovery?.state==='recovering')pending.push(`Historical API recovery: ${value.recovery.matched}/${value.recovery.total} contracts matched for 4h. Background recovery continues; click Refresh to display progress.`);
  }else if(kind==='flow'){
    if(value?.errors?.length||!value?.rows?.length||value?.average==null||now-value?.at>600000)pending.push('Some spot-flow data is unavailable.');
  }else if(kind==='btc'){
    if(!value?.hourClose||!value?.quarterClose||now-value.hourClose>=3720000||now-value.quarterClose>=1020000)pending.push('Fresh closed BTC candles are unavailable.');
  }
  return {ready:pending.length===0,pending:[...new Set(pending)]};
}
