// The exchange adapter owns pacing and timeouts; do not add a second sleep.
// Successful members retain their own cache when another member is unavailable.
export async function flowSample(load:(symbol:string)=>Promise<any>,now=Date.now()){
  const settled=await Promise.all(['SOL','XRP','DOGE','LINK'].map(async symbol=>{
    try{return {row:{symbol,...await load(symbol)},error:null}}
    catch(e){return {row:null,error:`${symbol}: ${e instanceof Error?e.message:'Provider unavailable'}`}}
  }));
  const rows=settled.flatMap(v=>v.row?[v.row]:[]),errors=settled.flatMap(v=>v.error?[v.error]:[]);
  const aligned=rows.length===4&&Math.max(...rows.map(v=>v.at))-Math.min(...rows.map(v=>v.at))<=300000;
  return {at:now,rows,errors,average:aligned?rows.reduce((s,v)=>s+v.imbalance,0)/4:null,source:'OKX spot • four-alt sample',note:'Equal-weight taker imbalance. Not a market-wide USD CVD series.'};
}
