'use client';
import {useEffect,useRef,useState} from 'react';
import RefreshFeedback,{useRefreshFeedback} from '@/components/refresh-feedback';
import {refreshOutcome} from '@/lib/refresh-outcome';
export default function LocalStatus(){
  const [status,setStatus]=useState<any>(null),[error,setError]=useState(''),[symbols,setSymbols]=useState('');
  const [loading,setLoading]=useState(false),inFlight=useRef(false),feedback=useRefreshFeedback();
  async function refresh(notify=false){
    if(inFlight.current)return;
    inFlight.current=true;setLoading(true);
    const notice=notify?feedback.begin('Reading the local collector and saved history…'):null;
    try{
      const r=await fetch('/api/local/status',{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!r.ok)throw new Error('Local status unavailable');
      setStatus(await r.json());setError('');
      if(notice!==null)feedback.finish(notice,refreshOutcome({loaded:1,detail:'Collector status and saved history are now displayed.'}));
    }catch(e){
      setError(String(e));
      if(notice!==null)feedback.finish(notice,refreshOutcome({loaded:0,failed:1,detail:String(e)}));
    }finally{setLoading(false);inFlight.current=false}
  }
  useEffect(()=>{void refresh()},[]);
  async function importWatchlist(){
    try{
      const list=symbols.split(/[\s,;]+/).filter(Boolean).map(s=>s.toUpperCase().replace(/[-/]/g,'').replace(/SWAP$/,'')).map(s=>s.endsWith('USDT')?s:s+'USDT');
      const r=await fetch('/api/local/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'import',symbols:list})});
      const data:any=await r.json();if(!r.ok)throw new Error(data.error);setSymbols('');await refresh();
    }catch(e){setError(String(e))}
  }
  return <main style={{maxWidth:900,margin:'40px auto',padding:24,fontFamily:'system-ui',lineHeight:1.7}}>
    <RefreshFeedback feedback={feedback}/>
    <a href="/">← Open Market Lens</a><h1>Market Lens · This PC</h1>
    <p>All application services run locally. Public market APIs still require an internet connection.</p>
    <button className="button" disabled={loading} aria-busy={loading} onClick={()=>void refresh(true)}>{loading?'Loading…':'Refresh status'}</button>
    {error&&<p role="alert">{error}</p>}
    {status&&<>
      <h2>{status.running?'Background collector running':'Collector is starting or stopped'}</h2>
      <p>Last heartbeat: {status.collector?.heartbeatAt?new Date(status.collector.heartbeatAt).toLocaleString():'Not received'}<br/>
      Saved observations: {status.history.observations} · 4h history: {status.history.fourHour.usable?'Ready':'Collecting — needs approximately 4 hours awake'}<br/>
      First saved observation: {status.history.firstObservationAt?new Date(status.history.firstObservationAt).toLocaleString():'Waiting'}<br/>
      Latest saved observation: {status.history.latestObservationAt?new Date(status.history.latestObservationAt).toLocaleString():'Waiting'}<br/>
      Next context collection: {status.collector?.nextContextAt?new Date(status.collector.nextContextAt).toLocaleTimeString():'Starting'}<br/>
      Display: manual Refresh / Analyse only. Closing the browser does not stop collection.</p>
      <h2>Your saved watchlist</h2><p>{status.watchlist.join(', ')||'No coins saved yet. Star a coin in All Markets.'}</p>
      <label htmlFor="import-coins">Import coins (for example BTC, ETH, SOL)</label><br/>
      <input id="import-coins" value={symbols} onChange={e=>setSymbols(e.target.value)} style={{padding:10,minWidth:280,marginRight:10}}/>
      <button className="button secondary" onClick={importWatchlist} disabled={!symbols.trim()}>Add to watchlist</button>
      <p>Saved in a local SQLite database. Browser data clearing does not erase your watchlist. Open or reload All Markets after importing.</p>
      <a href="/api/local/backup" download="market-lens-backup.json">Download settings and history backup</a>
      <h2>Background scan</h2>
      <p>Saved candle windows reused: {status.collector?.reused??0}. New windows are scheduled after their close; funding is checked independently.</p>
      {status.collector?.recovery&&<p>Last history recovery: {new Date(status.collector.recovery.at).toLocaleString()} · {status.collector.recovery.restored} original observations restored. Exchange candle history fills available price gaps. Missing CoinLore intraday observations cannot be reconstructed and remain unavailable.</p>}
      <p>{status.collector?.phase||'Starting'} · Watchlist coins have priority; all active contracts are scanned in a paced rotation on 15m and 1h.</p>
      <ul>{status.counts.map((r:any)=><li key={r.exchange+r.interval}>{r.exchange} {r.interval}: {r.loaded} loaded / {r.checked} checked</li>)}</ul>
      {!!status.collector?.errors?.length&&<details><summary>Recent feed errors</summary><ul>{status.collector.errors.map((e:any,i:number)=><li key={i}>{e}</li>)}</ul></details>}
      <p>Sleep or shutdown pauses collection. Startup resumes it; stale data never becomes a new signal. Unconnected liquidation/news feeds remain labelled manual checks.</p>
    </>}
  </main>;
}
