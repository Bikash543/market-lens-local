import {env} from 'cloudflare:workers';
import {encodeChart,decodeChart} from './chart-storage';
import {packChart,unpackChart} from './chart-archive';

let ready=false;
export async function initializeLocalStore(){
  if(ready)return;
  await env.DB!.exec(`CREATE TABLE IF NOT EXISTS dominance (time INTEGER PRIMARY KEY,btc REAL NOT NULL,usdt REAL NOT NULL,source TEXT NOT NULL DEFAULT 'CoinGecko');
CREATE TABLE IF NOT EXISTS feed_cache (key TEXT PRIMARY KEY,body TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS observations (time INTEGER PRIMARY KEY,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS market_history (time INTEGER PRIMARY KEY,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS local_settings (key TEXT PRIMARY KEY,body TEXT NOT NULL,updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS local_snapshots (key TEXT PRIMARY KEY,body TEXT NOT NULL,updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS local_analyses (exchange TEXT NOT NULL,symbol TEXT NOT NULL,interval TEXT NOT NULL,body TEXT,error TEXT,attempted INTEGER NOT NULL,PRIMARY KEY(exchange,symbol,interval));`);
  await env.DB!.exec('CREATE TABLE IF NOT EXISTS local_analysis_details (exchange TEXT NOT NULL,symbol TEXT NOT NULL,interval TEXT NOT NULL,closedAt INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(exchange,symbol,interval,closedAt));');
  await env.DB!.exec('CREATE TABLE IF NOT EXISTS local_chart_candles (id TEXT PRIMARY KEY,body TEXT NOT NULL);');
  await env.DB!.exec('CREATE TABLE IF NOT EXISTS local_retired_plans (key TEXT PRIMARY KEY,reason TEXT NOT NULL,retiredAt INTEGER NOT NULL,expires INTEGER NOT NULL);');
  await env.DB!.exec('CREATE TABLE IF NOT EXISTS local_analysis_schedule(exchange TEXT NOT NULL,symbol TEXT NOT NULL,interval TEXT NOT NULL,closedAt INTEGER,oiAt INTEGER,venue TEXT,horizon TEXT,error TEXT,attempted INTEGER NOT NULL,PRIMARY KEY(exchange,symbol,interval));');
  await env.DB!.exec("INSERT OR IGNORE INTO local_analysis_schedule SELECT exchange,symbol,interval,json_extract(body,'$.closedAt'),json_extract(body,'$.oiAt'),json_extract(body,'$.exchange'),json_extract(body,'$.interval'),error,attempted FROM local_analyses;");
  ready=true;
}
export async function readSetting<T>(key:string):Promise<T|null>{
  const row=await env.DB!.prepare('SELECT body FROM local_settings WHERE key=?').bind(key).first<{body:string}>();
  return row?JSON.parse(row.body):null;
}
export async function writeSetting(key:string,value:unknown){
  await env.DB!.prepare('INSERT INTO local_settings (key,body,updated) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,updated=excluded.updated')
    .bind(key,JSON.stringify(value),Date.now()).run();
}
export async function saveSnapshot(key:string,value:unknown){
  await env.DB!.prepare('INSERT INTO local_snapshots (key,body,updated) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,updated=excluded.updated')
    .bind(key,JSON.stringify(value),Date.now()).run();
  return value;
}
export async function saveAnalysis(exchange:string,symbol:string,interval:string,value:any){
  const attempted=Date.now();
  const metadata=env.DB!.prepare('INSERT INTO local_analysis_schedule(exchange,symbol,interval,closedAt,oiAt,venue,horizon,error,attempted) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(exchange,symbol,interval) DO UPDATE SET closedAt=excluded.closedAt,oiAt=excluded.oiAt,venue=excluded.venue,horizon=excluded.horizon,error=excluded.error,attempted=excluded.attempted')
    .bind(exchange,symbol,interval,value.closedAt??null,value.oiAt??null,value.exchange??exchange,value.interval??interval,value.error?String(value.error).slice(0,1000):null,attempted);
  if(value.error){
    await env.DB!.batch([metadata,env.DB!.prepare('INSERT INTO local_analyses (exchange,symbol,interval,body,error,attempted) VALUES (?,?,?,NULL,?,?) ON CONFLICT(exchange,symbol,interval) DO UPDATE SET error=excluded.error,attempted=excluded.attempted')
      .bind(exchange,symbol,interval,String(value.error).slice(0,1000),attempted)]);
  }else{
    const body=JSON.stringify(value);
    await env.DB!.batch([metadata,env.DB!.prepare('INSERT INTO local_analyses (exchange,symbol,interval,body,error,attempted) VALUES (?,?,?,?,NULL,?) ON CONFLICT(exchange,symbol,interval) DO UPDATE SET body=excluded.body,error=NULL,attempted=excluded.attempted').bind(exchange,symbol,interval,body,attempted)]);
  }
}
// Freeze chart versions only for requested UI snapshots. Background collection
// keeps one latest result per instrument instead of archiving every candle pass.
export async function saveAnalysisDetails(exchange:string,interval:string,values:any[]){
  const valid=values.filter(v=>v&&!v.error&&Number.isSafeInteger(v.closedAt)&&v.candles?.length);
  for(const value of valid){
    const exists=await env.DB!.prepare('SELECT 1 FROM local_analysis_details WHERE exchange=? AND symbol=? AND interval=? AND closedAt=?').bind(exchange,value.symbol,interval,value.closedAt).first();
    if(exists)continue;
    const encoded=await encodeChart(value);
    const archivedBody=await packChart(encoded.body);
    await env.DB!.batch([
      ...encoded.rows.map(r=>env.DB!.prepare('INSERT OR IGNORE INTO local_chart_candles(id,body) VALUES (?,?)').bind(r.id,r.body)),
      env.DB!.prepare('INSERT OR IGNORE INTO local_analysis_details(exchange,symbol,interval,closedAt,body) VALUES (?,?,?,?,?)').bind(exchange,value.symbol,interval,value.closedAt,archivedBody)
    ]);
  }
}
export async function hydrateChart(value:any){
  value=await unpackChart(value);
  if(value?.storageVersion!==2)return value;
  if(!Array.isArray(value.candleRefs)||value.candleRefs.length>100)throw new Error('Invalid saved candle references');
  const rows=await env.DB!.prepare('SELECT id,body FROM local_chart_candles WHERE id IN ('+value.candleRefs.map(()=>'?').join(',')+')').bind(...value.candleRefs).all<{id:string;body:string}>();
  return decodeChart(value,rows.results);
}

export function json(value:unknown,status=200){
  return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
}
