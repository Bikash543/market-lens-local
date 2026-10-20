import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedURL} from '../local/exchange-network.mjs';
test('local transport allows only fixed public exchange endpoints',()=>{
  assert.equal(allowedURL('https://openapi.okx.com/api/v5/public/time').hostname,'openapi.okx.com');
  assert.equal(allowedURL('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT').pathname,'/fapi/v1/klines');
  for(const url of ['http://openapi.okx.com/api/v5/public/time','https://evil.test/','https://openapi.okx.com:1234/api/v5/public/time','https://user@openapi.okx.com/api/v5/public/time','https://openapi.okx.com/api/v5/trade/order','https://fapi.binance.com/fapi/v1/order'])assert.throws(()=>allowedURL(url));
});
