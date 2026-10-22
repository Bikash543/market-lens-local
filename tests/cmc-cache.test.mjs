import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createFeedCache} from '../lib/feed-cache.ts';
import {allowedURL} from '../local/exchange-network.mjs';
const state={now:Date.UTC(2026,9,21,10),rows:[],calls:[],settings:{},failHistory:false,failLatest:false,configured:true,saveRows:true};
const iso=t=>new Date(t).toISOString();
globalThis.cmcTest={
  cache:createFeedCache(),
  env:{DB:{prepare(sql){return {bind(...args){return {first:async()=>state.rows.find(r=>r.source===args[0]&&r.time>=args[1]&&r.time<=args[2])??null,sql,args}}}},batch:async queries=>{if(state.saveRows)for(const q of queries)state.rows.push({time:q.args[0],btc:q.args[1],usdt:q.args[2],source:q.args[3]})}}},
  write:async(k,v)=>{state.settings[k]=v},
  get:async url=>{
    state.calls.push(url);const historical=url.includes('historical'),global=url.includes('global-metrics');
    if(historical&&state.failHistory)throw new Error('History unavailable');
    if(!historical&&state.failLatest)throw new Error('CMC returned 429');
    if(!historical)return global?{data:{btc_dominance:58,last_updated:iso(state.now),quote:{USD:{total_market_cap:1000,last_updated:iso(state.now)}}}}:{data:[{id:825,last_updated:iso(state.now),quote:[{symbol:'USD',market_cap:50,last_updated:iso(state.now)}]}]};
    const quotes=[0,1,2].map(i=>({timestamp:iso(state.now-3600000-i*300000),...(global?{btc_dominance:58}:{}),quote:{USD:global?{total_market_cap:1000}:{market_cap:50}}}));
    return global?{data:{quotes}}:{data:{825:{quotes}}};
  }
};
const moduleURL=source=>'data:text/javascript,'+encodeURIComponent(source);
registerHooks({resolve(specifier,context,next){
  if(context.parentURL?.endsWith('/lib/provider-feeds.ts')){
    const mocks={
      'cloudflare:workers':'export const env=globalThis.cmcTest.env;',
      './shared-feeds':'export const sharedFeedCache={get:(...args)=>globalThis.cmcTest.cache.get(...args)},sharedGate={};',
      './upstream':'export const upstreamJSON=globalThis.cmcTest.get;',
      './local-store':'export const writeSetting=globalThis.cmcTest.write;'
    };
    if(mocks[specifier])return {url:moduleURL(mocks[specifier]),shortCircuit:true};
    if(specifier==='./provider-data')return next('./provider-data.ts',context);
  }
  return next(specifier,context);
}});
const {recoverDominance,cmcCurrent}=await import('../lib/provider-feeds.ts');
function setup(t){
  Object.assign(state,{now:Date.UTC(2026,9,21,10),rows:[],calls:[],settings:{},failHistory:false,failLatest:false,configured:true,saveRows:true});
  globalThis.cmcTest.cache=createFeedCache();
  const realNow=Date.now,realFetch=fetch;Date.now=()=>state.now;globalThis.fetch=async()=>Response.json({cmc:{configured:state.configured}});
  t.after(()=>{Date.now=realNow;globalThis.fetch=realFetch});
}
test('CMC uses authenticated latest quotes, reuses them for five minutes and backfills only missing history',async t=>{
  setup(t);
  const first=await recoverDominance();assert.equal(first.time,state.now);assert.equal(state.calls.length,4);
  assert.ok(state.calls.every(x=>!x.includes('/public-api/')));
  assert.equal(state.settings['dominance-recovery'].state,'ready');
  assert.equal(state.settings['dominance-recovery'].observationAt,first.time);
  await recoverDominance();assert.equal(state.calls.length,4);
  state.now+=120000;
  assert.equal((await recoverDominance()).time,first.time,'Cache must retain the original observation timestamp');
  assert.equal(state.calls.length,4);
  state.now+=240000;
  const second=await recoverDominance();assert.equal(second.time,state.now);assert.notEqual(first.time,second.time);
  assert.equal(state.calls.filter(x=>x.includes('historical')).length,2);
  state.now+=20*60000;
  await recoverDominance();assert.equal(state.calls.filter(x=>x.includes('historical')).length,4);
  assert.ok(state.calls.filter(x=>x.includes('historical')).every(x=>{const p=new URL(x).searchParams;return +p.get('time_end')-+p.get('time_start')===1200}));
  state.now+=20*60000;state.failHistory=true;
  const partial=await recoverDominance();assert.equal(partial.time,state.now);assert.equal(state.settings['dominance-recovery'].state,'unavailable');
  const count=state.calls.length;state.now+=120000;await recoverDominance();assert.equal(state.calls.length,count,'Failed history backs off without spending more API credits');
});
test('CMC latest failure replaces a previous recovery success and recovery refreshes status when service returns',async t=>{
  setup(t);await recoverDominance();state.now+=360000;state.failLatest=true;
  await assert.rejects(recoverDominance(),/429/);
  assert.equal(state.settings['dominance-recovery'].state,'unavailable');
  assert.match(state.settings['dominance-recovery'].message,/429/);
  assert.equal(state.settings['dominance-recovery'].at,state.now);
  state.now+=360000;state.failLatest=false;
  await recoverDominance();assert.equal(state.settings['dominance-recovery'].state,'ready');
  assert.equal(state.settings['dominance-recovery'].observationAt,state.now);
});
test('Other-provider samples and unsaved backfill never count as a CMC baseline',async t=>{
  setup(t);state.rows=[{source:'CoinPaprika',time:state.now-3600000,btc:57,usdt:6}];state.saveRows=false;
  await recoverDominance();assert.equal(state.calls.filter(x=>x.includes('historical')).length,2);
  assert.equal(state.settings['dominance-recovery'].state,'unavailable');
  assert.equal(state.settings['dominance-recovery'].baselineAt,null);
});
test('No-key installs still use public latest data, isolated from authenticated cached quotes',async t=>{
  setup(t);await cmcCurrent();state.configured=false;
  assert.equal(await recoverDominance(),null);
  assert.equal(state.settings['dominance-recovery'].state,'key-required');
  await cmcCurrent();assert.equal(state.calls.length,4);
  assert.ok(state.calls.slice(2).every(x=>x.includes('/public-api/')));
});
test('Network proxy permits supported authenticated latest endpoints but rejects unrelated destinations',()=>{
  for(const path of ['/v1/global-metrics/quotes/latest','/v3/cryptocurrency/quotes/latest','/v3/cryptocurrency/listings/latest'])assert.equal(allowedURL('https://pro-api.coinmarketcap.com'+path).pathname,path);
  assert.throws(()=>allowedURL('https://pro-api.coinmarketcap.com/v1/key/info'));
  assert.throws(()=>allowedURL('https://example.com/v1/global-metrics/quotes/latest'));
});
