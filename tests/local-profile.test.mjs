import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){return next(specifier==='./contract-symbol'?'./contract-symbol.ts':specifier,context)}});
const {validSymbols,updateWatchlist}=await import('../lib/local-profile.ts');
test('watchlist imports merge without losing existing saved coins',()=>{
  assert.deepEqual(updateWatchlist(['ETHUSDT'],{op:'import',symbols:['BTCUSDT','ETHUSDT']}),['ETHUSDT','BTCUSDT']);
});
test('watchlist add is idempotent and removal targets one coin',()=>{
  assert.deepEqual(updateWatchlist(['ETHUSDT'],{op:'add',symbol:'ETHUSDT'}),['ETHUSDT']);
  assert.deepEqual(updateWatchlist(['ETHUSDT','SOLUSDT'],{op:'remove',symbol:'ETHUSDT'}),['SOLUSDT']);
});
test('invalid watchlist imports are rejected instead of altering storage',()=>{
  for(const value of [null,['BTC'],['<script>USDT'],['../BTCUSDT']])assert.throws(()=>validSymbols(value));
  assert.throws(()=>updateWatchlist([],{op:'replace',symbols:[]}));
});

test('non-Latin exchange contracts can be analysed and remembered safely',()=>{
  assert.deepEqual(validSymbols(['龙虾USDT','牛来USDT','ETHUSDT']),['龙虾USDT','牛来USDT','ETHUSDT']);
  assert.deepEqual(updateWatchlist(['ETHUSDT'],{op:'add',symbol:'龙虾USDT'}),['ETHUSDT','龙虾USDT']);
  for(const symbol of ['牛来USDT&limit=999','龙虾/USDT','龙虾USDT\n','USDT','btcUSDT','\u200bETHUSDT'])assert.throws(()=>validSymbols([symbol]));
});
