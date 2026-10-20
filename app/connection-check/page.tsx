'use client';
import { useEffect,useRef,useState } from 'react';
import { scanBrowserOKX } from '@/lib/okx-browser';
import { api } from '@/lib/browser-api';
import { signal,dominanceStatus,type Analysis,type Dominance } from '@/lib/engine';
import { ThemeToggle } from '@/components/theme-toggle';

type Result={coin:string;interval:string;status:string;seconds:number;closedAt?:number;oiAt?:number;candles?:number;error?:string;signal?:string;score?:number;checks?:ReturnType<typeof signal>['checks'];analysis?:Analysis};
export default function ConnectionCheck(){
  const [rows,setRows]=useState<Result[]>([]),[running,setRunning]=useState(false),[tested,setTested]=useState('');
  const [dominance,setDominance]=useState<Dominance|null>(null),[dominanceError,setDominanceError]=useState('');
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function run(){
    if(running)return;
    const c=new AbortController();controller.current=c;
    setRunning(true);setRows([]);setDominance(null);setDominanceError('');setTested(new Date().toISOString());
    let context:Dominance|null=null;
    try{
      try{context=await api('/api/global',undefined,c.signal);setDominance(context)}
      catch(e){if(c.signal.aborted)return;setDominanceError((e as Error).message)}
      for(const interval of ['15m','1h'])for(const coin of ['BTC','ETH','SOL','AGLD','SUI','SEI','LTC']){
        if(c.signal.aborted)return;
        const start=performance.now();let row:Result;
        try{
          const a=await scanBrowserOKX(coin+'USDT',interval,c.signal);
          const s=signal(a,context,Date.now());
          if(s.checks.length!==6||s.side==='stale')throw new Error('Signal validation did not produce six current checks');
          row={coin,interval,status:'PASS',seconds:+((performance.now()-start)/1000).toFixed(2),closedAt:a.closedAt,oiAt:a.oiAt,candles:a.candles.length,signal:s.label,score:s.score,checks:s.checks,analysis:a};
        }catch(e){
          if(c.signal.aborted)return;
          row={coin,interval,status:'RETRY',seconds:+((performance.now()-start)/1000).toFixed(2),error:(e as Error).message};
        }
        setRows(old=>[...old,row]);
      }
    }finally{setRunning(false)}
  }
  const report={tested,venue:'OKX',transport:'Browser candles + shared OKX OI/CVD/funding',dominance,dominanceError,results:rows};
  function download(){
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='market-lens-connection-check.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const dominanceReady=dominanceStatus(dominance).ready;
  return <main className="feed-check">
    <div className="check-header"><a href="/">← Back to Market Lens</a><ThemeToggle/></div>
    <h1>Live feed & signal check</h1>
    <p>BTC, ETH, SOL, AGLD, SUI, SEI and LTC · 15m and 1h · OKX perpetuals</p>
    <p>Checks real candles, aligned open interest, taker flow, fresh funding and all six signal rules. A neutral or watch result is valid: PASS means the data and rules were evaluated, not a buy or sell recommendation.</p>
    <div className="check-actions">
      <button className="button" disabled={running} onClick={run}>{running?'Checking feeds…':'Run 14 feed checks'}</button>
      <button className="button secondary" disabled={!rows.length||running} onClick={download}>Download results</button>
    </div>
    <p role="status">{rows.filter(r=>r.status==='PASS').length} / 14 passed · {rows.length} checked{running?' · Running':tested?' · Complete':''}</p>
    {tested&&<><p>Started: {tested} · Response time includes pacing and cache access.</p><p>Dominance: {dominanceReady?`${dominance!.source} · current BTC and USDT baseline available`:dominanceError||'Baseline unavailable; full long/short setups are withheld'}</p></>}
    <div className="check-results"><table>
      <thead><tr><th>Coin</th><th>Timeframe</th><th>Data</th><th>Signal</th><th>Aligned</th><th>Seconds</th><th>Candle close UTC</th><th>OI boundary UTC</th></tr></thead>
      <tbody>{rows.map(r=><tr key={r.coin+r.interval}><td>{r.coin}</td><td>{r.interval}</td><td className={r.status==='PASS'?'positive':'negative'} title={r.error}>{r.status}{r.error&&<small>{r.error}</small>}</td><td>{r.signal??'Withheld'}</td><td>{r.score!==undefined?`${r.score}/6`:'—'}</td><td>{r.seconds.toFixed(2)}</td><td>{r.closedAt?new Date(r.closedAt).toISOString().replace('.999Z','Z'):'—'}</td><td>{r.oiAt?new Date(r.oiAt).toISOString().replace('.000Z','Z'):'—'}</td></tr>)}</tbody>
    </table></div>
    <p>A successful check confirms access and rule evaluation at the displayed time, not future uptime or strategy profitability. Missing or stale data cannot create a full setup.</p>
    {!!rows.length&&<details><summary>Inspect JSON results</summary><pre aria-label="Validation results JSON">{JSON.stringify(report,null,2)}</pre></details>}
  </main>;
}
