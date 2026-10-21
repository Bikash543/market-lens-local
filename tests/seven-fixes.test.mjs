import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {formingRange,makePlan,Q} from '../lib/confirmation.ts';
import {rememberRetirement} from '../lib/plan-retirement.ts';
import {convertCoinLore} from '../lib/local-compass/coinlore.ts';
import {dataReadiness} from '../lib/data-readiness.mjs';
import {formatPrice} from '../lib/price-format.ts';
import {packChart,unpackChart} from '../lib/chart-archive.ts';
import {decodeChart,encodeChart} from '../lib/chart-storage.ts';
import {maintainStorage,compressSavedCharts} from '../local/storage-maintenance.mjs';
import {inspectHealth} from '../lib/health-check.ts';
const end=Date.UTC(2026,9,21,9),now=end+30000;
const pattern=side=>({side,entry:100,stop:side==='LONG'?98:102,retestAt:end,breakAt:end-Q,atr:2,invalid:false,expired:false});
const range=(h=100.1,l=99.9)=>formingRange([[end,100,h,l,100,1,1,100,'0']],now);
test('intrabar stop and target touches invalidate both sides even after latest price returns to entry',()=>{
  for(const side of ['LONG','SHORT']){
    assert.equal(makePlan(pattern(side),[],100,now,range()).state,'candidate');
    for(const r of [range(102,99.9),range(100.1,98)])assert.equal(makePlan(pattern(side),[],100,now,r).state,'retired');
  }
  assert.throws(()=>formingRange([[end-Q,100,101,99,100,1,1,10,'1']],now),/unavailable/);
  assert.equal(makePlan(pattern('LONG'),[],100,now).state,'retired');
  assert.equal(makePlan(pattern('LONG'),[],100,now,{...range(),checkedAt:now-15001}).state,'retired');
});
function temp(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'market-lens-seven-'));t.after(()=>{if(path.dirname(root)!==fs.realpathSync(os.tmpdir())||!path.basename(root).startsWith('market-lens-seven-'))throw new Error('Unsafe test cleanup');fs.rmSync(root,{recursive:true,force:true})});return root}
test('retired plan stays retired across a database restart, while a new retest is independent',async t=>{
  const file=path.join(temp(t),'ledger.sqlite');let db=new DatabaseSync(file);
  db.exec('CREATE TABLE plans(key TEXT PRIMARY KEY,reason TEXT,expires INTEGER)');
  const store={write:async(k,r,e)=>db.prepare('INSERT OR IGNORE INTO plans VALUES (?,?,?)').run(k,r,e),read:async k=>db.prepare('SELECT reason FROM plans WHERE key=?').get(k)?.reason??null};
  const s={symbol:'ETH',side:'LONG',pattern:pattern('LONG'),plan:makePlan(pattern('LONG'),[],100,now,range(100.1,98)),verdict:'WAIT',reasons:[]};
  await rememberRetirement(s,store);db.close();db=new DatabaseSync(file);
  try{
    const rebound={...s,verdict:'LONG SETUP',plan:makePlan(pattern('LONG'),[],100,now,range())};
    const kept=await rememberRetirement(rebound,store);assert.equal(kept.verdict,'WAIT');assert.equal(kept.plan.state,'retired');
    assert.equal((await rememberRetirement({...rebound,pattern:{...rebound.pattern,retestAt:end+Q}},store)).verdict,'LONG SETUP');
    assert.equal((await rememberRetirement(rebound,{...store,read:async()=>{throw new Error('disk error')}})).verdict,'WAIT');
  }finally{db.close()}
});
const page=(at,id,price)=>({info:{time:at/1000},data:[{id,rank:+id,symbol:'X'+id,name:'Asset',price_usd:String(price),market_cap_usd:'10000',percent_change_1h:'1',volume24:'1000'}]});
test('page-specific timestamps reject a hidden 17m return and retain a valid 15m comparison',()=>{
  const old=convertCoinLore([page(end-Q,'1',100),page(end-Q,'2',100)],[],end-Q).snapshot;
  const v=convertCoinLore([page(end,'1',110),page(end+120000,'2',110)],[old],end+120000);
  assert.equal(v.tickers[1].last_updated,new Date(end+120000).toISOString());
  assert.equal(v.tickers[1].quotes.USD.percent_change_15m,null);
  assert.ok(Math.abs(v.tickers[0].quotes.USD.percent_change_15m-10)<1e-9);
  const corrected={...old,times:{...old.times,'2':end-Q+120000}};
  assert.ok(convertCoinLore([page(end,'1',110),page(end+120000,'2',110)],[corrected],end+120000).tickers.every(c=>c.quotes.USD.percent_change_15m!==null));
  const legacy={at:old.at,prices:old.prices};assert.equal(convertCoinLore([page(end,'1',110),page(end,'2',110)],[legacy],end).baselineMinutes,null);
});
test('minute collection handles two-minute publication cadence without widening the 15m window',()=>{
  const history=[];
  for(let m=0;m<=40;m++){
    const at=end+m*60000,one=Math.floor(at/120000)*120000,two=Math.floor((at-60000)/120000)*120000;
    const v=convertCoinLore([page(one,'1',100+m),page(two,'2',100+m)],history,at);
    if(m>=18){assert.ok(v.tickers.every(c=>c.quotes.USD.percent_change_15m!==null));assert.ok(v.baselineRange[0]>=13.5&&v.baselineRange[1]<=16.5)}
    history.push(v.snapshot);
  }
});
test('refresh readiness distinguishes missing data from a complete mixed WAIT',()=>{
  const r={coverage:1,breadth:{total:100,available:100},alt:0,btc:0,btcDom:0,usdtDom:0,bias:'WAIT'};
  const value={at:now,readings:{'15m':r,'1h':r},fourContext:{at:now,reading:r}};
  assert.equal(dataReadiness('market',value,now).ready,true);
  assert.equal(dataReadiness('market',{...value,readings:{...value.readings,'15m':{...r,breadth:{total:100,available:0}}}},now).ready,false);
  assert.equal(dataReadiness('global',{updated:now,baseline:null,btcChange:null,usdtChange:null},now).ready,false);
  assert.equal(dataReadiness('oi',{at:now,quarter:1,hour:1,fourHour:null},now).pending.length,1);
});
test('tiny prices keep meaningful digits and missing data is not zero',()=>{
  assert.equal(formatPrice(0.00000036),'$0.00000036');assert.equal(formatPrice(null),'—');assert.equal(formatPrice(0),'$0.00');assert.equal(formatPrice(100),'$100.00');
});
test('lossless chart compression validates checksums and returns exact original candles and CVD',async()=>{
  const value={symbol:'ETHUSDT',candles:Array.from({length:100},(_,i)=>({t:i,c:i+.123456789})),cvdSeries:Array.from({length:100},(_,i)=>({t:i,value:-i-.987654321}))};
  const encoded=await encodeChart(value),packed=await packChart(encoded.body),unpacked=await unpackChart(JSON.parse(packed));
  assert.ok(packed.length<encoded.body.length);assert.deepEqual(decodeChart(unpacked,encoded.rows),value);
  await assert.rejects(unpackChart({...JSON.parse(packed),sha256:'bad'}),/checksum/);
});
test('cache budget and full expiry cleanup preserve protected data and active rate limits',async t=>{
  const root=temp(t),dir=path.join(root,'data/state/v3/d1/miniflare-D1DatabaseObject');fs.mkdirSync(dir,{recursive:true});
  const db=new DatabaseSync(path.join(dir,'test.sqlite'));db.exec('CREATE TABLE feed_cache(key TEXT PRIMARY KEY,body TEXT,expires INTEGER);CREATE TABLE local_analysis_details(body TEXT);CREATE TABLE local_settings(key TEXT,body TEXT);CREATE TABLE market_history(time INTEGER,body TEXT);');
  const original=JSON.stringify({storageVersion:2,candleRefs:Array(50).fill('abcdef'),candles:[],cvdSeries:Array(50).fill(123.456789)});
  db.prepare('INSERT INTO local_analysis_details VALUES (?)').run(original);db.exec("INSERT INTO local_settings VALUES('profile','watchlist');INSERT INTO market_history VALUES(1,'important');");
  db.exec('BEGIN');for(let i=0;i<2101;i++)db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run('expired:'+i,'x',Date.now()-72*3600000);for(let i=0;i<20;i++)db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run('cache:'+i,'x'.repeat(100),Date.now()+60000);db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run('rate:active','{}',Date.now()+60000);db.exec('COMMIT');db.close();
  const seed=new DatabaseSync(path.join(dir,'test.sqlite'));seed.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run('compass:cmc-four:v1','saved-4h',Date.now()+60000);seed.close();
  const result=maintainStorage(root,{cacheBytes:500});assert.equal(result.removedCacheEntries,2101);assert.ok(result.evictedCacheEntries>0);
  const read=new DatabaseSync(path.join(dir,'test.sqlite'));
  try{assert.ok(read.prepare('SELECT sum(length(body)) n FROM feed_cache').get().n<=500);assert.ok(read.prepare("SELECT 1 FROM feed_cache WHERE key='rate:active'").get());assert.equal(read.prepare("SELECT body FROM feed_cache WHERE key='compass:cmc-four:v1'").get().body,'saved-4h');assert.equal(read.prepare('SELECT body FROM local_settings').get().body,'watchlist');assert.equal(read.prepare('SELECT body FROM market_history').get().body,'important');assert.deepEqual(await unpackChart(JSON.parse(read.prepare('SELECT body FROM local_analysis_details').get().body)),JSON.parse(original));assert.equal(compressSavedCharts(read).changed,0)}finally{read.close()}
});
test('CMC API-level errors cannot pass a successful-HTTP health check',()=>{
  assert.equal(inspectHealth(200,JSON.stringify({status:{error_code:1001,error_message:'Invalid API key'}})).healthy,false);
});
