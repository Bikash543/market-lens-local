import {writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url),origin='http://127.0.0.1:8787';
async function get(path,body){
  const r=await fetch(origin+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
  const d=await r.json();if(!r.ok)throw new Error(d.error||r.status);return d;
}
const market=await get('/api/market');
const result={at:new Date().toISOString(),exchange:market.exchange,contracts:market.rows.length,feeds:[],direction:null,confirmation:null};
for(const coin of ['BTC','ETH','SOL','AGLD','SUI','SEI','LTC'])for(const interval of ['15m','1h']){
  const start=Date.now(),d=await get('/api/scan',{symbols:[coin+'USDT'],interval,exchange:market.exchange}),a=d.rows[0];
  result.feeds.push({coin,interval,ok:!a.error,error:a.error??null,closedAt:a.closedAt,oiAt:a.oiAt,ms:Date.now()-start});
  console.log(coin,interval,a.error||'PASS');
  await new Promise(resolve=>setTimeout(resolve,1600));
}
try{const d=await get('/api/direction');result.direction={source:d.source,at:d.at,fourStatus:d.fourStatus,historyMinutes:d.historyMinutes}}
catch(e){result.direction={error:e.message}}
try{const d=await get('/api/confirmation',{symbol:'ETH',side:'AUTO'});result.confirmation={symbol:d.symbol,verdict:d.verdict,passed:d.passed,required:d.required,errors:d.errors,checks:d.checks.map(c=>({name:c.name,state:c.state,value:c.value}))}}
catch(e){result.confirmation={error:e.message}}
await mkdir(new URL('data/verification/',root),{recursive:true});
await writeFile(new URL('data/verification/live-feeds.json',root),JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:result.feeds.filter(f=>f.ok).length,total:result.feeds.length,direction:result.direction,confirmation:result.confirmation},null,2));
