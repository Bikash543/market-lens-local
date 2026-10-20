'use client';
import {useEffect,useRef,useState} from 'react';
import {Check,LoaderCircle,Search,X} from 'lucide-react';
import {searchConfirmationMarkets,type ConfirmationMarket} from '@/lib/confirmation-symbols';

export default function CoinSearch({selected,onSelect,onEdit}:{selected:string;onSelect:(symbol:string)=>void;onEdit:()=>void}){
  const [query,setQuery]=useState(''),[markets,setMarkets]=useState<ConfirmationMarket[]|null>(null);
  const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[index,setIndex]=useState(0);
  const input=useRef<HTMLInputElement|null>(null);
  // Only a user's non-empty search loads the directory. It contains symbols,
  // not quotes, candles, or analyses. Subsequent searches filter it locally.
  useEffect(()=>{
    if(!query.trim()||markets)return;
    const abort=new AbortController();
    const delay=setTimeout(async()=>{
      setLoading(true);setError('');
      const timeout=setTimeout(()=>abort.abort(),15000);
      try{
        const r=await fetch('/api/confirmation/symbols',{signal:abort.signal,cache:'no-store'});
        const result=await r.json() as {rows?:ConfirmationMarket[];error?:string};
        if(!r.ok||!Array.isArray(result.rows))throw new Error(result.error||'Coin search unavailable. Edit your search to retry.');
        if(!abort.signal.aborted)setMarkets(result.rows);
      }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Coin search unavailable. Edit your search to retry.');else if(!cancelled)setError('Coin search timed out. Edit your search to retry.')}
      finally{clearTimeout(timeout);if(!cancelled)setLoading(false)}
    },250);
    let cancelled=false;
    return()=>{cancelled=true;clearTimeout(delay);abort.abort();setLoading(false)};
  },[query,markets]);
  const results=searchConfirmationMarkets(markets??[],query),show=open&&!!query.trim()&&!selected;
  function choose(symbol:string){onSelect(symbol);setQuery(symbol);setOpen(false);setIndex(0)}
  function edit(value:string){setQuery(value);setOpen(true);setIndex(0);setError('');onEdit()}
  return <div className="coin-search-section">
    <label htmlFor="confirmation-coin">Search a coin</label>
    <div className="coin-search-control">
      <Search size={18}/>
      <input id="confirmation-coin" ref={input} role="combobox" aria-label="Search a coin" aria-autocomplete="list" aria-expanded={show} aria-controls="confirmation-coins" aria-activedescendant={show&&results[index]?`confirmation-option-${index}`:undefined} autoComplete="off" placeholder="Search symbol or pair, e.g. XRP or DOGEUSDT" value={query}
        onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)} onChange={e=>edit(e.target.value)}
        onKeyDown={e=>{
          if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setIndex(i=>Math.max(0,Math.min(i+1,results.length-1)))}
          if(e.key==='ArrowUp'){e.preventDefault();setIndex(i=>Math.max(0,i-1))}
          if(e.key==='Escape')setOpen(false);
          if(e.key==='Enter'){e.preventDefault();if(show&&results[index])choose(results[index].symbol)}
        }}/>
      {loading?<LoaderCircle size={17} className="spin"/>:selected?<Check size={17}/>:null}
      {!!query&&<button type="button" aria-label="Clear coin selection" onClick={()=>{edit('');input.current?.focus()}}><X size={17}/></button>}
    </div>
    {show&&<div className="coin-search-results">
      <div role="listbox" id="confirmation-coins" aria-label="Matching coins">
        {results.map((market,i)=><button type="button" role="option" id={`confirmation-option-${i}`} aria-selected={i===index} key={market.instrument} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(market.symbol)}>
          <span><b>{market.symbol}</b><small> / USDT</small></span><span>OKX perpetual</span>
        </button>)}
      </div>
      <p role="status">{error||(!markets?(loading?'Loading available coins…':'Searching…'):results.length?'Select a coin, then click Analyse it.':'No matching active OKX USDT perpetual. Try another symbol.')}</p>
    </div>}
    <p className="coin-search-hint">{selected?`${selected} / USDT selected. Analysis starts only when you click Analyse it.`:'Available OKX USDT perpetuals · search and selection do not run an analysis.'}</p>
  </div>;
}
