'use client';
import { useEffect,useMemo,useRef,useState } from 'react';
import { ArrowDownRight,ArrowUpRight,ArrowRight,Activity,Compass,Layers,Sun,Moon,RefreshCw,Info,Minus,ExternalLink,ShieldCheck,Search,Pause,Play,ChevronDown,X,Radio,Clock3 } from 'lucide-react';
import { HORIZONS,MAX_AGE,FOUR_CONTEXT_AGE,safeSnapshot,validFourContext,type Compass as Snapshot,type Horizon } from '@/lib/compass';
import {usePanelActive} from './panel-activity';
import {useFrameTheme} from './frame-theme';
import RefreshFeedback,{useRefreshFeedback} from './refresh-feedback';
import {refreshOutcome} from '@/lib/refresh-outcome';
import {finishDirectionRefresh} from '@/lib/direction-refresh';
import {dataReadiness,readingReady} from '@/lib/data-readiness.mjs';
import {directionDisplay} from '@/lib/direction-display';
import {formatPrice} from '@/lib/price-format';
import {isCryptoOI} from '@/lib/oi-universe';
import { restoreSnapshot,SNAPSHOT_KEY,DIRECTION_VIEW_KEY,restoreDirectionView,serializeDirectionView } from '@/lib/snapshot-storage';
const horizonLabel=(h:Horizon)=>h==='4h'?'4 hours':h==='1h'?'1 hour':'15 minutes';
const money=formatPrice;
const pct=(n:number|null|undefined,suffix='%')=>n==null?'—':`${n>0?'+':''}${n.toFixed(suffix===' pp'?4:2)}${suffix}`;
const tone=(n:number|null|undefined,inverse=false)=>n==null?'neutral':Math.abs(n)<.00001?'neutral':(n>0)!==inverse?'positive':'negative';
const time=(n:number|undefined)=>n?new Date(n).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—';
const age=(n:number|undefined,now:number)=>n?`${Math.max(0,Math.floor((now-n)/60000))}m ago`:'—';
const coverageLabel=(n:number|undefined)=>n==null?'—':n>=1?'100%':n>.9999?'>99.99%':`${(n*100).toFixed(2)}%`;
async function fetchData(url:string,signal:AbortSignal){
  const r=await fetch(url,{cache:'no-store',signal});const d:any=await r.json();
  if(!r.ok)throw new Error(d.error||`Feed returned ${r.status}`);return d;
}
export default function CompassDashboard({embedded=false}:{embedded?:boolean}){
  useFrameTheme();
  const panelActive=usePanelActive();
  const feedback=useRefreshFeedback();
  const [raw,setRaw]=useState<Snapshot|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[now,setNow]=useState(Date.now());
  const [h,setH]=useState<Horizon>('15m'),[dark,setDark]=useState(false),[method,setMethod]=useState(false),[search,setSearch]=useState(''),[showAll,setShowAll]=useState(false);
  const [requireFour,setRequireFour]=useState(false),[savedView,setSavedView]=useState(false);
  const [context,setContext]=useState<Record<string,any>>({}),[contextErrors,setContextErrors]=useState<Record<string,string>>({});
  const [restored,setRestored]=useState(false);
  const busy=useRef(false),active=useRef<AbortController|null>(null),refreshAfter=useRef(0),restoreActive=useRef<AbortController|null>(null);
  const data=useMemo(()=>raw?safeSnapshot(raw,now):null,[raw,now]),fresh=!!data&&!data.stale;
  const fourReady=validFourContext(data?.fourContext,now),externalFour=data?.fourContext?.source==='CoinMarketCap';
  const reading=h==='4h'&&fourReady?data!.fourContext!.reading:data?.readings[h],horizonFresh=h==='4h'?fourReady:fresh;
  async function load(){
    if(busy.current||document.hidden||Date.now()<refreshAfter.current)return;
    restoreActive.current?.abort();
    const notice=feedback.begin('Loading market direction, BTC structure, open interest and spot flow…');
    busy.current=true;setLoading(true);const abort=new AbortController();active.current=abort;const timer=setTimeout(()=>abort.abort(),23000);
    try{
      // Render independent feeds as they arrive, but keep loading until every
      // requested feed settles. A pending/stale saved response is not success.
      const results=await Promise.allSettled(['market','btc','oi','flow'].map(async kind=>{
        try{
          const result=kind==='market'
            ?(await finishDirectionRefresh(async()=>({status:200,data:await fetchData('/api/direction',abort.signal)}))).data
            :await fetchData(`/api/direction?kind=${kind}`,abort.signal);
          const problem=dataReadiness(kind,result).pending.join(' ');
          if(kind==='market'){
            setRaw(result as Snapshot);setNow(Date.now());refreshAfter.current=0;setError('');setSavedView(false);
            try{localStorage.setItem(SNAPSHOT_KEY,JSON.stringify({version:2,snapshot:result}))}catch{}
            if(problem||!Number.isFinite(result.at)||Date.now()-result.at>MAX_AGE)throw new Error(problem||'The market snapshot is stale.');
          }else{
            setContext(v=>({...v,[kind]:result}));setContextErrors(v=>({...v,[kind]:problem}));
            if(problem)throw new Error(problem);
            if(kind==='flow'&&(result.errors?.length||!result.rows?.length||result.average==null))throw new Error('Some spot-flow data is unavailable.');
          }
          return kind;
        }catch(e){
          const message=abort.signal.aborted?'Refresh timed out; click Refresh to retry':(e as Error).message;
          if(kind==='market'){setError(message);refreshAfter.current=Date.now()+60000}
          else setContextErrors(v=>({...v,[kind]:message}));
          throw new Error(`${kind==='market'?'Market direction':kind.toUpperCase()}: ${message}`);
        }
      }));
      const failed=results.filter(r=>r.status==='rejected'),loaded=results.length-failed.length;
      feedback.finish(notice,refreshOutcome({loaded,failed:failed.length,detail:failed.length
        ?`${loaded}/4 feeds updated. ${failed.map(r=>(r as PromiseRejectedResult).reason.message).join(' ')}`
        :'Market direction and all supporting feeds are now displayed.'}));
    }finally{clearTimeout(timer);setLoading(false);busy.current=false}
  }
  useEffect(()=>{
    const sync=()=>setDark(document.documentElement.dataset.theme==='dark');sync();const observer=new MutationObserver(sync);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    let session=null,saved=null;
    try{session=restoreDirectionView(sessionStorage.getItem(DIRECTION_VIEW_KEY))}catch{}
    try{saved=session??restoreDirectionView(localStorage.getItem(DIRECTION_VIEW_KEY))}catch{}
    let snapshot=saved?.snapshot??null;
    if(!snapshot){try{snapshot=restoreSnapshot(localStorage.getItem(SNAPSHOT_KEY))}catch{}}
    if(saved){setContext(saved.context);setContextErrors(saved.contextErrors);setH(saved.horizon);setRequireFour(saved.requireFour);setSearch(saved.search);setShowAll(saved.showAll)}
    try{const prefs=JSON.parse(localStorage.getItem('market-lens-direction-preferences-v1')||'null');if(prefs){if(HORIZONS.includes(prefs.horizon))setH(prefs.horizon);setRequireFour(prefs.requireFour===true);setSearch(typeof prefs.search==='string'?prefs.search.slice(0,100):'');setShowAll(prefs.showAll===true)}}catch{}
    if(snapshot){setRaw(snapshot);setSavedView(true)}
    setRestored(true);
    const restoreAbort=new AbortController();restoreActive.current=restoreAbort;
    const restoreTimer=setTimeout(()=>restoreAbort.abort(),5000);
    // A fresh browser session may use observations already collected on disk.
    // A return visit restores its exact view without refreshing any feed.
    if(!session?.snapshot)void fetchData('/api/local/direction',restoreAbort.signal).then(value=>{
      if(restoreAbort.signal.aborted)return;
      const disk=restoreDirectionView(JSON.stringify({version:1,snapshot:value.snapshot,context:value.context}));
      if(disk?.snapshot&&(!snapshot||disk.snapshot.at>=snapshot.at)){
        setRaw(disk.snapshot);setContext(disk.context);setContextErrors({});setSavedView(true);setNow(Date.now());
      }
    }).catch(()=>{/* Retain the existing view if local readback is unavailable. */});

    return()=>{observer.disconnect();clearTimeout(restoreTimer);restoreAbort.abort();active.current?.abort()}
  },[]);
  useEffect(()=>{
    if(!panelActive)return;
    setNow(Date.now());const clock=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(clock);
  },[panelActive]);
  useEffect(()=>{
    if(!restored)return;
    const value=serializeDirectionView({snapshot:raw,context,contextErrors,horizon:'15m',requireFour:false,search:'',showAll:false});
    try{sessionStorage.setItem(DIRECTION_VIEW_KEY,value)}catch{}
    try{localStorage.setItem(DIRECTION_VIEW_KEY,value)}catch{}
  },[restored,raw,context,contextErrors]);
  useEffect(()=>{
    if(!restored)return;
    const timer=setTimeout(()=>{try{localStorage.setItem('market-lens-direction-preferences-v1',JSON.stringify({horizon:h,requireFour,search,showAll}))}catch{}},150);
    return()=>clearTimeout(timer);
  },[restored,h,requireFour,search,showAll]);
  useEffect(()=>{
    if(!raw||!panelActive)return;
    const boundaries=[raw.at+MAX_AGE+1,...(raw.fourContext?[raw.fourContext.at+FOUR_CONTEXT_AGE+1]:[])].filter(t=>t>Date.now());
    const remaining=boundaries.length?Math.min(...boundaries)-Date.now():0;
    if(remaining<=0){setNow(Date.now());return}
    const expiry=setTimeout(()=>setNow(Date.now()),remaining);
    return()=>clearTimeout(expiry);
  },[raw,panelActive]);
  useEffect(()=>{if(!method)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setMethod(false)};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)},[method]);
  function theme(){const value=!dark;setDark(value);document.documentElement.dataset.theme=value?'dark':'light';try{localStorage.setItem('market-lens-theme',value?'dark':'light')}catch{}}
  const sourceRows=h==='4h'&&externalFour?(data?.fourContext?.rows??[]):data?.rows;
  const rows=useMemo(()=>(sourceRows??[]).filter(c=>`${c.name} ${c.symbol}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>(b.changes[h]??-Infinity)-(a.changes[h]??-Infinity)),[sourceRows,search,h]);
  const signal=(requireFour?data?.alignedSignal:data?.signal)??'WAIT',signalTone=signal==='LONG BIAS'?'positive':signal==='SHORT BIAS'?'negative':'neutral';
  const display=directionDisplay(data,{error,loading,savedView,requireFour,fourReady,supportingPending:Object.values(contextErrors).some(Boolean)}),displayState=display.state;
  const b=reading?.breadth;
  const breadthReady=horizonFresh&&!!b&&b.available>0;
  const btc=context.btc&&now-context.btc.hourClose<3720000&&now-context.btc.quarterClose<1020000?context.btc:null;
  // Legacy mixed-market snapshots cannot appear as crypto-only data. A manual
  // refresh loads the new scope; no migration triggers a provider refresh.
  const oi=isCryptoOI(context.oi)&&now-context.oi.at<300000?context.oi:null;
  const flow=context.flow&&now-context.flow.at<600000?context.flow:null;
  const fourMessage=!data?'Waiting for market data.':fourReady?(data.stale?'4h context is available; the intraday snapshot needs refreshing.':data.alignment==='ALIGNED'?'4h agrees with the intraday bias.':data.alignment==='CONFLICT'?'4h opposes the intraday bias.':data.fourContext!.reading.bias==='WAIT'?'4h data is ready; market conditions are mixed.':'4h has a bias; shorter windows do not all agree.'):data.fourStatus==='expired'?'The saved 4h reading expired. Refresh to request provider history.':`No complete 4h comparison yet (${Math.floor(data.historyMinutes??0)}m of CoinLore history saved). CMC history is requested when a key is configured.`;
  const explanation=requireFour&&data?[fourMessage,...(data.alignedSignal==='WAIT'?data.reasons:data.readings['4h'].reasons)]:data?.reasons??['Click Refresh to load the market-wide snapshot. Data stays unchanged when you switch sections.'];
  const oiWindow=h==='4h'?'fourHour':h==='1h'?'hour':'quarter';
  const metrics=h==='4h'&&data?.fourContext?data.fourContext:data;
  const fourTime=data?.fourContext?`4h window ended ${time(data.fourContext.at)} · ${age(data.fourContext.at,now)}`:'';
  return <div className={`shell${embedded?' embedded':''}`}>
    <RefreshFeedback feedback={feedback}/>
    {!embedded&&<aside className="sidebar">
      <a className="brand" href="/"><div className="brand-mark"><Layers size={23}/></div><span>market lens<small>RESEARCH WORKSPACE</small></span></a>
      <div className="nav-heading">WORKSPACE</div>
      <a className="nav-item selected" href="#overview"><Compass size={19}/>Altcoin Compass<span className="nav-dot"/></a>
      <a className="nav-item" href="#participation"><Activity size={19}/>Market participation</a>
      <a className="nav-item" href="#data-coverage"><ShieldCheck size={19}/>Data coverage</a>
      <button className="nav-item" onClick={()=>setMethod(true)}><Info size={19}/>How it works</button>
      <div className="sidebar-bottom"><span className="test-pill">SEPARATE TEST SITE</span><p>A wider view.<br/>A clearer market bias.</p><a href="/" target="_blank" rel="noreferrer">Open main dashboard <ExternalLink size={14}/></a><small>Experimental model · v2</small></div>
    </aside>}
    <div className="workspace">
      {!embedded&&<header><div className="breadcrumb">Market intelligence <span>/</span><strong>Overall Direction</strong><span className="lab-tag">MANUAL</span></div><div className="header-actions"><span className={`connection ${display.current?'online':''}`}><i/>{display.connection}</span><button className="icon-button" onClick={theme} aria-label={dark?'Switch to light theme':'Switch to dark theme'}>{dark?<Sun size={18}/>:<Moon size={18}/>}</button></div></header>}
      <main id="overview">
        <div className="intro"><div><div className="eyebrow">THE BROADER PICTURE</div><h1>Where are altcoins heading?</h1><p>4-hour context. 1-hour direction. 15-minute confirmation.</p></div><div className="intro-actions"><button className="button" disabled={loading||now<refreshAfter.current} aria-busy={loading} onClick={()=>void load()}><RefreshCw size={15} className={loading?'refresh-feedback-spinner':''}/>{loading?'Loading…':'Refresh'}</button></div></div>
        {(display.issue||data?.stale)&&<div role="status" className="notice"><Clock3 size={16}/><span>{data?.stale?'Snapshot is stale — direction is withheld. ':''}{display.issue} {display.cached?'Showing a saved snapshot with its original timestamp.':''}</span></div>}
        <div className="overview-grid">
          <section className={`signal-card ${signalTone}`}>
            <div className="signal-top"><span><Radio size={15}/> {requireFour?'ALIGNED ALTCOIN BIAS':'INTRADAY ALTCOIN BIAS'}</span><span className="signal-tag">{display.cached?'SAVED SNAPSHOT':fresh?'TIMESTAMPED WINDOWS':'AWAITING DATA'}</span></div>
            <div className="signal-title">{signal==='LONG BIAS'?<ArrowUpRight/>:signal==='SHORT BIAS'?<ArrowDownRight/>:<Minus/>}<h2>{displayState}</h2></div>
            <p className="signal-copy">{display.copy}</p>
            <div className="timeframe-row">{(['4h','1h','15m'] as Horizon[]).map(tf=><button className="timeframe-tile" key={tf} aria-label={`View ${horizonLabel(tf)} analysis`} aria-pressed={h===tf} onClick={()=>setH(tf)}><span>{tf==='4h'?'01 · CONTEXT':tf==='1h'?'02 · DIRECTION':'03 · CONFIRMATION'}</span><strong>{horizonLabel(tf)} <em className={(tf==='4h'&&fourReady?data!.fourContext!.reading.bias:data?.readings[tf].bias??'WAIT').toLowerCase()}>{tf==='4h'&&fourReady?data!.fourContext!.reading.bias:tf==='4h'&&data?.fourStatus==='expired'?'EXPIRED':tf==='4h'&&data?.alignment==='COLLECTING'?'COLLECTING':!fresh?'UNAVAILABLE':!readingReady(data?.readings[tf])?'COLLECTING':data?.readings[tf].bias??'WAIT'}</em></strong></button>)}</div>
            <label className="alignment-switch"><input type="checkbox" checked={requireFour} onChange={e=>setRequireFour(e.target.checked)}/> Require 4h alignment <span>{requireFour?'All three must agree':'1h + 15m active'}</span></label>
            <div className="signal-bottom"><ShieldCheck size={15}/>Directional filter · no accuracy claim or automatic orders</div>
          </section>
          <section className="panel why-panel"><div className="panel-title"><h2>Why this bias?</h2><span className="mini-label">{requireFour?'4H + 1H + 15M':'1H + 15M'}</span></div><ul className="reasons">{explanation.slice(0,4).map((v,i)=><li key={i}><span>{String(i+1).padStart(2,'0')}</span>{v}</li>)}</ul><div className={`alignment-note ${data?.alignment==='CONFLICT'?'negative':''}`}><strong>4h context · {fourReady?data!.fourContext!.reading.bias.toLowerCase():data?.fourStatus==='expired'?'expired':'waiting'}</strong><span>{fourMessage}</span>{fourTime&&<span>{fourTime}</span>}<span>{externalFour?'CoinMarketCap history · cached about 1 hour · expires after 75 minutes':'CoinLore collection: every minute · no open browser needed'}</span>{data?.fourError&&<span>{data.fourError}</span>}</div><button className="text-button" onClick={()=>setMethod(true)}>View the decision rules <ArrowRight size={15}/></button></section>
        </div>
        <div className="section-heading"><div><h2>Market drivers</h2><p>{h==='4h'&&data?(data.baselineFourHoursMinutes!=null?`${externalFour?'CoinMarketCap historical quotes':'Saved CoinLore prices'} compared ${(data.baselineFourHoursMinutes/60).toFixed(2)} hours apart. ${fourTime}.`:'CMC history can recover the 4h comparison immediately when available; collected CoinLore prices remain the fallback.'):h==='15m'&&data?(data.baselineMinutes!=null?`Saved prices compared ${data.baselineMinutes.toFixed(1)} minutes apart.`:'Waiting for measured prices 13.5–16.5 minutes apart.'):'Same provider, same constituents, comparable windows.'}</p></div><div className="segment" aria-label="Analysis timeframe">{HORIZONS.map(tf=><button key={tf} aria-pressed={h===tf} className={h===tf?'active':''} onClick={()=>setH(tf)}>{horizonLabel(tf)}</button>)}</div></div>
        <div className="metrics-grid">
          <Metric title="Altcoin cap · ex BTC / ETH" value={money(metrics?.altCap)} change={horizonFresh?reading?.alt:null} note="Known stablecoins excluded · estimate" tag="BASKET"/>
          <Metric title="Bitcoin" value={money(metrics?.btcPrice)} change={horizonFresh?reading?.btc:null} note="Price direction and market risk"/>
          <Metric title="USDT dominance" value={metrics?metrics.usdtDominance.toFixed(2)+'%':'—'} change={horizonFresh?reading?.usdtDom:null} note="Share of the top-125 basket" suffix=" pp" inverse/>
          <Metric title="BTC dominance" value={metrics?metrics.btcDominance.toFixed(2)+'%':'—'} change={horizonFresh?reading?.btcDom:null} note="Relative strength · basket share" suffix=" pp" inverse/>
        </div>
        <div className="participation-grid" id="participation">
          <section className="panel breadth-panel"><div className="panel-title"><div><h2>Is the move broad?</h2><p>Altcoin market breadth · {h}</p></div><span className="mini-label">{b?.available??0} ASSETS</span></div>
            <div className="breadth-counts"><div className="positive"><strong>{breadthReady?b!.up:'—'}</strong><span>Advancing</span></div><div className="neutral"><strong>{breadthReady?b!.flat:'—'}</strong><span>Flat</span></div><div className="negative"><strong>{breadthReady?b!.down:'—'}</strong><span>Declining</span></div></div>
            <div className="breadth-bar" aria-label={breadthReady?`${b!.up} advancing, ${b!.flat} flat, ${b!.down} declining`:'Awaiting fresh breadth'}>{breadthReady?<><span className="up" style={{width:`${b!.up/b!.available*100}%`}}/><span className="flat" style={{width:`${b!.flat/b!.available*100}%`}}/><span className="down" style={{width:`${b!.down/b!.available*100}%`}}/></>:<span className="flat" style={{width:'100%'}}/>}</div>
            <div className="breadth-foot"><span>Median return <strong className={tone(horizonFresh?b?.median:null)}>{pct(horizonFresh?b?.median:null)}</strong></span><span>Flat band ±0.05%</span></div>
            <div className="basket-rows"><div><span>Including ETH <small>TOTAL2ES-style estimate</small></span><strong className={tone(horizonFresh?reading?.altWithEth:null)}>{pct(horizonFresh?reading?.altWithEth:null)}</strong></div><div><span>Smaller assets <small>Ranks 11–125, excluding stablecoins</small></span><strong className={tone(horizonFresh?reading?.smaller:null)}>{pct(horizonFresh?reading?.smaller:null)}</strong></div></div>
          </section>
          <section className="panel context-panel"><div className="panel-title"><div><h2>Supporting context</h2><p>Separate OKX feeds · not required for the bias</p></div><span className="mini-label">OKX</span></div>
            <div className="context-row"><span className="context-icon"><Activity size={17}/></span><div><h3>BTC structure · closed 1h</h3><strong>{btc?.hour??'Unavailable'}</strong><small>{btc?`15m: ${btc.quarter}`:contextErrors.btc||'Click Refresh to load candles.'}</small></div></div>
            <div className="context-row"><span className="context-icon"><Layers size={17}/></span><div><h3>Aggregate open interest · {h}</h3><strong>{money(oi?.total)} <span className={tone(oi?.[oiWindow]?.change)}>{pct(oi?.[oiWindow]?.change)}</span></strong><small>{oi?.[oiWindow]?`${oi[oiWindow].count}/${oi.count} matched crypto USDT perpetuals · ${coverageLabel(oi[oiWindow].notionalCoverage)} USD coverage · includes repricing`:oi?.recovery?`Recovering API history · ${oi.recovery.matched}/${oi.recovery.total} contracts matched for 4h. Click Refresh to see progress.`:contextErrors.oi||'Click Refresh to load crypto-only positions.'}</small>{oi?.[oiWindow]&&<small>{oi[oiWindow].source??'Local collection'} · {oi[oiWindow].minutes.toFixed(1)} min comparison · {time(oi[oiWindow].from)}–{time(oi[oiWindow].to)}</small>}{oi&&<small>{oi.scope??'Crypto only · active USDT perpetual futures'}</small>}{oi?.universeCoverage&&<small>{oi.universeCoverage.eligible} active crypto contracts · {oi.universeCoverage.excludedNonCrypto} non-crypto excluded{oi.universeCoverage.missing>0?` · ${oi.universeCoverage.missing} current readings unavailable`:''}</small>}<OIHistoryDetails recovery={oi?.recovery}/></div></div>
            <div className="context-row"><span className="context-icon"><Radio size={17}/></span><div><h3>Spot taker flow · closed 1h</h3><strong className={tone(flow?.average)}>{flow?.average!=null?pct(flow.average)+' imbalance':'Partial / unavailable'}</strong><small>{flow?`${flow.rows.length}/4 altcoins available · equal-weight sample, not whole-market CVD`:contextErrors.flow||'Click Refresh to load spot flow.'}</small></div></div>
          </section>
        </div>
        <section className="panel assets-panel"><div className="panel-title"><div><h2>Inside the breadth</h2><p>Ranked by {h} return. BTC, ETH and known stablecoins excluded. {externalFour?(h==='4h'?`CoinMarketCap prices and 4h returns. ${fourTime}.`:'CoinLore prices and intraday returns. Select 4 hours to see the separate CMC basket.'):(fourTime&&`${fourTime}; the 4h column uses that observation.`)}</p></div><label className="search"><Search size={16}/><input aria-label="Search altcoins" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search assets"/></label></div>
          <div className="table-scroll"><table><thead><tr><th>Asset</th><th>Price</th><th>15m</th><th>1h</th><th>4h</th><th>24h volume</th><th>Participation · {h}</th></tr></thead><tbody>{rows.slice(0,showAll?125:8).map((c,i)=><tr key={c.id}><td><span className={`coin-icon c${i%5}`}>{c.symbol.slice(0,1)}</span><strong>{c.symbol}</strong><span className="coin-name">{c.name}</span></td><td>{money(c.price)}</td><td className={tone(horizonFresh?c.changes['15m']:null)}>{pct(horizonFresh?c.changes['15m']:null)}</td><td className={tone(horizonFresh?c.changes['1h']:null)}>{pct(horizonFresh?c.changes['1h']:null)}</td><td className={tone(horizonFresh?c.changes['4h']:null)}>{pct(horizonFresh?c.changes['4h']:null)}</td><td>{money(c.volume)}</td><td><span className={`participation-tag ${!horizonFresh||c.changes[h]===null?'neutral':c.changes[h]!>.05?'positive':c.changes[h]!<-.05?'negative':'neutral'}`}>{!horizonFresh||c.changes[h]===null?'Unavailable':c.changes[h]!>.05?'Advancing':c.changes[h]!<-.05?'Declining':'Flat'}</span></td></tr>)}</tbody></table>{!rows.length&&<div className="empty">{data?'No matching assets.':'Click Refresh to load the first market snapshot. No simulated values are displayed.'}</div>}</div>
          {rows.length>8&&<button className="table-expand" onClick={()=>setShowAll(v=>!v)}>{showAll?'Show fewer':`Show all ${rows.length} assets`}<ChevronDown size={15}/></button>}
        </section>
        <section className="panel coverage-panel" id="data-coverage"><div className="panel-title"><div><h2>Know what you’re looking at</h2><p>Transparent coverage, before you use the signal.</p></div><ShieldCheck size={20}/></div>
          <div className="coverage-grid"><div><span className="coverage-label measured">MEASURED</span><h3>Prices & market breadth</h3><p>{data?.source??'CoinLore'}: 1h provider returns and 15m saved price comparisons. {data?`${data.count}/${data.expected} constituents in the snapshot; ${data.stableCount} known stablecoins.`:'Top-125 market-cap universe.'} CoinLore shows response time, not individual quote ages. {externalFour?`4h uses a separate CMC basket of ${data?.fourContext?.constituents} assets; ${data?.fourContext?.stableCount} tagged stablecoins excluded from breadth. CMC quote timestamps are checked.`:'4h falls back to collected CoinLore prices.'}</p></div><div><span className="coverage-label estimated">ESTIMATED</span><h3>Market-cap baskets & shares</h3><p>Current supply and fixed current constituents. These are TOTAL3ES/TOTAL2ES-style proxies, not TradingView’s indices. “Smaller assets” is not OTHERS.</p></div><div><span className="coverage-label unavailable">NOT CONNECTED</span><h3>Index structure & liquidations</h3><p>No TOTAL3ES candle structure, index retest confirmation, market-wide spot CVD or liquidation feed. These inputs do not count as confirmation.</p></div></div>
        </section>
        <footer><span><i className={display.current?'live-dot':'offline-dot'}/> {data?.source??'Provider'} snapshot {time(data?.at)} · {age(data?.at,now)} · manual view refresh · local collection every minute</span><span>{data?`${(data.coverage*100).toFixed(1)}% cap coverage`:'Connecting'}<span className="footer-sep">/</span><button onClick={()=>setMethod(true)}>Methodology & sources <ExternalLink size={12}/></button></span></footer>
      </main>
    </div>
    {method&&<div className="modal-backdrop" onClick={()=>setMethod(false)}><section role="dialog" aria-modal="true" aria-labelledby="method-title" className="modal" onClick={e=>e.stopPropagation()}><div className="panel-title"><h2 id="method-title">How Altcoin Compass works</h2><button autoFocus className="icon-button" onClick={()=>setMethod(false)} aria-label="Close methodology"><X size={19}/></button></div><p>This is an experimental market-direction filter. It has not been backtested, and the conditions below are thresholds, not probabilities.</p>
      <h3>1 · Define a consistent universe</h3><p>Use CoinLore’s current top 125 ranked assets for 1h and 15m; the separate CMC 4h basket uses its own current top 125 and CMC stablecoin tags. Remove BTC, ETH and known stablecoin IDs reviewed on 20 October 2026. This is a maintained classification list, not a complete live stablecoin taxonomy. Every asset has equal weight in breadth. Cap estimates use current supply and current constituents, so supply changes and historical index membership are not captured.</p>
      <h3>2 · Decide the 1-hour direction</h3><p>LONG: alt basket ≥ +0.15%, at least 60% advancing, estimated USDT share falling ≥ 0.005 percentage points, BTC return ≥ −0.10%. SHORT: alt basket ≤ −0.15%, at least 60% declining, USDT share rising ≥ 0.005 points, BTC return ≤ +0.10%. Otherwise WAIT. BTC-share movement explains relative strength; it does not imply dollar gains.</p>
      <h3>3 · Require 15-minute agreement</h3><p>Use the same conditions on 15m with a ±0.08% basket threshold. The intraday bias is shown only when both windows agree. CoinLore supplies 1h changes. The 15m window compares saved same-provider prices 13.5–16.5 minutes apart; until enough observations exist, confirmation stays WAIT. This is momentum agreement, not an index breakout/retest or a prediction of the next candle.</p>
      <h3>4 · Add the four-hour context</h3><p>With a configured CMC key, current CMC prices are compared with CMC historical quotes near four hours earlier, matched by numeric asset ID. Both prices and historical endpoints must have aligned timestamps; comparisons must be 230–250 minutes apart. Tagged stablecoins are excluded from altcoin breadth. No CoinLore prices or weights are mixed into the CMC calculation. This is a current-constituent, current-supply basket estimate, not global CMC dominance or TradingView TOTAL3ES. The CMC 4h result is shared across requests and cached for about an hour to limit credits; its window-end timestamp stays visible and it expires after 75 minutes. Refresh can therefore show the same valid 4h observation. If history is unavailable, collected CoinLore prices remain the fallback; missing data stays unavailable. LONG requires basket ≥ +0.30%, at least 60% advancing, USDT-share change ≤ −0.01 percentage points and BTC return ≥ −0.30%. SHORT reverses these conditions. WAIT with valid data means the conditions are mixed. “Require 4h alignment” compares the independently sourced 4h direction with 1h and 15m; all three must agree. The default intraday model is unchanged. These thresholds have not been backtested.</p>
      <h3>5 · Check freshness and missing inputs</h3><p>Current market snapshots older than 10 minutes cannot produce a combined bias. The independently timestamped 4h context remains visible for at most 75 minutes even if the primary intraday feed is stale; a stale primary feed still blocks the combined bias. At least 90% of the ranked constituents, 98% of their market cap, 90% return coverage and 50 altcoins must be available. Provider response timestamps must align within 2 minutes. The app fetches standard 100-row pages and keeps a bounded history of original page versions, selecting the newest complete top-125 pair that meets the same freshness and alignment checks. A saved pair is labeled when the latest pages cannot be matched. CoinLore does not expose individual quote update times; stale upstream quotes cannot be independently ruled out. Recent cached data can appear immediately while refreshing; its original timestamp remains visible. Missing data remains unavailable. Optional OKX feeds cannot manufacture primary confirmation.</p>
      <h3>Supporting feeds</h3><p>BTC analysis uses closed OKX perpetual candles with 2-left / 2-right confirmed pivots on 1h and a prior 12-bar range on 15m. The spot-flow sample averages four separate normalized taker imbalances; base-coin volumes are never added across assets. OI is USD notional for matched OKX crypto USDT perpetuals and includes price changes. Only active, linear USDT swaps classified by OKX as crypto (instCategory 1) are eligible; stocks, commodities, unknown classifications and other contract types are excluded. If the instrument directory is unavailable, the app withholds the aggregate rather than using an unfiltered total. Local observations are saved every five minutes. Missing 15m, 1h and 4h comparisons are recovered from OKX contract history in paced background batches, even with the browser closed. Comparison points must be within 3 minutes (15m) or 5 minutes (1h/4h) of the requested window and cover at least 90% of contracts and current USD notional, with at least 50 contracts. The total covers measured current crypto contracts; both ends of the percentage change use the same matched crypto set, including when older mixed-market history is reused. Recovery continues toward 100% coverage after the minimum usable threshold is reached. Within the same time tolerance, the fullest usable baseline is preferred; its actual duration is displayed. New listings and unavailable history are excluded from that change, never counted as zero. Initial recovery may take several minutes; rate limits can delay it. Click Refresh to display recovered data. No missing intervals are synthesized. No trades or orders are executed.</p>
      <div className="source-links"><a href="https://coinmarketcap.com/api/documentation/pro-api-reference/cryptocurrency/" target="_blank" rel="noreferrer">CMC historical quotes <ExternalLink size={14}/></a><a href="https://www.coinlore.com/cryptocurrency-data-api" target="_blank" rel="noreferrer">CoinLore public API <ExternalLink size={14}/></a><a href="https://www.tradingview.com/blog/en/new-cryptocap-symbols-52377/" target="_blank" rel="noreferrer">TradingView index definitions <ExternalLink size={14}/></a><a href="https://www.okx.com/docs-v5/en/" target="_blank" rel="noreferrer">OKX API <ExternalLink size={14}/></a></div>
    </section></div>}
  </div>
}
function Metric({title,value,change,note,suffix='%',inverse=false,tag}:{title:string;value:string;change?:number|null;note:string;suffix?:string;inverse?:boolean;tag?:string}){
  return <section className="metric"><div className="metric-title">{title}{tag&&<span>{tag}</span>}</div><div className="metric-value">{value}</div><div className={`metric-change ${tone(change,inverse)}`}>{change==null?<Minus size={15}/>:change>=0?<ArrowUpRight size={16}/>:<ArrowDownRight size={16}/>} {pct(change,suffix)}</div><small>{note}</small></section>
}
function OIHistoryDetails({recovery:r}:{recovery:any}){
  if(!r?.windows)return null;
  return <details style={{marginTop:8,fontSize:12}}><summary style={{cursor:'pointer'}}>History coverage · {r.state==='ready'?'complete':`${r.remaining} contracts pending`}</summary>
    <div style={{paddingTop:8}}>{r.windows.map((w:any)=><small key={w.minutes}>{w.minutes===15?'15m':w.minutes===60?'1h':'4h'}: {w.count}/{w.total} matched · {coverageLabel(w.notionalCoverage)} USD coverage</small>)}
    {r.remaining>0&&<><small>{r.unattempted} not requested · {r.failed} API errors. Valid partial comparisons remain visible while recovery continues.</small><div style={{maxHeight:160,overflowY:'auto'}}>{r.details.map((d:any)=><small key={d.instId}>{d.instId}: {d.windows.map((m:number)=>m===15?'15m':m===60?'1h':'4h').join(', ')} · {d.reason}</small>)}</div></>}
    <small>Background recovery is saved on this PC. Click Refresh to update this view.</small></div>
  </details>;
}
