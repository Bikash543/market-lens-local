import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {cmcLatest,cmcHistory,gateStatistics} from '../lib/provider-data.ts';
import {validatedRawCandles,interestTTL} from '../lib/candle-window.ts';
import {encodeChart,decodeChart} from '../lib/chart-storage.ts';
import {retryPolicy} from '../local/retry-policy.mjs';
import {migrateChartStorage,maintainStorage,storageStatus,trimLogs} from '../local/storage-maintenance.mjs';
import {archiveBinary,restoreBinary,archiveResearch} from '../local/research-storage.mjs';
import {createFeedCache} from '../lib/feed-cache.ts';
import {coinLoreTiming} from '../lib/local-compass/coinlore.ts';
import {flowSample} from '../lib/flow-sample.ts';
import {saveProviderKey,providerKey} from '../local/provider-settings.mjs';
const now=1800000000000;
test('four-coin spot sample preserves good members, withholds partial/skewed averages and retries only through provider cache',async()=>{
  const load=async symbol=>({at:now,imbalance:10,delta:100,volume:1000});
  const good=await flowSample(load,now);assert.equal(good.rows.length,4);assert.equal(good.average,10);
  const partial=await flowSample(async s=>{if(s==='DOGE')throw new Error('timeout');return load(s)},now);assert.equal(partial.rows.length,3);assert.equal(partial.average,null);assert.deepEqual(partial.errors,['DOGE: timeout']);
  const skew=await flowSample(async s=>({...await load(s),at:s==='LINK'?now-600000:now}),now);assert.equal(skew.average,null);
});
test('CoinLore diagnostics distinguish timestamp skew from stale, future and absent pages',()=>{
  const pages=(a,b)=>[{info:{time:a/1000}},{info:{time:b/1000}}];
  assert.equal(coinLoreTiming(pages(now,now-30000),now).state,'fresh');
  const skew=coinLoreTiming(pages(now,now-180000),now);assert.equal(skew.state,'misaligned');assert.equal(skew.olderPage,1);
  assert.equal(coinLoreTiming(pages(now-900000,now-800000),now).state,'stale');
  assert.equal(coinLoreTiming(pages(now+60000,now),now).state,'future');
  assert.equal(coinLoreTiming([],now).state,'invalid');
});
const iso=at=>new Date(at).toISOString();
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'market-lens-test-'));t.after(()=>{if(!path.basename(root).startsWith('market-lens-test-')||path.dirname(root)!==fs.realpathSync(os.tmpdir()))throw new Error('Unexpected cleanup target');fs.rmSync(root,{recursive:true,force:true})});return root}
test('Windows provider settings store an encrypted blob and removal clears it',{skip:process.platform!=='win32'},async t=>{
  const root=temporary(t),fake='unit-test-not-a-real-api-key';
  await saveProviderKey(root,'cmc',fake);assert.equal(providerKey('cmc'),fake);
  const file=path.join(root,'data/private/cmc.dpapi'),cipher=fs.readFileSync(file,'utf8');assert.ok(cipher.length>fake.length);assert.equal(cipher.includes(fake),false);
  await saveProviderKey(root,'cmc','');assert.equal(providerKey('cmc'),undefined);assert.equal(fs.existsSync(file),false);
});
function current(){return [{data:{btc_dominance:58,last_updated:iso(now),quote:{USD:{total_market_cap:1000,last_updated:iso(now)}}}},{data:[{id:825,last_updated:iso(now),quote:[{symbol:'USD',market_cap:50,last_updated:iso(now)}]}]}]}
function history(){return [{data:{quotes:[0,1,2].map(i=>({timestamp:iso(now-i*300000),btc_dominance:58,quote:{USD:{total_market_cap:1000}}}))}},{data:{825:{quotes:[0,1,2].map(i=>({timestamp:iso(now-i*300000),quote:{USD:{market_cap:50}}}))}}}]}
test('CMC public and historical dominance use aligned original provider timestamps',()=>{
  assert.equal(cmcLatest(...current(),now).usdt,5);
  const rows=cmcHistory(...history(),now);assert.equal(rows.length,3);assert.equal(rows[0].time,now-600000);assert.ok(rows.every(r=>r.source==='CoinMarketCap'&&r.usdt===5));
});
test('CMC refuses stale, skewed, missing and future values without inventing baselines',()=>{
  for(const offset of [-600001,30001,-120001]){const [g,t]=current();t.data[0].quote[0].last_updated=iso(now+offset);assert.throws(()=>cmcLatest(g,t,now),/invalid/)}
  const [g,t]=current();t.data[0].quote[0].market_cap=null;assert.throws(()=>cmcLatest(g,t,now),/invalid/);
  assert.throws(()=>cmcHistory({data:{}},{data:{}},now),/unavailable/);
  const [a,b]=history();b.data[825].quotes.forEach(q=>q.timestamp=iso(now+900000));assert.throws(()=>cmcHistory(a,b,now),/aligned/);
});
function gate(interval='15m'){const step=interval==='15m'?900000:interval==='1h'?3600000:14400000,end=Math.floor(now/step)*step;return {rows:Array.from({length:6},(_,i)=>({time:(end-(5-i)*step)/1000,open_interest:1000+i*10,open_interest_usd:100000,long_liq_usd:10,short_liq_usd:20})),contract:{name:'ETH_USDT',funding_rate:'0.001',funding_interval:14400},step,end}}
test('Gate supports every horizon, excludes forming buckets and normalizes funding interval',()=>{
  for(const interval of ['15m','1h','4h']){const f=gate(interval),v=gateStatistics(f.rows,f.contract,interval,now);assert.equal(v.at,f.end);assert.ok(Math.abs(v.oiChange-4)<1e-9);assert.equal(v.funding8h,.002);assert.equal(v.longLiquidationsUsd,40);assert.equal(v.shortLiquidationsUsd,80)}
});
test('Gate refuses gaps/stale OI and keeps missing liquidation/funding fields unavailable',()=>{
  const f=gate();assert.throws(()=>gateStatistics(f.rows.filter((_,i)=>i!==2),f.contract,'15m',now),/missing/);
  assert.throws(()=>gateStatistics(f.rows,f.contract,'15m',now+10*f.step),/stale/);
  f.rows[2].long_liq_usd=null;f.contract.funding_rate=null;
  const v=gateStatistics(f.rows,f.contract,'15m',now);assert.equal(v.longLiquidationsUsd,null);assert.equal(v.funding8h,null);
});
test('retry classification respects upstream Retry-After and separates publication from unsupported',()=>{
  assert.deepEqual(retryPolicy({message:'HTTP 429',retryAfterMs:180000}),{kind:'rate-limit',delayMs:180000});
  assert.equal(retryPolicy('No aligned open-interest sample').kind,'publication');
  assert.equal(retryPolicy('CONTRACT_NOT_FOUND').kind,'unsupported');
  assert.equal(retryPolicy('HTTP 451').kind,'restricted');
  assert.equal(retryPolicy('Timed out',3).delayMs,120000);
  assert.equal(retryPolicy('stale candle').kind,'quality');
});
function candleFixture(){const step=900000,end=Math.floor(now/step)*step;return {step,end,raw:Array.from({length:41},(_,i)=>{const t=end-(40-i)*step;return [t,100,102,99,101,100,t+step-1,10000,1,60,6000]})}}
test('validated price windows exclude forming candles and reject holes and impossible flow',()=>{
  const f=candleFixture();assert.equal(validatedRawCandles(f.raw,'15m',now).length,40);
  assert.throws(()=>validatedRawCandles(f.raw.filter((_,i)=>i!==10),'15m',now),/discontinuous/);
  f.raw[2][10]=20000;assert.throws(()=>validatedRawCandles(f.raw,'15m',now),/Invalid/);
});
test('a failed OI request does not invalidate a successful price/flow cache',async()=>{
  const boxes=new Map(),storage={read:async k=>boxes.get(k)??null,write:async(k,v)=>boxes.set(k,v)},cache=createFeedCache(storage);
  let candles=0,interest=0;
  const price=()=>cache.get('price',60000,async()=>{candles++;return validatedRawCandles(candleFixture().raw,'15m',now)});
  const oi=()=>cache.get('interest',60000,async()=>{interest++;throw new Error('No aligned open-interest sample')});
  await Promise.allSettled([price(),oi()]);await Promise.allSettled([price(),oi()]);assert.equal(candles,1);assert.equal(interest,1);
  const f=candleFixture();assert.equal(interestTTL([],'15m',now),15000);
  assert.equal(interestTTL([{timestamp:f.end,sumOpenInterest:100},{timestamp:f.end-4*f.step,sumOpenInterest:100}],'15m',now),f.end+f.step-now);
});
test('chart deduplication preserves complete arrays, revisions and exact CVD',async()=>{
  const a={symbol:'ETHUSDT',candles:[{time:1,c:3},{time:2,c:4}],cvdSeries:[{time:1,value:-5.123456789}]};
  const packed=await encodeChart(a);assert.deepEqual(decodeChart(JSON.parse(packed.body),packed.rows),a);
  const b=await encodeChart({...a,candles:[a.candles[1],{time:3,c:4}]});assert.equal(packed.rows[1].id,b.rows[0].id);
  const c=await encodeChart({...a,candles:[{time:2,c:4.01}]});assert.notEqual(packed.rows[1].id,c.rows[0].id);
  assert.throws(()=>decodeChart(JSON.parse(packed.body),[]),/unavailable/);
});
function database(root){const dir=path.join(root,'data/state/v3/d1/miniflare-D1DatabaseObject');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'test.sqlite'),db=new DatabaseSync(file);db.exec('CREATE TABLE feed_cache(key TEXT PRIMARY KEY,body TEXT,expires INTEGER);CREATE TABLE local_settings(key TEXT,body TEXT);CREATE TABLE market_history(time INTEGER,body TEXT);CREATE TABLE local_analysis_details(body TEXT);');return {file,db}}
test('lossless migration and cleanup preserve watchlist, history and every saved chart',async t=>{
  const root=temporary(t),{file,db}=database(root),value={candles:[{time:1,c:3},{time:2,c:4}],cvdSeries:[1.123456789,-9]};
  db.prepare('INSERT INTO local_analysis_details VALUES (?)').run(JSON.stringify(value));db.prepare('INSERT INTO local_settings VALUES (?,?)').run('profile',JSON.stringify({watchlist:['ETH','SUI']}));db.exec("INSERT INTO market_history VALUES(1,'original')");
  db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run('old','expired',Date.now()-72*3600000);db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run('fallback','keep',Date.now()-3600000);db.close();
  assert.equal(migrateChartStorage(file).changed,1);assert.equal(migrateChartStorage(file).changed,0);
  maintainStorage(root);const read=new DatabaseSync(file);try{assert.equal(read.prepare('SELECT COUNT(*) n FROM feed_cache').get().n,1);assert.equal(read.prepare('SELECT body FROM market_history').get().body,'original');assert.equal(JSON.parse(read.prepare('SELECT body FROM local_settings').get().body).watchlist.length,2);const packed=JSON.parse(read.prepare('SELECT body FROM local_analysis_details').get().body);assert.deepEqual(decodeChart(packed,read.prepare('SELECT * FROM local_chart_candles').all()),value)}finally{read.close()}
  assert.equal(storageStatus(root).cache.entries,1);
});
test('log retention only removes older rotated service logs',t=>{
  const root=temporary(t),dir=path.join(root,'data/logs');fs.mkdirSync(dir,{recursive:true});for(let i=0;i<9;i++)fs.writeFileSync(path.join(dir,`service-${i}.log`),'log');fs.writeFileSync(path.join(dir,'important.log'),'keep');trimLogs(root);assert.equal(fs.readdirSync(dir).length,5);assert.equal(fs.readFileSync(path.join(dir,'important.log'),'utf8'),'keep');
});
test('research archive is lossless and rejects protected/nonbinary files',async t=>{
  const root=temporary(t),input=Buffer.alloc(500000,7),file=path.join(root,'generated.bin');fs.writeFileSync(file,input);
  const record=await archiveBinary(root,file);assert.ok(record.archiveBytes<input.length);assert.equal(fs.existsSync(file),false);assert.equal(fs.existsSync(file+'.gz.json'),true);
  await restoreBinary(root,record);assert.deepEqual(fs.readFileSync(file),input);
  const important=path.join(root,'results.csv');fs.writeFileSync(important,'important');await assert.rejects(archiveBinary(root,important),/Only generated/);assert.equal(fs.readFileSync(important,'utf8'),'important');
  await assert.rejects(restoreBinary(root,{...record,archive:'../outside.gz'}));
});
test('research archive rebuilds its index from durable sidecars after an interrupted index update',async t=>{
  const root=temporary(t),dir=path.join(root,'cache');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'sample.bin'),Buffer.alloc(100000,3));
  const policy={root,folders:['cache'],minAgeHours:0};assert.equal((await archiveResearch(policy)).files,1);
  fs.renameSync(path.join(root,'research-archive-manifest.json'),path.join(root,'old-index.json'));
  assert.equal((await archiveResearch(policy)).files,1);
  const records=JSON.parse(fs.readFileSync(path.join(root,'research-archive-manifest.json'),'utf8'));await restoreBinary(root,records[0]);assert.deepEqual(fs.readFileSync(path.join(dir,'sample.bin')),Buffer.alloc(100000,3));
});
