import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshOutcome} from '../lib/refresh-outcome.ts';

test('success requires loaded data with no failures or cancellation',()=>{
  assert.equal(refreshOutcome({loaded:4}).title,'Refresh succeeded');
  assert.equal(refreshOutcome({loaded:4,failed:1}).kind,'warning');
  assert.equal(refreshOutcome({loaded:0,failed:4}).kind,'error');
  assert.equal(refreshOutcome({loaded:0}).title,'Nothing to refresh');
  assert.equal(refreshOutcome({loaded:4,cancelled:true}).title,'Refresh stopped');
});
test('analysis completion reports data loading, not trading success',()=>{
  const result=refreshOutcome({loaded:7,action:'Analysis',detail:'ETH analysis is displayed · WAIT.'});
  assert.equal(result.title,'Analysis succeeded');
  assert.match(result.detail,/WAIT/);
});
