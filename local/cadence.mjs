// Keep sample start times aligned. Skip missed slots after sleep instead of
// issuing a burst, and never add request duration to every collection period.
export function nextCollectionAt(previous,period,now=Date.now()){
  if(!Number.isFinite(previous)||!Number.isFinite(now)||!(period>0))throw new Error('Invalid collection cadence');
  return previous+Math.max(1,Math.floor((now-previous)/period)+1)*period;
}
