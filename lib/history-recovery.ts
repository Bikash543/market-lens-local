// Recover only original observations from this application's backup format.
// Never interpolate gaps, multiply hourly returns, or mix provider baselines.
export function recoveryRows(backup:any,now=Date.now()){
  if(backup?.format!=='market-lens-local-backup-v1')throw new Error('Unsupported local backup');
  const inWindow=(t:number)=>Number.isFinite(t)&&t>=now-86400000&&t<=now;
  const market:any[]=[],observations:any[]=[],dominance:any[]=[];
  for(const row of (Array.isArray(backup.marketHistory)?backup.marketHistory:[]).slice(-1000)){
    try{
      const value=JSON.parse(row.body);
      if(row.time!==value.at||!inWindow(value.at)||!value.prices||Object.keys(value.prices).length<50)continue;
      if(Object.entries(value.prices).some(([id,p])=>!/^\d+$/.test(id)||typeof p!=='number'||!Number.isFinite(p)||p<=0))continue;
      market.push({time:value.at,body:JSON.stringify(value)});
    }catch{}
  }
  for(const row of (Array.isArray(backup.observations)?backup.observations:[]).slice(-1000)){
    try{
      const value=JSON.parse(row.body);
      if(row.time!==value.at||!inWindow(value.at)||!value.values||Object.keys(value.values).length<50)continue;
      if(Object.entries(value.values).some(([id,p])=>!/^[A-Z0-9]+-USDT-SWAP$/.test(id)||typeof p!=='number'||!Number.isFinite(p)||p<=0))continue;
      observations.push({time:value.at,body:JSON.stringify(value)});
    }catch{}
  }
  for(const row of (Array.isArray(backup.dominance)?backup.dominance:[]).slice(-2000)){
    if(inWindow(row.time)&&['CoinPaprika','CoinGecko'].includes(row.source)&&[row.btc,row.usdt].every(v=>Number.isFinite(v)&&v>0&&v<=100))dominance.push(row);
  }
  return {market,observations,dominance};
}
