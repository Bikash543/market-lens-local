import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({resolve(specifier,context,next){return next(['./market-data','./browser-api'].includes(specifier)?specifier+'.ts':specifier,context)}});
const {createMarketFeed}=await import('../lib/market-browser.ts');
const {normalizeOKXMarket}=await import('../lib/market-data.ts');
const time=1800000000000,instId='ETH-USDT-SWAP';
function fixtures(now=time){
  return [
    [{instId,state:'live',settleCcy:'USDT',ctType:'linear',instCategory:'1'}],
    [{instId,ts:now,last:'2000',open24h:'1900',volCcy24h:'500'}],
    [{instId,ts:now,markPx:'2001'}],
    [{instId,ts:now,fundingRate:'0.0001',prevFundingTime:now,fundingTime:now+28800000}],
  ];
}
const paths=['instruments','tickers','mark-price','funding-rate'];
test('hosted market data stays preferred and never triggers a browser fetch when healthy',async()=>{
  const expected={rows:[{symbol:'ETHUSDT'}],exchange:'Binance'};
  const load=createMarketFeed({hosted:async()=>expected,fetcher:async()=>assert.fail('No direct request')});
  assert.equal(await load(),expected);
});
test('failed hosted snapshots switch to validated same-venue public data, cache components and retry the host later',async()=>{
  let now=time,hostCalls=0,requests=[];
  const load=createMarketFeed({now:()=>now,hosted:async()=>{hostCalls++;throw Error('Cooling down')},fetcher:async(url,options)=>{
    const path=new URL(url).pathname.split('/').at(-1);requests.push(path);
    assert.equal(options.credentials,'omit');
    return Response.json({code:'0',data:fixtures(now)[paths.indexOf(path)]});
  }});
  const first=await load();
  assert.deepEqual(first.rows,normalizeOKXMarket(...fixtures(),time).rows);
  assert.equal(first.transport,'browser');assert.equal(first.exchange,'OKX');
  await load();assert.equal(requests.length,4);assert.equal(hostCalls,1);
  now+=30000;await load();assert.equal(requests.length,7);assert.equal(requests.filter(x=>x==='instruments').length,1);
  now+=900000;await load();assert.equal(hostCalls,2);
});
test('direct market rate limits preserve Retry-After and prevent repeat batches',async()=>{
  let calls=0;
  const load=createMarketFeed({now:()=>time,hosted:async()=>{throw Error('Unavailable')},fetcher:async()=>{
    calls++;return Response.json({code:'50011'},{status:429,headers:{'Retry-After':'120'}});
  }});
  await assert.rejects(load(),e=>e.retryAfterMs>=120000);
  const sent=calls;await assert.rejects(load(),/cooling down/);
  assert.equal(calls,sent);
});
test('missing, non-finite or stale market fields never become live snapshots',()=>{
  for(const patch of [{ts:time-180001},{ts:'bad'},{fundingRate:''},{fundingRate:'bad'}]){
    const f=fixtures();Object.assign(f[3][0],patch);
    assert.throws(()=>normalizeOKXMarket(...f,time),/No fresh/);
  }
});
test('aborted market loads never initiate requests',async()=>{
  const load=createMarketFeed({hosted:async()=>assert.fail('No request')});
  const c=new AbortController();c.abort();
  await assert.rejects(load(c.signal),e=>e.name==='AbortError');
});
