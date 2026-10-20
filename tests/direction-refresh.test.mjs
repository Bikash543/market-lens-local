import test from 'node:test';
import assert from 'node:assert/strict';
import {finishDirectionRefresh} from '../lib/direction-refresh.ts';
const response=(at,refreshing=false)=>({status:200,data:{at,refreshing}});
test('manual direction refresh waits for the shared collector to finish',async()=>{
  const readings=[response(100,true),response(100,true),response(200)];
  const delays=[];
  const result=await finishDirectionRefresh(async()=>readings.shift(),async ms=>delays.push(ms));
  assert.equal(result.data.at,200);assert.deepEqual(delays,[1500,3000]);assert.equal(readings.length,0);
});
test('already current snapshots and upstream failures have no follow-up',async()=>{
  for(const first of [response(200),{status:503,data:{error:'unavailable'}}]){
    let calls=0;
    const result=await finishDirectionRefresh(async()=>{calls++;return first},async()=>assert.fail('unexpected pause'));
    assert.deepEqual(result,first);assert.equal(calls,1);
  }
});
test('a slow or failed collector cannot leave an endless updating label',async()=>{
  let calls=0;
  const result=await finishDirectionRefresh(async()=>{calls++;return response(100,true)},async()=>{});
  assert.equal(calls,4);assert.equal(result.data.at,100);assert.equal(result.data.refreshing,false);assert.match(result.data.refreshError,/saved snapshot/);
  calls=0;
  const failed=await finishDirectionRefresh(async()=>{if(calls++)throw new Error('timeout');return response(100,true)},async()=>{});
  assert.equal(failed.data.at,100);assert.equal(failed.data.refreshing,false);
});
