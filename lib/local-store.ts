import {env} from 'cloudflare:workers';

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
  if(value.error){
    await env.DB!.prepare('INSERT INTO local_analyses (exchange,symbol,interval,body,error,attempted) VALUES (?,?,?,NULL,?,?) ON CONFLICT(exchange,symbol,interval) DO UPDATE SET error=excluded.error,attempted=excluded.attempted')
      .bind(exchange,symbol,interval,String(value.error).slice(0,1000),Date.now()).run();
  }else{
    await env.DB!.prepare('INSERT INTO local_analyses (exchange,symbol,interval,body,error,attempted) VALUES (?,?,?,?,NULL,?) ON CONFLICT(exchange,symbol,interval) DO UPDATE SET body=excluded.body,error=NULL,attempted=excluded.attempted')
      .bind(exchange,symbol,interval,JSON.stringify(value),Date.now()).run();
  }
}
export function json(value:unknown,status=200){
  return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
}
