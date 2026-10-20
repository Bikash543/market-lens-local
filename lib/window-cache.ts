// Closed candles, closed OI and closed taker flow change together at a bar boundary.
// A delayed/misaligned publication must never be cached for an entire new bar.
export function windowCacheMs(interval:string,closedAt:number,now=Date.now()){
  const step=interval==='15m'?900000:3600000;
  const boundary=Math.floor(now/step)*step;
  if(closedAt<boundary-1)return 2000;
  return Math.max(1000,boundary+step-now);
}

// Rubik can publish a closed timestamp before all its trades have arrived.
// Without candle-volume reconciliation, a timestamp alone is not validation.
export function unverifiedWindowCacheMs(interval:string,closedAt:number,now=Date.now()){
  return Math.min(30000,windowCacheMs(interval,closedAt,now));
}
