import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){return next(specifier==='./confirmation'?specifier+'.ts':specifier,context)}});
const {applyDirectInputs}=await import('../lib/confirmation-direct.ts');
const {createConfirmationTransport}=await import('../lib/confirmation-browser.ts');
const {interestWindow}=await import('../lib/confirmation.ts');
const end=Date.UTC(2026,9,20,9,45),now=end+60000;
const candles=step=>Array.from({length:50},(_,i)=>[end-(50-i)*step,'100','101','99','100','1','1','100','1']);
test('direct candles are still checked for identity, gaps and closed status on the server',()=>{
  const input={symbol:'ETH',errors:[],q:null,btcQ:null,btcH:null,ticker:null};
  const bundle={q:{instrument:'ETH-USDT-SWAP',period:'15m',data:candles(900000)},btcQ:null,btcH:null,ticker:null,errors:[]};
  applyDirectInputs(input,bundle,now);assert.equal(input.q.length,50);
  assert.throws(()=>applyDirectInputs(input,{...bundle,q:{...bundle.q,instrument:'SOL-USDT-SWAP'}},now),/Mismatched/);
  assert.throws(()=>applyDirectInputs(input,{...bundle,ticker:{instrument:'ETH-USDT-SWAP',period:'quote',data:[{instId:'SOL-USDT-SWAP'}]}},now),/Mismatched/);
  const broken={...input,q:null,errors:[]};
  applyDirectInputs(broken,{...bundle,q:{...bundle.q,data:bundle.q.data.filter((_,i)=>i!==30)}},now);
  assert.equal(broken.q,null);assert.match(broken.errors[0],/Incomplete/);
});
test('browser only supplies requested candles and quote; second click reuses closed candles',async()=>{
  const urls=[];
  const load=createConfirmationTransport({now:()=>now,spacing:0,fetcher:async url=>{
    urls.push(url);const u=new URL(url);
    return Response.json({code:'0',data:u.pathname.endsWith('ticker')?[{instId:u.searchParams.get('instId'),ts:now,last:'100'}]:candles(u.searchParams.get('bar')==='1H'?3600000:900000)});
  }});
  const first=await load('ETH',new AbortController().signal);
  assert.equal(urls.length,4);assert.equal(first.errors.length,0);assert.ok(urls.every(x=>x.startsWith('https://openapi.okx.com/api/v5/market/')));
  await load('ETH',new AbortController().signal);
  assert.equal(urls.length,5);assert.ok(urls.at(-1).includes('/ticker?'));
});
test('public rate limit prevents immediate retries and cancellation prevents all network work',async()=>{
  let calls=0;
  const load=createConfirmationTransport({now:()=>now,spacing:0,fetcher:async()=>{calls++;return Response.json({code:'50011'},{headers:{'Retry-After':'60'}})}});
  const result=await load('ETH',new AbortController().signal);assert.equal(calls,2);assert.equal(result.errors.length,4);
  await load('ETH',new AbortController().signal);assert.equal(calls,2);
  const controller=new AbortController();controller.abort();
  await assert.rejects(load('ETH',controller.signal));assert.equal(calls,2);
});
test('forming OI cannot influence the completed candle participation check',()=>{
  const raw=[[end-300000,1002],[end-900000-300000,1000],[end-3600000-300000,999]];
  const expected=interestWindow(raw,end);
  assert.deepEqual(interestWindow([[end,9999999],...raw],end),expected);
  assert.equal(expected.at,end);assert.ok(expected.quarter>0);
});
