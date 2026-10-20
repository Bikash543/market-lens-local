import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {runtimeConfig, sameInstallation} from '../local/runtime-config.mjs';

test('source installs keep their existing data directory and ports', () => {
  const root=path.resolve('source-checkout'), config=runtimeConfig({},root,false);
  assert.equal(config.data,path.join(root,'data'));
  assert.equal(config.origin,'http://127.0.0.1:8787');
  assert.equal(config.wrangler,path.join(root,'node_modules','wrangler','bin','wrangler.js'));
});
test('installed app stores durable data outside replaceable program files', () => {
  const root=path.resolve('program-files'),profile=path.resolve('profile');
  const config=runtimeConfig({LOCALAPPDATA:profile},root,true);
  assert.equal(config.data,path.join(profile,'Market Lens Local','data'));
  assert.equal(config.wrangler,path.join(root,'runtime','node_modules','wrangler','bin','wrangler.js'));
  assert.throws(()=>runtimeConfig({},root,true),/unavailable/);
});
test('packaged smoke tests isolate every port and all durable state', () => {
  const data=path.resolve('smoke-state');
  const config=runtimeConfig({MARKET_LENS_PORT:'18787',MARKET_LENS_DATA_DIR:data},path.resolve('installed'),true);
  assert.equal(config.data,data);
  assert.equal(config.controlOrigin,'http://127.0.0.1:18788');
  assert.equal(config.transportOrigin,'http://127.0.0.1:18789');
  for(const value of ['80','65534','NaN','1234.5'])assert.throws(()=>runtimeConfig({MARKET_LENS_PORT:value},'.',false));
});
test('shutdown ownership does not match another source checkout', () => {
  assert.equal(sameInstallation(undefined,'.'),false);
  assert.equal(sameInstallation(path.resolve('installed'),path.resolve('installed')),true);
  assert.equal(sameInstallation(path.resolve('installed'),path.resolve('source')),false);
});
