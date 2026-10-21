'use client';
import {useEffect,useState} from 'react';
const size=(n:number)=>`${(n/1e6).toFixed(1)} MB`;
export default function LocalMaintenance(){
  const [storage,setStorage]=useState<any>(null),[providers,setProviders]=useState<any>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[key,setKey]=useState('');
  async function read(){
    const values=await Promise.all(['/api/local/storage','/api/local/providers'].map(async path=>{const r=await fetch(path,{signal:AbortSignal.timeout(10000)});const v:any=await r.json();if(!r.ok)throw new Error(v.error||'Local settings unavailable');return v}));
    setStorage(values[0]);setProviders(values[1]);
  }
  useEffect(()=>{void read().catch(e=>setMessage(e.message))},[]);
  async function action(kind:'cleanup'|'save'|'remove'|'recover'){
    if(busy)return;setBusy(true);setMessage('Working…');
    try{
      const route=kind==='cleanup'?'/api/local/storage':kind==='recover'?'/api/local/recover-dominance':'/api/local/providers';
      const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(kind==='save'||kind==='remove'?{provider:'cmc',key:kind==='remove'?'':key}:{}),signal:AbortSignal.timeout(25000)});
      const value:any=await r.json();if(!r.ok)throw new Error(value.error||'Request failed');
      if(kind==='save'||kind==='remove')setKey('');await read();
      setMessage(kind==='cleanup'?'Disposable cache cleanup completed. Watchlist, history and saved charts were preserved.':kind==='recover'?value.message:'Provider setting saved on this PC.');
    }catch(e){setMessage((e as Error).message)}finally{setBusy(false)}
  }
  return <section style={{border:'1px solid #64748b',borderRadius:12,padding:20,margin:'24px 0'}}>
    <h2>Storage & data sources</h2>
    <p role="status">{message}</p>
    {storage&&<><p>Database: <b>{size(storage.databaseBytes)}</b> · API cache: {size(storage.cache.bytes)} · Eligible expired cache: {size(storage.reclaimableCache.bytes)}</p><p>Cache budget: {size(storage.limits.cacheBytes)} enforced hourly; a 48h fallback grace applies while under budget. Logs: at most five 4 MB files. Daily settings/history backups: 14.</p>{storage.cacheOverBudget&&<p>The cache exceeds its budget. Cleanup evicts reproducible cache entries while preserving active rate limits and saved user data.</p>}<details><summary>Storage breakdown and protected data</summary><ul>{storage.tables.filter((x:any)=>!x.name.startsWith('sqlite_')).map((x:any)=><li key={x.name}>{x.name}: {size(x.bytes)}</li>)}</ul><p>Protected: {storage.protected.join(', ')}. Chart versions share identical candles and use checksum-verified lossless compression. Every saved version remains accessible.</p></details><button className="button secondary" onClick={()=>void action('cleanup')} disabled={busy}>Clear disposable cache</button></>}
    <h3>Historical dominance recovery</h3>
    <p>CoinMarketCap key: <b>{providers?.cmc?.configured?'Configured':'Not configured'}</b>. Historical access is checked before any baseline is used. A same-provider comparison is required; CMC supplies a separately labeled 4h basket comparison. Missing CoinLore 15m observations still require local collection.</p>
    <label htmlFor="cmc-key">CoinMarketCap API key</label><br/><input id="cmc-key" type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} placeholder="Paste your key here, not in chat" style={{padding:10,width:'min(100%,360px)'}}/>{' '}
    <button className="button secondary" disabled={busy||!key.trim()} onClick={()=>void action('save')}>Save key</button>{' '}
    <button className="button secondary" disabled={busy||!providers?.cmc?.configured} onClick={()=>void action('recover')}>Test history recovery</button>{' '}
    <button className="button secondary" disabled={busy||!providers?.cmc?.configured} onClick={()=>void action('remove')}>Remove key</button>
    <p><small>Encrypted for this Windows user. Keys stay on this PC and are excluded from database backups and browser storage. <a href="https://coinmarketcap.com/api/" target="_blank" rel="noreferrer">Get a free API key ↗</a></small></p>
    <p>Gate public derivatives are available through the optional Trade Confirmation comparison. They do not replace Binance/OKX OI inside signals.</p>
  </section>;
}
