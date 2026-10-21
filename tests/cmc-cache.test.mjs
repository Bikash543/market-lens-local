import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createFeedCache} from '../lib/feed-cache.ts';
const state={now:Date.UTC(2026,9,21,10),rows:[],calls:[],settings:{},failHistory:false};
const iso=t=>new Date(t).toISOString();
globalThis.cmcTest={
  cache:createFeedCache(),
  env:{DB:{prepare(sql){return {bind(...args){return {first:async()=>state.rows.find(r=>r.source===args[0]&&r.time>=args[1]&&r.time<=args[2])??null,sql,args}}}},batch:async queries=>{for(const q of queries)state.rows.push({time:q.args[0],btc:q.args[1],usdt:q.args[2],source:q.args[3]})}}},
  write:async(k,v)=>{state.settings[k]=v},
  get:async url=>{
    state.calls.push(url);const historical=url.includes('historical'),global=url.includes('global-metrics');
    if(historical&&state.failHistory)throw new Error('History unavailable');
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
      './shared-feeds':'export const sharedFeedCache=globalThis.cmcTest.cache,sharedGate={};',
      './upstream':'export const upstreamJSON=globalThis.cmcTest.get;',
      './local-store':'export const writeSetting=globalThis.cmcTest.write;'
    };
    if(mocks[specifier])return {url:moduleURL(mocks[specifier]),shortCircuit:true};
    if(specifier==='./provider-data')return next('./provider-data.ts',context);
  }
  return next(specifier,context);
}});
const {recoverDominance}=await import('../lib/provider-feeds.ts');
test('CMC current quotes advance independently while historical requests happen only for a missing baseline',async t=>{
  const realNow=Date.now,realFetch=fetch;Date.now=()=>state.now;globalThis.fetch=async()=>Response.json({cmc:{configured:true}});
  t.after(()=>{Date.now=realNow;globalThis.fetch=realFetch;delete globalThis.cmcTest});
  const first=await recoverDominance();assert.equal(first.time,state.now);assert.equal(state.calls.length,4);
  await recoverDominance();assert.equal(state.calls.length,4);
  state.now+=120000;
  const second=await recoverDominance();assert.equal(second.time,state.now);assert.notEqual(first.time,second.time);
  assert.equal(state.calls.filter(x=>x.includes('historical')).length,2);
  state.now+=20*60000;
  await recoverDominance();assert.equal(state.calls.filter(x=>x.includes('historical')).length,4);
  assert.ok(state.calls.filter(x=>x.includes('historical')).every(x=>{const p=new URL(x).searchParams;return +p.get('time_end')-+p.get('time_start')===1200}));
  state.now+=20*60000;state.failHistory=true;
  const partial=await recoverDominance();assert.equal(partial.time,state.now);assert.equal(state.settings['dominance-recovery'].state,'unavailable');
  const count=state.calls.length;state.now+=120000;await recoverDominance();assert.equal(state.calls.length,count+2,'Failed history backs off while latest quotes continue');
});
