'use client';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, BookOpen, Check, ChevronLeft, ChevronRight, CircleHelp, ExternalLink, Globe2, Layers3, Pause, Play, Radio, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Star, Waves, X } from 'lucide-react';
import { signal, signalCoverage, dominanceStatus, type Analysis, type Dominance } from '@/lib/engine';
import { api,APIError } from '@/lib/browser-api';
import { manualScanTargets,runManualScan,type ScanProgress } from '@/lib/manual-scan';
import { useFrameTheme } from './frame-theme';
import { scanBrowserOKX } from '@/lib/okx-browser';
import { loadMarketFeed } from '@/lib/market-browser';
import { ThemeToggle } from './theme-toggle';
import NavigationRail from './navigation-rail';
import RefreshFeedback,{useRefreshFeedback} from './refresh-feedback';
import {refreshOutcome} from '@/lib/refresh-outcome';
type Market={exchange:string;instrument:string;symbol:string;base:string;price:number;change:number;volume:number;funding:number;fundingHours:number;nextFunding:number;updated:number};
type ScanError={symbol:string;error:string;updated:number;retryAt:number;attempts:number};
type SavedView={analyses:Record<string,Analysis>;errors:Record<string,ScanError>;finished:Record<string,number>};
const numberFormats=new Map<number,Intl.NumberFormat>();
const compactFormat=new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2});
const fmt=(n:number|undefined|null,d=2)=>{
  if(n==null||!Number.isFinite(n))return '—';
  if(!numberFormats.has(d))numberFormats.set(d,new Intl.NumberFormat('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}));
  return numberFormats.get(d)!.format(n);
};
const compact=(n:number|undefined|null)=>n==null||!Number.isFinite(n)?'—':compactFormat.format(n);
const price=(n:number|undefined)=>n==null?'—':fmt(n,n>=100?2:n>=1?3:Math.min(12,Math.max(4,Math.ceil(-Math.log10(n||1))+4)));
const sign=(n:number)=>n>0?'+':'';
const age=(t:number,now:number)=>!t?'Not received':now-t<60000?'Just now':`${Math.floor((now-t)/60000)}m ago`;
function Spark({values,color='var(--green)',large=false}:{values:number[];color?:string;large?:boolean}){
  if(values.length<2)return <span className="empty-spark">Collecting observations</span>;
  const lo=Math.min(...values),hi=Math.max(...values),range=hi-lo||1;
  const points=values.map((v,i)=>`${i/(values.length-1)*600},${100-(v-lo)/range*85}`).join(' ');
  return <svg className={large?'spark large':'spark'} viewBox="0 0 600 110" preserveAspectRatio="none" role="img" aria-label="Recent observed trend"><polyline points={points} fill="none" stroke={color} strokeWidth={large?2:3} vectorEffect="non-scaling-stroke"/></svg>;
}
type RowProps={row:Market;analysis?:Analysis;error?:ScanError;state:ReturnType<typeof signal>;selected:boolean;watching:boolean;age:string;onSelect:(symbol:string)=>void;onWatch:(symbol:string)=>void};
const MarketRow=memo(function MarketRow({row:r,analysis:a,error,state:s,selected,watching,age,onSelect,onWatch}:RowProps){
  return <tr className={selected?'selected-row':''} onClick={()=>onSelect(r.symbol)}>
    <td><div className="asset-cell"><button className={`star ${watching?'starred':''}`} aria-label={`${watching?'Remove':'Add'} ${r.base} ${watching?'from':'to'} watchlist`} onClick={e=>{e.stopPropagation();onWatch(r.symbol)}}><Star size={13}/></button><span className={`coin coin-${r.base.toLowerCase()}`}>{r.base==='BTC'?'₿':r.base==='ETH'?'Ξ':r.base.slice(0,1)}</span><button className="asset-name" onClick={()=>onSelect(r.symbol)}><b>{r.base}</b><small>{r.exchange} · USDT</small></button></div></td>
    <td><b className="numeric">{price(r.price)}</b><small className={r.change>=0?'positive':'negative'}>{sign(r.change)}{fmt(r.change)}%</small></td>
    <td><span className={a?(a.oiChange>=0?'positive':'negative'):'muted'}>{a?`${sign(a.oiChange)}${fmt(a.oiChange)}%`:'—'}</span><small>{a?`${error||s.side==='stale'?'Cached · ':''}$${compact(a.oi)}`:'Awaiting data'}</small></td>
    <td className="numeric">{fmt(r.funding*100,4)}%<small>per {r.fundingHours}h</small></td>
    <td><span className={a?(a.cvd>=0?'positive':'negative'):'muted'}>{a?`${sign(a.cvd)}$${compact(a.cvd)}`:'—'}</span><small>{a?`${fmt(a.imbalance*100,1)}% imbalance`:'—'}</small></td>
    <td><span className={`badge ${error?'waiting':s.side}`} title={error?.error||s.reasons.join('; ')}>{error?'Unavailable':s.label}</span><small>{a?`${error?'Last good':s.side==='stale'?'Refresh needed':`${s.score}/6`} · ${age}`:error?'Feed failed · refresh to retry':'Not analyzed yet'}</small></td>
  </tr>;
},(a,b)=>a.row===b.row&&a.analysis===b.analysis&&a.error===b.error&&a.selected===b.selected&&a.watching===b.watching&&a.age===b.age&&a.onSelect===b.onSelect&&a.onWatch===b.onWatch&&a.state.side===b.state.side&&a.state.score===b.state.score&&a.state.reasons.join(';')===b.state.reasons.join(';'));
export default function Dashboard({initialView,embedded=false}:{initialView?:string;embedded?:boolean}){
  useFrameTheme();
  const feedback=useRefreshFeedback();
  const [rows,setRows]=useState<Market[]>([]),[analyses,setAnalyses]=useState<Record<string,Analysis>>({}),[errors,setErrors]=useState<Record<string,ScanError>>({});
  const [exchange,setExchange]=useState(''),[fallback,setFallback]=useState('');
  const [transport,setTransport]=useState(''),marketRetry=useRef(0);
  const [dom,setDom]=useState<Dominance|null>(null),[marketError,setMarketError]=useState(''),[globalError,setGlobalError]=useState('');
  const [updated,setUpdated]=useState(0),[now,setNow]=useState(0),[interval,setIntervalChoice]=useState('1h'),[busy,setBusy]=useState(false);
  const [search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[sort,setSort]=useState('volume'),[page,setPage]=useState(0),[selected,setSelected]=useState('ETHUSDT'),[tab,setTab]=useState('price'),[method,setMethod]=useState(initialView==='methodology'),[health,setHealth]=useState(initialView==='health'),[watch,setWatch]=useState<string[]>([]),[watchOnly,setWatchOnly]=useState(initialView==='watchlist');
  const rowsRef=useRef(rows),analysesRef=useRef(analyses),errorRef=useRef(errors),selectedRef=useRef(selected),cycle=useRef(0);
  const watchRef=useRef(watch),finishedRef=useRef<Record<string,number>>({});
  const [pageSize,setPageSize]=useState(50),[scanProgress,setScanProgress]=useState<(ScanProgress&{key:string;scope:string})|null>(null);
  const views=useRef(new Map<string,SavedView>()),viewKey=useRef('');
  const [foreground,setForeground]=useState(true);
  const [detail,setDetail]=useState<any>(null),[detailError,setDetailError]=useState(''),[detailLoading,setDetailLoading]=useState(false);
  const detailCache=useRef(new Map<string,any>());
  const [watchReady,setWatchReady]=useState(false),[watchSaveError,setWatchSaveError]=useState('');
  const watchQueue=useRef(Promise.resolve());
  const marketFlight=useRef(false),globalFlight=useRef(false),[online,setOnline]=useState(true);
  useEffect(()=>{if(!method&&!health)return;const previous=document.activeElement as HTMLElement;const modal=document.querySelector('.modal') as HTMLElement;const close=modal?.querySelector('button');close?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setMethod(false);setHealth(false)}if(e.key==='Tab'){const all=Array.from(modal.querySelectorAll<HTMLElement>('button,a[href],input,select'));if(!all.length)return;const first=all[0],last=all.at(-1)!;if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus()}},[method,health]);
  useEffect(()=>{rowsRef.current=rows},[rows]);useEffect(()=>{analysesRef.current=analyses},[analyses]);useEffect(()=>{errorRef.current=errors},[errors]);useEffect(()=>{selectedRef.current=selected},[selected]);
  useEffect(()=>{watchRef.current=watch},[watch]);
  useEffect(()=>{const change=()=>setOnline(navigator.onLine);change();window.addEventListener('online',change);window.addEventListener('offline',change);return()=>{window.removeEventListener('online',change);window.removeEventListener('offline',change)}},[]);
  useEffect(()=>{
    const changed=()=>{setForeground(!document.hidden);setNow(Date.now())};
    changed();document.addEventListener('visibilitychange',changed);
    return()=>document.removeEventListener('visibilitychange',changed);
  },[]);
  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const r=await fetch('/api/local/profile',{cache:'no-store'});
        if(!r.ok)throw new Error('Cannot read the saved watchlist.');
        let value:any=await r.json();
        if(!value.initialized){
          let old:string[]=[];try{old=JSON.parse(localStorage.getItem('market-lens-watch')||'[]')}catch{}
          if(Array.isArray(old)&&old.length){
            const imported=await fetch('/api/local/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'import',symbols:old})});
            if(!imported.ok)throw new Error('Watchlist import failed.');
            value=await imported.json();
          }
        }
        if(active){watchRef.current=value.watchlist;setWatch(value.watchlist);setWatchReady(true)}
      }catch(e){if(active)setWatchSaveError((e as Error).message)}
    })();return()=>{active=false};
  },[]);
  useEffect(()=>{
    if(!foreground)return;
    const update=()=>{setNow(Date.now());};
    update();const timer=window.setInterval(update,5000);
    return()=>window.clearInterval(timer);
  },[foreground]);
  const toggleWatch=useCallback((s:string)=>{
    if(!watchReady)return;
    const removing=watchRef.current.includes(s);
    const next=removing?watchRef.current.filter(x=>x!==s):[...watchRef.current,s];
    watchRef.current=next;setWatch(next);
    watchQueue.current=watchQueue.current.then(async()=>{
      try{
        const r=await fetch('/api/local/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:removing?'remove':'add',symbol:s})});
        const value:any=await r.json();if(!r.ok)throw new Error(value.error||'Save failed');
        try{localStorage.setItem('market-lens-watch',JSON.stringify(value.watchlist))}catch{}
        setWatchSaveError('');
      }catch{setWatchSaveError('Watchlist save failed. Reload this page to restore the last disk-saved watchlist.')}
    });
  },[watchReady]);
  const selectAsset=useCallback((symbol:string)=>{setSelected(symbol);setTab('price')},[]);
  const loadMarket=useCallback(async(cancel?:AbortSignal)=>{
    if(marketFlight.current||marketRetry.current>Date.now())return false;marketFlight.current=true;
    try{const d=await loadMarketFeed(cancel);if(cancel?.aborted)return false;
      if(!Array.isArray(d.rows)||!d.rows.length)throw new Error('Waiting for available contracts');
      marketRetry.current=0;setRows(d.rows);rowsRef.current=d.rows;setExchange(d.exchange);setTransport(d.transport||'server');setFallback(d.fallbackReason||'');setUpdated(d.updated);setMarketError(d.refreshError?`Showing the last snapshot. ${d.refreshError}`:'');return !d.stale;
    }catch(e){if(!cancel?.aborted){marketRetry.current=Date.now()+(e instanceof APIError?e.retryAfterMs:15000);setMarketError((e as Error).message)}return false}finally{marketFlight.current=false}
  },[]);
  const loadGlobal=useCallback(async(cancel?:AbortSignal)=>{
    if(globalFlight.current)return false;globalFlight.current=true;
    try{const d=await api('/api/global',undefined,cancel);if(cancel?.aborted)return false;setDom(d);setGlobalError(d.historyError||'');return !d.historyError}
    catch(e){if(!cancel?.aborted)setGlobalError((e as Error).message);return false}finally{globalFlight.current=false}
  },[]);
  useEffect(()=>{
    if(viewKey.current)views.current.set(viewKey.current,{analyses:analysesRef.current,errors:errorRef.current,finished:finishedRef.current});
    const key=`${exchange}:${interval}`,saved=views.current.get(key);
    analysesRef.current=saved?.analyses??{};errorRef.current=saved?.errors??{};finishedRef.current=saved?.finished??{};
    setAnalyses(analysesRef.current);setErrors(errorRef.current);viewKey.current=key;
    // Separate keys prevent results from another exchange or timeframe leaking in.
  },[interval,exchange]);
  const scanController=useRef<AbortController|null>(null),refreshFlight=useRef(false);
  useEffect(()=>()=>{
    cycle.current++;scanController.current?.abort();
  },[interval]);
  useEffect(()=>{
    if(!embedded)return;
    const receive=(event:MessageEvent)=>{
      if(event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='workspace-view')return;
      const view=event.data.view;
      if(view==='markets'||view==='watchlist')setWatchOnly(view==='watchlist');
      if(view==='methodology')setMethod(true);
      if(view==='health')setHealth(true);
    };
    window.addEventListener('message',receive);
    window.parent.postMessage({type:'workspace-ready'},location.origin);
    return()=>window.removeEventListener('message',receive);
  },[embedded]);
  const scored=useMemo(()=>Object.fromEntries(Object.entries(analyses).map(([symbol,a])=>[symbol,signal(errors[symbol]?undefined:a,dom,now)])),[analyses,errors,dom,now]);
  const waiting=useMemo(()=>signal(undefined,dom,now),[dom,now]);
  const enriched=useMemo(()=>rows.map(r=>({...r,analysis:analyses[r.symbol],signal:scored[r.symbol]??waiting})),[rows,analyses,scored,waiting]);
  const deferredSearch=useDeferredValue(search);
  const marketBySymbol=useMemo(()=>new Map(rows.map(r=>[r.symbol,r])),[rows]);
  const visible=useMemo(()=>enriched.filter(r=>(!watchOnly||watch.includes(r.symbol))&&r.symbol.toLowerCase().includes(deferredSearch.toLowerCase().replace('/',''))&&(filter==='all'||r.signal.side===filter)).sort((a,b)=>sort==='signal'?b.signal.score-a.signal.score||b.volume-a.volume:sort==='oi'?(b.analysis?.oiChange??-Infinity)-(a.analysis?.oiChange??-Infinity):sort==='change'?b.change-a.change:b.volume-a.volume),[enriched,watchOnly,watch,deferredSearch,filter,sort]);
  useEffect(()=>{setPage(0)},[search,filter,watchOnly,sort,interval,pageSize]);
  const perPage=pageSize||Math.max(1,visible.length),pageCount=Math.max(1,Math.ceil(visible.length/perPage)),currentPage=Math.min(page,pageCount-1);
  const coverage=useMemo(()=>signalCoverage(rows.map(r=>r.symbol),analyses,errors,now),[rows,analyses,errors,now]);
  const diagnostics=useMemo(()=>{
    const active=enriched.filter(r=>r.signal.checks.length===6);
    return ['Price & trend','Open interest','Taker flow / CVD','Funding','USDT dominance','BTC dominance'].map((name,i)=>({name,passed:active.filter(r=>r.signal.checks[i].ok).length,total:active.length}));
  },[enriched]);
  const shown=visible.slice(currentPage*perPage,(currentPage+1)*perPage),asset=marketBySymbol.get(selected),a=analyses[selected],s=scored[selected]??waiting,numScanned=coverage.current,countLong=enriched.filter(r=>r.signal.side==='long').length,countShort=enriched.filter(r=>r.signal.side==='short').length;
  // Read only the exact displayed candle version. Selecting a row does not
  // refresh quotes, signals or providers, even if the collector has moved on.
  useEffect(()=>{
    const stop=new AbortController(),key=`${exchange}:${selected}:${interval}:${a?.closedAt}`;
    setDetailError('');setDetail(null);setDetailLoading(false);
    if(!a)return;
    if(a.candles.length){setDetail(a);return}
    const cached=detailCache.current.get(key);if(cached){setDetail(cached);return}
    setDetailLoading(true);
    void api(`/api/local/analysis-detail?exchange=${exchange}&symbol=${selected}&interval=${interval}&closedAt=${a.closedAt}`,undefined,stop.signal).then(value=>{
      if(stop.signal.aborted)return;
      detailCache.current.set(key,value);if(detailCache.current.size>100)detailCache.current.delete(detailCache.current.keys().next().value!);
      setDetail(value);
    }).catch(e=>{if(!stop.signal.aborted)setDetailError(e.message)}).finally(()=>{if(!stop.signal.aborted)setDetailLoading(false)});
    return()=>stop.abort();
  },[exchange,selected,interval,a?.closedAt]);
  const chart=detail?.closedAt===a?.closedAt&&detail?.symbol===selected&&detail?.interval===interval?detail:null;
  const currentScan=scanProgress?.key===`${exchange}:${interval}`?scanProgress:null;
  const scanLabel=!online?'Offline':currentScan?`${currentScan.cancelled?'Scan stopped':busy?`Scanning ${currentScan.scope}`:'Scan complete'} · ${currentScan.completed}/${currentScan.total} checked · ${currentScan.succeeded} loaded · ${currentScan.failed} unavailable`:busy?'Loading market list…':'Click Refresh to scan all markets';
  const dominance=dominanceStatus(dom,now),domFresh=dominance.fresh,domReady=dominance.ready;
  const refresh=async(onlySelected=false)=>{
    if(refreshFlight.current)return;
    const notice=feedback.begin(onlySelected?'Loading the selected asset and its market context…':'Loading market data and checking the requested coins…');
    if(!navigator.onLine){feedback.finish(notice,refreshOutcome({loaded:0,failed:1,detail:'You are offline. Reconnect, then click Refresh.'}));return}
    refreshFlight.current=true;setBusy(true);setScanProgress(null);
    const cancel=new AbortController();scanController.current=cancel;
    const generation=++cycle.current,requestedInterval=interval;
    let loadedFeeds=0,failedFeeds=0,reusedCount=0,scanState:ScanProgress|null=null;
    try{
      // A selected-asset refresh also updates its required global context and
      // the shared quote snapshot; only that asset's analysis is requested.
      const feeds=await Promise.all([loadMarket(cancel.signal),loadGlobal(cancel.signal)]);
      loadedFeeds=feeds.filter(Boolean).length;failedFeeds=feeds.length-loadedFeeds;
      if(cancel.signal.aborted)return;
      const venue=rowsRef.current[0]?.exchange;
      if(!venue){feedback.finish(notice,refreshOutcome({loaded:loadedFeeds,failed:Math.max(1,failedFeeds),detail:'Market contracts could not be loaded. Check the feed message and try again.'}));return}
      const targets=manualScanTargets(rowsRef.current,selectedRef.current,{onlySelected,watchOnly,watch:watchRef.current});
      if(!targets.length){feedback.finish(notice,refreshOutcome({loaded:0,detail:watchOnly?'No active watchlist coins to analyse. Add a coin, then refresh.':'The selected coin is not in the active market list.'}));return}
      const scope=onlySelected?'selected coin':watchOnly?'watchlist':'all markets';
      const key=`${venue}:${requestedInterval}`;
      const saved=views.current.get(key);
      let good=viewKey.current===key?analysesRef.current:saved?.analyses??{};
      let collectedErrors:Record<string,ScanError>|null=null;
      // Load background observations only inside this user-requested refresh.
      let pendingTargets=targets;
      try{
        const local=await api('/api/local/snapshot',{exchange:venue,interval:requestedInterval,symbols:targets},cancel.signal);
        good={...good,...local.analyses};collectedErrors=local.errors;
        pendingTargets=local.pending;reusedCount=local.reused.length;
      }catch{/* A full scan remains available if bulk validation fails. */}
      let failures={...(viewKey.current===key?errorRef.current:saved?.errors??{})};
      if(collectedErrors){for(const symbol of targets){delete failures[symbol];if(collectedErrors[symbol])failures[symbol]=collectedErrors[symbol]}}
      const finished={...(saved?.finished??{})};
      views.current.set(key,{analyses:good,errors:failures,finished});
      if(generation===cycle.current){analysesRef.current=good;errorRef.current=failures;setAnalyses(good);setErrors(failures)}
      let publishTimer:ReturnType<typeof setTimeout>|undefined;
      const publish=()=>{
        clearTimeout(publishTimer);publishTimer=undefined;
        views.current.set(key,{analyses:good,errors:failures,finished});
        if(generation===cycle.current){analysesRef.current=good;errorRef.current=failures;setAnalyses(good);setErrors(failures)}
      };
      const schedulePublish=()=>{if(!publishTimer)publishTimer=setTimeout(publish,150)};
      await runManualScan({
        symbols:pendingTargets,signal:cancel.signal,spacingMs:0,concurrency:2,timeoutMs:55000,
        run:async(symbol,signal)=>{
          // All local scans use the PC server, sharing its collector cache.
          const d=await api('/api/scan',{symbols:[symbol],interval:requestedInterval,exchange:venue,summary:true,selected:symbol===selectedRef.current},signal),row=d.rows?.[0];
          if(!row||row.symbol!==symbol||row.error)throw new APIError(row?.error||'Incomplete scan response',row?.retryAfterMs);
          return row as Analysis;
        },
        success:(symbol,result)=>{
          good={...good,[symbol]:result};failures={...failures};delete failures[symbol];finished[symbol]=Date.now();
          schedulePublish();
        },
        failure:(symbol,error)=>{
          const retry=error instanceof APIError?error.retryAfterMs:15000;
          failures={...failures,[symbol]:{symbol,error:(error as Error).message.replace(/automatic retry scheduled|retrying automatically/gi,'click Refresh after the cooldown to retry'),updated:Date.now(),attempts:1,retryAt:Date.now()+retry}};
          views.current.set(key,{analyses:good,errors:failures,finished});
          schedulePublish();
        },
        progress:(_remaining,state)=>{const totalState={...state,total:targets.length,completed:state.completed+reusedCount,succeeded:state.succeeded+reusedCount};scanState=totalState;if(generation===cycle.current||(cancel.signal.aborted&&scanController.current===cancel))setScanProgress({...totalState,key,scope})}
      });
      publish();
      const completed=scanState as ScanProgress|null;
      feedback.finish(notice,refreshOutcome({
        loaded:loadedFeeds+(completed?.succeeded??0),failed:failedFeeds+(completed?.failed??0),cancelled:cancel.signal.aborted,
        detail:`${completed?.succeeded??0}/${targets.length} coins loaded · ${reusedCount} reused${completed?.failed?` · ${completed.failed} unavailable`:''}.${failedFeeds?' Some market context could not be updated.':''}`
      }));
    }catch(e){
      feedback.finish(notice,refreshOutcome({loaded:loadedFeeds,failed:1,cancelled:cancel.signal.aborted,detail:(e as Error).message||'Data could not be updated. Please try again.'}));
    }finally{
      if(cancel.signal.aborted)feedback.finish(notice,refreshOutcome({loaded:0,cancelled:true,detail:'The scan was cancelled. Already loaded data remains on screen.'}));
      refreshFlight.current=false;setBusy(false);setNow(Date.now());
    }
  };
  const stop=a?a.price-s.direction*1.5*a.atr:0,target=a?a.price+s.direction*3*a.atr:0;
  return <div className={`app-shell${embedded?' embedded-market':''}`}>
    <RefreshFeedback feedback={feedback} progress={busy&&currentScan?`${currentScan.completed}/${currentScan.total} coins checked · ${currentScan.succeeded} loaded · ${currentScan.failed} unavailable`:undefined}/>
    {!embedded&&<NavigationRail active={watchOnly?'watchlist':'markets'} onMarkets={()=>setWatchOnly(false)} onWatchlist={()=>setWatchOnly(true)} onMethod={()=>setMethod(true)} onHealth={()=>setHealth(true)}/>}
    <main><header className="topbar"><div className="brand">MARKET<span>LENS</span><span className="brand-divider"/><span className="workspace">Futures intelligence</span></div><div className="header-right"><a href="/local" target="_blank" rel="noreferrer" className="button secondary">This PC</a><ThemeToggle/><span className="connection"><i/>{!online?'Offline':busy?'Refreshing on request':'Manual refresh only'}</span><button className="icon-button" title="Data sources & health" onClick={()=>setHealth(true)}><Activity size={18}/></button></div></header>
      <div className="content"><div className="page-title"><div><div className="eyebrow">LOCAL FUTURES WORKSPACE</div><h1>Market overview</h1><p>Open interest, funding and order flow across crypto futures.</p></div><div className="page-actions"><button className="button secondary" onClick={()=>setMethod(true)}><CircleHelp size={15}/> How signals work</button><button className="button" disabled={busy} aria-busy={busy} onClick={()=>void refresh()}><RefreshCw size={15} className={busy?'refresh-feedback-spinner':''}/> {busy?'Loading…':'Refresh'}</button></div></div>
        {watchSaveError&&<div className="notice" role="alert">{watchSaveError}</div>}
        {(marketError||globalError)&&<div className="notice" role="status"><Radio size={17}/><span>{marketError?`Exchange feed: ${marketError}`:`Dominance feed: ${globalError}`} {marketError?'No live prices or signals are being invented.':'Full setups are withheld when dominance is unavailable or stale.'}</span><button onClick={()=>void refresh()}>Retry</button></div>}
        {exchange==='OKX'&&<div className="source-strip"><span className="source-tag"><Radio size={12}/> OKX DATA</span><span>{transport==='browser'?'OKX perpetuals · direct market connection':'Binance unavailable · using OKX perpetuals'}</span><button onClick={()=>setHealth(true)}>Data health</button></div>}
        <section className="metric-grid">
          <div className="metric"><div className="metric-label"><Globe2 size={15}/> BTC dominance <span>GLOBAL</span></div><div className="metric-value">{domFresh?fmt(dom!.btc):'—'}<small>%</small></div><div className="metric-bottom"><span className={domReady?(dom!.btcChange!>=0?'positive':'negative'):'muted'}>{domReady?`${sign(dom!.btcChange!)}${fmt(dom!.btcChange,3)} pp`:'Baseline warming'}</span><span>~1h change</span></div><div className="metric-chart"><Spark values={dom?.history.map(d=>d.btc)||[]}/></div></div>
          <div className="metric"><div className="metric-label"><ShieldCheck size={15}/> USDT dominance <span>GLOBAL</span></div><div className="metric-value">{domFresh?fmt(dom!.usdt):'—'}<small>%</small></div><div className="metric-bottom"><span className={domReady?(dom!.usdtChange!>=0?'negative':'positive'):'muted'}>{domReady?`${sign(dom!.usdtChange!)}${fmt(dom!.usdtChange,3)} pp`:'Baseline warming'}</span><span>~1h change</span></div><div className="metric-chart"><Spark values={dom?.history.map(d=>d.usdt)||[]} color="var(--accent)"/></div></div>
          <div className="metric"><div className="metric-label"><ArrowUpRight size={17}/> Long setups <span>{interval}</span></div><div className="metric-value positive">{countLong.toString().padStart(2,'0')}<small className="slash"> / {numScanned}</small></div><div className="metric-bottom"><span>All 6 checks aligned · of {numScanned} current analyses</span><span className="tiny-dot green"/></div><div className="meter"><i style={{width:`${numScanned?countLong/numScanned*100:0}%`}}/></div></div>
          <div className="metric"><div className="metric-label"><ArrowDownRight size={17}/> Short setups <span>{interval}</span></div><div className="metric-value negative">{countShort.toString().padStart(2,'0')}<small className="slash"> / {numScanned}</small></div><div className="metric-bottom"><span>All 6 checks aligned · of {numScanned} current analyses</span><span className="tiny-dot red"/></div><div className="meter red-meter"><i style={{width:`${numScanned?countShort/numScanned*100:0}%`}}/></div></div>
        </section>
        <div className="context-strip"><span className="pill"><Radio size={13}/> MARKET CONTEXT</span><span>{dominance.message}</span><button onClick={()=>setHealth(true)}>Source details <ChevronRight size={14}/></button></div>
        <details className="signal-diagnostics">
          <summary><span>Signal checks & coverage</span><span>{coverage.current} current · {coverage.stale} stale · {coverage.unavailable} unavailable · {coverage.unscanned} not scanned</span></summary>
          <p>Pass counts use each coin’s price direction and current inputs. A full setup requires all six on the same coin. No market refresh occurs when this panel opens.</p>
          <div className="diagnostic-grid">{diagnostics.map(check=><div key={check.name}><span>{check.name}</span><strong>{check.passed}<small> / {check.total}</small></strong><div className="meter"><i style={{width:`${check.total?check.passed/check.total*100:0}%`}}/></div></div>)}</div>
          <p>{dominance.message} Analyses expire after 10 minutes or when their source window is stale; click Refresh to update.</p>
        </details>
        <div className="workspace-grid"><section className="screener panel">
          <div className="panel-heading"><div><h2>{watchOnly?'Your watchlist':'Market screener'} <span className="count">{watchOnly?watch.length:rows.length}</span></h2><p>{exchange||'Connecting'} · active USDT crypto perpetual contracts</p></div><div className="segmented" aria-label="Analysis timeframe">{['15m','1h'].map(t=><button key={t} className={interval===t?'selected':''} aria-pressed={interval===t} onClick={()=>setIntervalChoice(t)}>{t}</button>)}</div></div>
          <div className="filter-row"><div className="tabs">{[['all','All markets'],['long','Long'],['short','Short'],['watch','Watch']].map(([k,l])=><button key={k} onClick={()=>setFilter(k)} className={filter===k?'active':''} aria-pressed={filter===k}>{l}</button>)}</div><label className="search"><Search size={15}/><input placeholder="Search coin" aria-label="Search coin" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label="Clear search" onClick={()=>setSearch('')}><X size={13}/></button>}</label></div>
          <div className="table-toolbar"><span role="status"><span className={`tiny-dot ${busy?'green':''}`}/> {scanLabel}</span><div>{busy&&<button onClick={()=>scanController.current?.abort()} aria-label="Stop scan">Stop</button>}<label>Rows<select aria-label="Rows per page" value={pageSize} onChange={e=>setPageSize(Number(e.target.value))}>{[25,50,100,0].map(n=><option key={n} value={n}>{n||'All'}</option>)}</select></label><label><SlidersHorizontal size={13}/><select aria-label="Sort contracts" value={sort} onChange={e=>setSort(e.target.value)}><option value="volume">Volume</option><option value="signal">Alignment</option><option value="oi">OI change</option><option value="change">24h change</option></select></label></div></div>
          <div className="table-wrap"><table><thead><tr><th>Asset</th><th>Mark price / 24h</th><th title="Change in contract units between closed OI samples, four intervals apart">OI Δ</th><th>Funding</th><th title="Taker-buy minus taker-sell quote volume over four closed candles">CVD</th><th>Setup</th></tr></thead><tbody>{shown.map(r=><MarketRow key={r.symbol} row={marketBySymbol.get(r.symbol)!} analysis={r.analysis} error={errors[r.symbol]} state={r.signal} selected={selected===r.symbol} watching={watch.includes(r.symbol)} age={r.analysis?age(r.analysis.updated,now):''} onSelect={selectAsset} onWatch={toggleWatch}/>)}</tbody></table>{!shown.length&&<div className="empty-state"><Waves size={30}/><h3>{marketError?'Market feed is offline':rows.length?'No contracts match your filters':'Click Refresh to load markets'}</h3><p>{marketError?'Click Refresh to retry the feed.':rows.length?'Try another filter or add coins to your watchlist.':'No data is fetched until you click Refresh. Switching sections preserves the loaded snapshot.'}</p>{marketError&&<button className="button secondary" onClick={()=>void refresh()}>Retry connection</button>}</div>}</div>
          <div className="table-footer"><span>{visible.length?`${currentPage*perPage+1}–${Math.min((currentPage+1)*perPage,visible.length)} of ${visible.length} contracts`:'0 contracts'}</span><div><button aria-label="Previous page" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}><ChevronLeft size={16}/></button><span>{currentPage+1} / {pageCount}</span><button aria-label="Next page" disabled={currentPage+1>=pageCount} onClick={()=>setPage(currentPage+1)}><ChevronRight size={16}/></button></div></div>
        </section>
        <aside className="detail panel"><div className="detail-top"><span className="eyebrow">ASSET SPOTLIGHT</span><button className="icon-button" disabled={busy} title="Refresh selected asset" aria-label="Refresh selected asset" aria-busy={busy} onClick={()=>void refresh(true)}><RefreshCw size={15}/></button><button className="icon-button" title="Watch this asset" onClick={()=>toggleWatch(selected)}><Star size={16} className={watch.includes(selected)?'positive':''}/></button></div><div className="spotlight-title"><div><h2>{asset?.base||selected.replace('USDT','')} <small>/ USDT</small></h2><span className="muted">{exchange||'Connecting'} perpetual · {interval}</span></div><a className="icon-button" href={`https://www.tradingview.com/chart/?symbol=${exchange==='OKX'?'OKX':'BINANCE'}%3A${selected}.P&interval=${interval==='1h'?'60':'15'}`} target="_blank" rel="noreferrer" title="View on TradingView"><ExternalLink size={16}/></a></div><div className="spotlight-price">${price(asset?.price)} <small className={asset&&asset.change<0?'negative':'positive'}>{asset?`${sign(asset.change)}${fmt(asset.change)}%`:''}</small></div>
          <div className="chart-tabs"><button className={tab==='price'?'active':''} onClick={()=>setTab('price')}>Price</button><button className={tab==='cvd'?'active':''} onClick={()=>setTab('cvd')}>CVD</button><span>Up to 48 closed candles</span></div><div className="detail-chart"><div className="chart-grid"/><Spark large values={chart?(tab==='price'?chart.candles.map((c:any)=>c.close):chart.cvdSeries):[]} color={tab==='price'?'#14866d':'#7772b6'}/></div>{detailLoading&&<p role="status">Loading saved chart…</p>}{detailError&&<p className="data-note">{detailError}</p>}{a?.dataNote&&<p className="data-note">{a.dataNote}</p>}<div className="chart-caption"><span>{chart?.candles?.length?new Date(chart.candles[0].time).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'Awaiting feed'}</span><span>{a?`${errors[selected]?'Cached · ':''}${new Date(a.closedAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})} · last close`:'—'}</span></div>
          <div className="alignment"><div><span className={`badge ${s.side}`}>{errors[selected]?'Refresh needed':s.label}</span><span><b>{s.score}</b> / 6 aligned</span></div><div className="alignment-bars">{Array.from({length:6},(_,i)=><i key={i} className={i<s.score?(s.direction>0?'on':'on red-on'):''}/>)}</div><p>Alignment is a rules score, not a win probability.</p></div>
          <div className="checks">{(s.checks.length?s.checks:[{name:'Open interest, funding & CVD',ok:false,detail:errors[selected]?.error||(s.side==='stale'?'This analysis expired. Click Refresh selected asset.':'Click Refresh to start analysis')},{name:'Global dominance',ok:false,detail:domReady?'Baseline available':'Collecting a ~1h baseline'}]).map(c=><div className="check-row" key={c.name} title={c.detail}><span className={c.ok?'check-icon yes':'check-icon'}>{c.ok?<Check size={11}/>:<span>·</span>}</span><div><span>{c.name}</span><small>{c.detail}</small></div></div>)}</div>
          {a&&['long','short','watch'].includes(s.side)&&<div className="trade-plan"><div className="plan-title">Illustrative levels <span>2R BEFORE COSTS</span></div><div><span>Reference close</span><b>{price(a.price)}</b></div><div><span>Invalidation · 1.5 ATR</span><b className="negative">{price(stop)}</b></div><div><span>Target · 3 ATR</span><b className="positive">{price(target)}</b></div><p>Based on the last closed candle. Not a fill or a validated exit strategy.</p></div>}
          <button className="method-link" onClick={()=>setMethod(true)}>Read the signal rules <ChevronRight size={14}/></button>
        </aside></div>
        <footer><span><span className={`tiny-dot ${online&&!marketError&&updated?'green':''}`}/> {updated?`Market snapshot ${age(updated,now)}`:'Waiting for first market snapshot'} <span className="footer-divider">/</span> Manual refresh only · saved data reused; outdated inputs refreshed on click</span><span>Research signals · no orders placed</span></footer>
      </div>
    </main>
    {(method||health)&&<div className="modal-backdrop" onClick={()=>{setMethod(false);setHealth(false)}}><section role="dialog" aria-modal="true" aria-label={method?'Signal methodology':'Data health'} className="modal" onClick={e=>e.stopPropagation()}><button className="modal-close icon-button" aria-label="Close dialog" onClick={()=>{setMethod(false);setHealth(false)}}><X size={20}/></button>{method?<><div className="eyebrow">TRANSPARENT BY DESIGN</div><h2>What makes a setup?</h2><p>Each contract is evaluated on the last four completed candles: one hour of flow on 15m, or four hours on 1h. Live mark prices do not rewrite closed-candle signals.</p><ol><li><b>Price & trend.</b> At least ±0.15% momentum, agreeing with EMA20.</li><li><b>Open interest.</b> Contract count rises at least 0.25% between closed samples, four intervals apart. OKX forming OI buckets are excluded; their period-end availability aligns with the candle window. OI alone cannot tell us who is long or short.</li><li><b>CVD.</b> The displayed exchange’s taker-buy quote volume minus taker-sell quote volume. OKX uses its contract-specific taker-volume endpoint; Binance uses taker volume from candles. Net flow must agree with price by at least 3% of total quote volume. The chart is cumulative over loaded candles, not all-time or all-exchange CVD.</li><li><b>Funding.</b> Avoid a crowded side: longs need funding ≤ +0.03%, shorts ≥ −0.03%, normalized to 8 hours. Actual funding intervals appear in the table.</li><li><b>USDT dominance.</b> Longs need a fall of at least 0.015 percentage points over ~1h; shorts need a rise of at least 0.015 pp.</li><li><b>BTC dominance.</b> BTC setups require its share to agree with direction. Altcoin longs allow no more than +0.1 pp BTC dominance growth; shorts allow no more than −0.1 pp decline.</li></ol><p><b>Long / short setup:</b> all six checks pass. <b>Watch:</b> the first four pass but dominance is missing or disagrees. <b>Neutral:</b> core conditions do not align. Missing or stale analyses never create a full setup.</p><div className="modal-note">These are new research rules, not R60_01362. They have not been backtested and have no established win rate or profit factor. Fees, funding payments and slippage are not included in the illustrative 2R levels.</div></>:<><div className="eyebrow">KNOW YOUR INPUTS</div><h2>Data health & coverage</h2><div className="health-row"><b>{exchange||'Exchange'} market data</b><span>{marketError||`${rows.length} active USDT perpetual contracts · ${age(updated,now)}`}</span></div><div className="health-row"><b>Market snapshot</b><span>{!online?'Offline':'Manual refresh only. No polling or price stream.'}</span></div><div className="health-row"><b>Open interest & CVD</b><span>{coverage.current} current · {coverage.stale} stale · {coverage.unavailable} unavailable · {coverage.unscanned} not scanned · Refresh checks all active contracts in bulk, or only watchlist members in Watchlist. Valid closed windows are reused with current funding; only missing or outdated inputs enter the shared scan queue. Pagination, search and signal filters do not limit the scan. Background and manual jobs share one fair queue with paced starts and at most two active jobs. Queued requests have a 55-second timeout; failures are counted and do not block the queue. Stop cancels the remaining scan. All feeds use this PC’s shared server cache and local database. Validated candles are reused until the next close. Rate limits trigger a cooldown, and stale data cannot create setups.</span></div><div className="health-row"><b>{dom?.source||'Global'} dominance</b><span>{globalError||`${domFresh?'Current':'Waiting'} · ${dom?age(dom.updated,now):'not received'} · updated on Refresh`}</span></div><div className="health-row"><b>Dominance history</b><span>{domReady?'~1h baseline available':'Needs ~1h of saved observations while this PC is awake'}. Stored on the server for 48h, with separate history for each provider. CoinPaprika USDT share is Tether market cap / total crypto market cap. Provider dominance may differ from TradingView BTC.D / USDT.D because their market universes differ.</span></div><div className="modal-note">Coverage is active crypto USDT perpetual contracts on the displayed exchange, not every cryptocurrency or exchange. OKX volume sorting uses base volume × latest price as an approximate notional. Some contracts may lack OI history. Returning to a section or reconnecting never starts a refresh. Changing pages only displays already loaded rows. Click Refresh after changing timeframe if you need new analyses. No failed coin is retried automatically. Switching timeframes keeps previously loaded results; stale setups remain suppressed. The site does not connect to your trading account.</div>{fallback&&<div className="health-row"><b>Fallback reason</b><span>{fallback}. Exchange availability is checked during a requested refresh; provider changes use separate analyses.</span></div>}<div className="source-links"><a href="/connection-check" target="_blank" rel="noreferrer">Run a live feed check ↗</a><a href="https://www.okx.com/docs-v5/en/#trading-statistics-rest-api" target="_blank" rel="noreferrer">OKX data documentation ↗</a><a href="https://docs.coinpaprika.com/api-reference/global/get-market-overview-data" target="_blank" rel="noreferrer">CoinPaprika global data ↗</a><a href="https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics" target="_blank" rel="noreferrer">Binance data documentation ↗</a><a href="https://docs.coingecko.com/reference/crypto-global" target="_blank" rel="noreferrer">CoinGecko global data ↗</a></div></>}</section></div>}
  </div>;
}
