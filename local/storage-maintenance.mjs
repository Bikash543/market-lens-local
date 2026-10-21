import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';

export const STORAGE_LIMITS={cacheBytes:250_000_000,cacheGraceMs:48*3600000,logFiles:5,logFileBytes:4_000_000};
export function databasePath(root){
  const dir=path.join(process.env.MARKET_LENS_DATA_DIR||path.join(root,'data'),'state/v3/d1/miniflare-D1DatabaseObject');
  return path.join(dir,fs.readdirSync(dir).find(f=>f.endsWith('.sqlite'))||'missing.sqlite');
}
export function trimLogs(root){
  const dir=path.join(process.env.MARKET_LENS_DATA_DIR||path.join(root,'data'),'logs');if(!fs.existsSync(dir))return;
  const files=fs.readdirSync(dir).filter(f=>/^service-\d+\.log$/.test(f)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]));
  for(const name of files.slice(STORAGE_LIMITS.logFiles-1)){
    const file=path.join(dir,name);if(!fs.lstatSync(file).isSymbolicLink()&&path.dirname(fs.realpathSync(file))===fs.realpathSync(dir))fs.unlinkSync(file);
  }
}
export function storageStatus(root){
  const file=databasePath(root),db=new DatabaseSync(file,{readOnly:true});
  try{
    const tables=db.prepare('SELECT name,sum(pgsize) bytes FROM dbstat GROUP BY name ORDER BY bytes DESC').all();
    const cache=db.prepare('SELECT COUNT(*) entries,COALESCE(SUM(length(body)),0) bytes FROM feed_cache').get();
    const reclaim=db.prepare('SELECT COUNT(*) entries,COALESCE(SUM(length(body)),0) bytes FROM feed_cache WHERE expires<?').get(Date.now()-STORAGE_LIMITS.cacheGraceMs);
    return {checkedAt:Date.now(),databaseBytes:fs.statSync(file).size,tables,cache,reclaimableCache:reclaim,limits:STORAGE_LIMITS,
      protected:['Watchlist and settings','Saved analysis/chart versions','Direction baseline history','Original datasets and strategy results'],
      cacheOverBudget:cache.bytes>STORAGE_LIMITS.cacheBytes};
  }finally{db.close()}
}
// This migration is lossless. It preserves all versions and CVD values exactly.
// Run with the application stopped; never VACUUM a busy background service.
export function migrateChartStorage(file){
  const db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS local_chart_candles(id TEXT PRIMARY KEY,body TEXT NOT NULL)');
  let changed=0,before=0,after=0;
  try{
    const rows=db.prepare('SELECT rowid,body FROM local_analysis_details').all();
    const insert=db.prepare('INSERT OR IGNORE INTO local_chart_candles VALUES (?,?)'),update=db.prepare('UPDATE local_analysis_details SET body=? WHERE rowid=?');
    for(const row of rows){
      const value=JSON.parse(row.body);if(value.storageVersion===2||value.storageVersion===3||!value.candles?.length)continue;
      db.exec('BEGIN IMMEDIATE');
      try{
        const refs=value.candles.map(c=>{const body=JSON.stringify(c),id=createHash('sha256').update(body).digest('hex');insert.run(id,body);return id});
        const packed={...value,candles:[],storageVersion:2,candleRefs:refs};
        const restored=refs.map(id=>JSON.parse(db.prepare('SELECT body FROM local_chart_candles WHERE id=?').get(id).body));
        if(JSON.stringify(restored)!==JSON.stringify(value.candles))throw new Error('Chart round-trip mismatch; migration rolled back');
        const body=JSON.stringify(packed);update.run(body,row.rowid);db.exec('COMMIT');changed++;before+=row.body.length;after+=body.length;
      }catch(e){db.exec('ROLLBACK');throw e}
    }
    db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
    return {changed,beforeCharacters:before,afterCharacters:after,allCandleArraysVerified:true};
  }finally{db.close()}
}
export function compressSavedCharts(db,limit=200){
  const rows=db.prepare("SELECT rowid,body FROM local_analysis_details WHERE json_extract(body,'$.storageVersion')=2 LIMIT ?").all(limit);
  let saved=0,changed=0;
  const update=db.prepare('UPDATE local_analysis_details SET body=? WHERE rowid=? AND body=?');
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const row of rows){
      const zipped=gzipSync(row.body),restored=gunzipSync(zipped).toString('utf8');
      if(restored!==row.body)throw new Error('Chart archive verification failed');
      const body=JSON.stringify({storageVersion:3,codec:'gzip',sha256:createHash('sha256').update(row.body).digest('hex'),data:zipped.toString('base64')});
      if(body.length>=row.body.length*.9)continue;
      if(update.run(body,row.rowid,row.body).changes){saved+=row.body.length-body.length;changed++}
    }
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
  return {changed,savedBytes:saved};
}
export function maintainStorage(root,limits=STORAGE_LIMITS){
  const file=databasePath(root),db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=1500');
  try{
    // Keep a 48h grace after TTL, including last-good fallbacks. Never remove
    // market_history, dominance, profiles, analysis details or saved views.
    const removed=db.prepare('DELETE FROM feed_cache WHERE expires<?').run(Date.now()-STORAGE_LIMITS.cacheGraceMs).changes;
    let bytes=db.prepare('SELECT COALESCE(SUM(length(body)),0) n FROM feed_cache').get().n,evicted=0;
    // Cache bodies are reproducible. Valid rate limits and leases are never
    // evicted: removing those could accidentally bypass exchange pacing.
    if(bytes>limits.cacheBytes){
      const candidates=db.prepare("SELECT key,length(body) bytes FROM feed_cache WHERE key NOT LIKE 'rate:%' AND key NOT LIKE 'lease:%' AND key NOT IN ('compass:four-hour:v1','compass:cmc-four:v1') ORDER BY expires").all();
      db.exec('BEGIN IMMEDIATE');
      try{for(const row of candidates){if(bytes<=limits.cacheBytes*.9)break;evicted+=db.prepare('DELETE FROM feed_cache WHERE key=?').run(row.key).changes;bytes-=row.bytes}db.exec('COMMIT')}
      catch(e){db.exec('ROLLBACK');throw e}
    }
    const hasDetails=db.prepare("SELECT 1 FROM sqlite_master WHERE name='local_analysis_details'").get();
    const archived=hasDetails?compressSavedCharts(db):{changed:0,savedBytes:0};
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='local_retired_plans'").get())db.prepare('DELETE FROM local_retired_plans WHERE expires<?').run(Date.now());
    db.exec('PRAGMA optimize;');trimLogs(root);
    const result={at:Date.now(),removedCacheEntries:removed,evictedCacheEntries:evicted,archived};
    fs.writeFileSync(path.join(root,'data/storage-maintenance.json'),JSON.stringify(result));return result;
  }finally{db.close()}
}
