// Run against the already-started local app; no hosted site is touched.
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {signal,analysisCurrent} from '../lib/engine.ts';
const base='http://127.0.0.1:8787';
const report={at:new Date().toISOString(),scans:[],features:[]};
async function request(path,body){
  const start=performance.now();
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(55000)});
  const data=await response.json();
  if(!response.ok)throw new Error(`${path}: ${response.status} ${data.error}`);
  return {data,ms:Math.round(performance.now()-start)};
}
const dominance=(await request('/api/global')).data;
for(const interval of ['15m','1h']){
  for(const coin of ['BTC','ETH','SOL','AGLD','SUI','SEI','LTC']){
    const symbol=coin+'USDT';
    try{
      const {data,ms}=await request('/api/scan',{exchange:'Binance',interval,symbols:[symbol],selected:true});
      const a=data.rows?.[0];assert.ok(a,'Scan returns a row');
      if(a.error){report.scans.push({symbol,interval,ms,error:a.error});continue;}
      const now=Date.now();assert.ok(analysisCurrent(a,now),'Fresh validated result');
      assert.equal(a.symbol,symbol);assert.equal(a.interval,interval);
      assert.ok(a.candles.length>0);
      const compact={...a,candles:[],cvdSeries:[]};
      assert.deepEqual(signal(a,dominance,now),signal(compact,dominance,now));
      const detail=(await request(`/api/local/analysis-detail?exchange=Binance&symbol=${symbol}&interval=${interval}&closedAt=${a.closedAt}`)).data;
      assert.deepEqual(detail.candles,a.candles);assert.deepEqual(detail.cvdSeries,a.cvdSeries);
      const result=signal(a,dominance,now);
      report.scans.push({symbol,interval,ms,closedAt:a.closedAt,oiAt:a.oiAt,signal:result.label,score:result.score,chartMatches:true,compactSignalMatches:true});
    }catch(e){report.scans.push({symbol,interval,error:e.message});}
    console.log(JSON.stringify(report.scans.at(-1)));
  }
}
for(const path of ['/api/direction','/api/direction?kind=btc','/api/direction?kind=oi','/api/direction?kind=flow','/api/confirmation/symbols','/api/local/profile']){
  try{const {data,ms}=await request(path);report.features.push({path,ms,error:data.error??null,stale:data.stale??false,keys:Object.keys(data),data});}
  catch(e){report.features.push({path,error:e.message});}
  console.log(JSON.stringify({...report.features.at(-1),data:undefined}));
}
for(const symbol of ['BTC','ETH','SOL','AGLD','SUI','SEI','LTC']){
  try{
    const {data,ms}=await request('/api/confirmation',{symbol,side:'AUTO'});
    report.features.push({path:`confirmation:${symbol}`,ms,data});
    console.log(JSON.stringify({confirmation:symbol,ms,verdict:data.verdict,passed:data.passed,errors:data.errors}));
  }catch(e){report.features.push({path:`confirmation:${symbol}`,error:e.message});console.log(e.message);}
}
report.status=(await request('/api/local/status')).data;
await mkdir('data/verification',{recursive:true});
await writeFile('data/verification/efficiency-signals.json',JSON.stringify(report,null,2));
console.log('Saved data/verification/efficiency-signals.json');
