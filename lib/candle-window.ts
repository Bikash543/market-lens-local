// Cache successful closed price/flow inputs independently of delayed OI.
export function validatedRawCandles(raw:any[],interval:string,now=Date.now()){
  const step=interval==='15m'?900000:interval==='1h'?3600000:0;
  if(!step||!Array.isArray(raw))throw new Error('Invalid candle window');
  const rows=raw.filter(k=>Number(k[6])<now);
  if(rows.length<35||now-Number(rows.at(-1)?.[6])>step+120000)throw new Error('Closed candle window is incomplete or stale');
  if(rows.some((k,i)=>![0,1,2,3,4,6,7,10].every(j=>Number.isFinite(+k[j]))||+k[6]-+k[0]!==step-1||Math.min(+k[1],+k[2],+k[3],+k[4])<=0||+k[2]<Math.max(+k[1],+k[3],+k[4])||+k[3]>Math.min(+k[1],+k[4])||+k[7]<0||+k[10]<0||+k[10]>+k[7]*1.001||(i>0&&+k[0]-+rows[i-1][0]!==step)))throw new Error('Invalid or discontinuous candle data');
  return rows;
}
export function interestTTL(rows:any[],interval:string,now=Date.now()){
  const step=interval==='15m'?900000:3600000,end=Math.floor(now/step)*step;
  const before=rows.find(x=>Math.abs(+x.timestamp-(end-4*step))<60000);
  const after=rows.find(x=>Math.abs(+x.timestamp-end)<60000);
  return before&&after&&[before,after].every(x=>Number.isFinite(+x.sumOpenInterest)&&+x.sumOpenInterest>0)?Math.max(1000,end+step-now):15000;
}
