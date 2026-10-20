import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOKX } from '../lib/okx.ts';
import { analyze } from '../lib/engine.ts';
const step=900000, end=1800000000000, now=end+300000;
function fixture(){
 const bars=Array.from({length:60},(_,i)=>[String(end-(60-i)*step),'100','102','99','101','10','1','1000','1']).reverse();
 const flow=bars.map(k=>[k[0],'400','600']);
 const oi=Array.from({length:8},(_,i)=>[String(end-i*step),String(1000-i*5),'10','10000']);
 return {bars,flow,oi};
}
test('OKX reverses descending bars and interprets sell before buy in quote currency',()=>{const {bars,flow,oi}=fixture();const n=normalizeOKX(bars,flow,oi,'15m',now);const a=analyze('BTCUSDT','15m',n.raw,n.oi,0,now);assert.equal(a.cvd,800);assert.equal(a.imbalance,.2);assert.equal(a.closedAt,end-1);assert.ok(a.oiChange>0)});
test('OKX incomplete current candle and flow never enter the analysis',()=>{const f=fixture();const n=normalizeOKX(f.bars,f.flow,f.oi,'15m',now);assert.deepEqual(normalizeOKX([[end,'1','2','1','2','1','1','1000','0'],...f.bars],[[end,'0','1000'],...f.flow],f.oi,'15m',now),n)});
test('Missing recent flow and inconsistent quote totals reject the window',()=>{const {bars,flow,oi}=fixture();assert.throws(()=>normalizeOKX(bars,flow.slice(1),oi,'15m',now),/matching/);flow[0][1]='5';assert.throws(()=>normalizeOKX(bars,flow,oi,'15m',now),/do not match/)});

test('Older discrepancies are disclosed; valid current flow remains usable',()=>{const f=fixture();f.flow[15][1]='300';const n=normalizeOKX(f.bars,f.flow,f.oi,'15m',now);assert.match(n.dataNote,/1 older/);assert.equal(analyze('BTCUSDT','15m',n.raw,n.oi,0,now).cvd,800)});

test('Forming OKX OI bucket cannot change a closed-window signal',()=>{const f=fixture();const a=normalizeOKX(f.bars,f.flow,f.oi,'15m',now);f.oi[0][1]='999999999';const b=normalizeOKX(f.bars,f.flow,f.oi,'15m',now);assert.deepEqual(a,b);assert.equal(a.oi[0].timestamp,end);assert.equal(a.oi[0].sumOpenInterest,995)});

test('ETH hourly partial statistics stay blocked until the matching volume is republished',()=>{
  const hour=3600000,boundary=Math.floor(end/hour)*hour;
  const f=fixture();
  f.bars=f.bars.map((k,i)=>[String(boundary-(i+1)*hour),...k.slice(1)]);
  f.flow=f.bars.map(k=>[k[0],'400','600']);
  f.oi=f.oi.map((k,i)=>[String(boundary-i*hour),...k.slice(1)]);
  // Observed ETH 03:00 UTC candle was 169,456,165.00215, while a cached
  // partial Rubik bucket summed to 165,422,683.50747 (2.38% short).
  f.bars[0][7]='169456165.00215';
  f.flow[0][1]='65464411.19739';f.flow[0][2]='99958272.31008';
  assert.throws(()=>normalizeOKX(f.bars,f.flow,f.oi,'1h',boundary+60000),/2.38% difference/);
  f.flow[0][2]=String(169456165.00215-65464411.19739);
  const normalized=normalizeOKX(f.bars,f.flow,f.oi,'1h',boundary+60000);
  const result=analyze('ETHUSDT','1h',normalized.raw,normalized.oi,0,boundary+60000);
  assert.equal(result.closedAt,boundary-1);
  assert.equal(result.oiAt,boundary);
});
