import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({resolve(specifier,context,next){
  return next(['./engine','./okx','./window-cache','./browser-api','./contract-symbol'].includes(specifier)?specifier+'.ts':specifier,context);
}});
const {createOKXBrowserFeed}=await import('../lib/okx-browser.ts');
const {normalizeOKX}=await import('../lib/okx.ts');
const {analyze}=await import('../lib/engine.ts');
let now=1800000000000;
function fixture(time=now){
  const step=900000,end=Math.floor(time/step)*step;
  const bars=Array.from({length:60},(_,i)=>[end-(60-i)*step,100+i,102+i,99+i,101+i,10,10,10000,'1']);
  const flow=bars.map(k=>[k[0],4000,6000]);
  const interest=Array.from({length:8},(_,i)=>[end-(8-i)*step,1000+i*10,10,100000]);
  return {bars,context:{symbol:'BTCUSDT',interval:'15m',exchange:'OKX',instrument:'BTC-USDT-SWAP',flow,interest,funding:0.0001,fundingAt:time}};
}
test('browser transport uses exactly the original rules and refreshes funding without refetching closed candles',async()=>{
  const f=fixture();let calls=0,contexts=0;
  const scan=createOKXBrowserFeed({now:()=>now,spacingMs:0,fetcher:async(url,options)=>{
    assert.equal(new URL(url).hostname,'openapi.okx.com');assert.equal(options.credentials,'omit');
    calls++;return Response.json({code:'0',data:f.bars});
  },context:async()=>{contexts++;return f.context}});
  const actual=await scan('BTCUSDT','15m');
  const normalized=normalizeOKX(f.bars,f.context.flow,f.context.interest,'15m',now);
  const expected=analyze('BTCUSDT','15m',normalized.raw,normalized.oi,f.context.funding,now);
  for(const key of Object.keys(expected))assert.deepEqual(actual[key],expected[key],key);
  f.context.funding=-0.0002;
  assert.equal((await scan('BTCUSDT','15m')).funding,-0.0002);
  assert.equal(calls,1);assert.equal(contexts,2);
});
test('a new candle boundary causes a fresh request and never reuses the expired window',async()=>{
  let time=now+1000,calls=0;
  const scan=createOKXBrowserFeed({now:()=>time,spacingMs:0,fetcher:async()=>{calls++;return Response.json({code:'0',data:fixture(time).bars})},context:async()=>fixture(time).context});
  const first=await scan('BTCUSDT','15m');time+=900000;
  const second=await scan('BTCUSDT','15m');
  assert.equal(calls,2);assert.equal(second.closedAt-first.closedAt,900000);
});
test('mismatched venue, stale funding and missing flow cannot produce browser signals',async()=>{
  const f=fixture();
  for(const patch of [{exchange:'Binance'},{fundingAt:now-180001},{flow:[]}]){
    const scan=createOKXBrowserFeed({now:()=>now,spacingMs:0,fetcher:async()=>Response.json({code:'0',data:f.bars}),context:async()=>({...f.context,...patch})});
    await assert.rejects(scan('BTCUSDT','15m'),/Mismatched|fresh|Insufficient/);
  }
});
test('browser rate limits honor Retry-After with no immediate fallback or repeated call',async()=>{
  let calls=0;
  const scan=createOKXBrowserFeed({now:()=>now,spacingMs:0,fetcher:async()=>{calls++;return Response.json({code:'50011'},{status:429,headers:{'Retry-After':'120'}})},context:async()=>assert.fail('No statistics calls after throttling')});
  await assert.rejects(scan('BTCUSDT','15m'),e=>e.retryAfterMs===120000);
  await assert.rejects(scan('ETHUSDT','15m'),e=>e.retryAfterMs===120000);
  assert.equal(calls,1);
});
test('cancelled browser scans never start network work',async()=>{
  const scan=createOKXBrowserFeed({fetcher:async()=>assert.fail('No fetch after cancel')});
  const c=new AbortController();c.abort();
  await assert.rejects(scan('BTCUSDT','15m',c.signal),e=>e.name==='AbortError');
});
