import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCoin,confirmationMarkets,searchConfirmationMarkets} from '../lib/confirmation-symbols.ts';

const active=symbol=>({instId:`${symbol}-USDT-SWAP`,instType:'SWAP',instCategory:'1',state:'live',settleCcy:'USDT',ctType:'linear'});
test('symbols and pair formats normalize without allowing URL/path injection',()=>{
  for(const value of ['xrp',' XRPUSDT ','XRP/USDT','XRP-USDT','XRP-USDT-SWAP'])assert.equal(normalizeCoin(value),'XRP');
  assert.equal(normalizeCoin('1INCH'),'1INCH');
  for(const value of ['', '../BTC', 'ETH?side=LONG', 'ETH&x=1','BTC/USDC','A'.repeat(51),'USDT'])assert.equal(normalizeCoin(value),null);
});
test('directory includes coins beyond the old seven and excludes inactive/non-crypto contracts',()=>{
  const rows=confirmationMarkets([active('XRP'),active('DOGE'),active('XRP'),active('1INCH'),
    {...active('BAD'),state:'suspend'},{...active('STOCK'),instCategory:'2'},
    {...active('USDC'),settleCcy:'USDC'},{...active('DATED'),instType:'FUTURES'},
    {...active('INVERSE'),ctType:'inverse'},null,{instId:'../../secret'}]);
  assert.deepEqual(rows.map(v=>v.symbol),['1INCH','DOGE','XRP']);
});
test('search prioritizes exact symbols and accepts pair input',()=>{
  const markets=confirmationMarkets(['ETHFI','WETH','ETH','XRP','DOGE'].map(active));
  assert.deepEqual(searchConfirmationMarkets(markets,'ETH').map(v=>v.symbol),['ETH','ETHFI','WETH']);
  assert.deepEqual(searchConfirmationMarkets(markets,'DOGEUSDT').map(v=>v.symbol),['DOGE']);
  assert.equal(searchConfirmationMarkets(markets,'NOTLISTED').length,0);
  assert.equal(searchConfirmationMarkets(markets,'').length,0);
});
test('search returns a bounded list, and malformed provider data is rejected',()=>{
  assert.equal(searchConfirmationMarkets(confirmationMarkets(Array.from({length:50},(_,i)=>active(`ABC${i}`))),'ABC').length,12);
  assert.throws(()=>confirmationMarkets({data:'unexpected'}));
});
