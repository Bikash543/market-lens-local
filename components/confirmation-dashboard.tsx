'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Activity,ArrowDownRight,ArrowUpRight,ArrowRight,Check,CheckCheck,ChevronDown,Compass,Copy,Download,FlaskConical,Info,LoaderCircle,Moon,RefreshCw,ShieldCheck,SlidersHorizontal,Sun,Target,Waves,Search,X} from 'lucide-react';
import type {Snapshot,Side,State} from '@/lib/confirmation';
import {useFrameTheme} from './frame-theme';
import CoinSearch from './confirmation-coin-search';
import {loadConfirmationInputs} from '@/lib/confirmation-browser';
import RefreshFeedback,{useRefreshFeedback} from './refresh-feedback';
import {refreshOutcome} from '@/lib/refresh-outcome';
const labels:Record<State,string>={pass:'Aligned',wait:'Waiting',missing:'No data',fail:'Against',na:'N/A'};
type Analysis=Snapshot&{selection:'AUTO'|Side;alternative:{side:Side;passed:number}};
const price=(n:number|null|undefined)=>n==null||!Number.isFinite(n)?'—':n.toLocaleString('en-US',{maximumFractionDigits:n<1?6:n<100?4:2});
const pct=(n:number|null|undefined,d=2)=>n==null?'—':`${n>=0?'+':''}${n.toFixed(d)}%`;
const utc=(n:number|null|undefined)=>n?new Date(n).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC':'—';
export default function Dashboard(){
  useFrameTheme();
  const feedback=useRefreshFeedback();
  const [symbol,setSymbol]=useState(''),[side,setSide]=useState<'AUTO'|Side>('AUTO');
  const [data,setData]=useState<Analysis|null>(null);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const [dark,setDark]=useState(false),[now,setNow]=useState(Date.now());
  const [modal,setModal]=useState(false),[review,setReview]=useState([false,false,false]),[copied,setCopied]=useState(false);
  const [balance,setBalance]=useState('1000'),[risk,setRisk]=useState('0.5');
  const controller=useRef<AbortController|null>(null),sequence=useRef(0),dialog=useRef<HTMLDialogElement|null>(null);
  const inFlight=useRef(false);
  const clearAnalysis=()=>{sequence.current++;controller.current?.abort();feedback.dismiss();inFlight.current=false;setData(null);setError('');setLoading(false);setReview([false,false,false]);setCopied(false)};
  const selectCoin=(coin:string)=>{clearAnalysis();setSymbol(coin)};
  const editCoin=()=>{clearAnalysis();setSymbol('')};
  const selectSide=(value:'AUTO'|Side)=>{if(value!==side){clearAnalysis();setSide(value)}};
  const load=useCallback(async()=>{
    if(!symbol||inFlight.current)return;
    inFlight.current=true;controller.current?.abort();
    const id=++sequence.current,abort=new AbortController();controller.current=abort;
    const notice=feedback.begin(`Checking ${symbol}: closed candles, spot flow, open interest and market context…`,'Loading analysis…');
    setLoading(true);setError('');setData(null);setReview([false,false,false]);setCopied(false);
    const timer=setTimeout(()=>abort.abort(),45000);
    try{
      const direct=undefined;
      const r=await fetch('/api/confirmation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol,side,direct}),signal:abort.signal,cache:'no-store'});
      const value=await r.json() as Analysis&{error?:string};
      if(!r.ok)throw new Error(value.error||'Analysis unavailable');
      if(value.symbol!==symbol||value.selection!==side)throw new Error('The response did not match the selected coin. Click Analyse it to retry.');
      if(id===sequence.current){
        setData(value);setNow(Date.now());
        const missing=value.checks.filter(c=>c.state==='missing').length;
        feedback.finish(notice,refreshOutcome({action:'Analysis',loaded:Math.max(0,value.required-missing),failed:Math.max(missing,value.errors.length),
          detail:missing||value.errors.length?'Available evidence is displayed. Some feeds are missing; see the reasons on screen.':`${symbol} analysis is displayed · ${value.verdict}.`}));
      }
    }catch(e){if(id===sequence.current){
      const message=abort.signal.aborted?'The feed took too long. Retry shortly.':e instanceof Error?e.message:'Unable to load feeds';
      setError(message);feedback.finish(notice,refreshOutcome({action:'Analysis',loaded:0,failed:1,detail:message}));
    }}
    finally{clearTimeout(timer);if(id===sequence.current){setLoading(false);inFlight.current=false}}
  },[symbol,side,feedback.begin,feedback.finish]);
  useEffect(()=>()=>{sequence.current++;controller.current?.abort()},[]);
  useEffect(()=>{const sync=()=>setDark(document.documentElement.dataset.theme==='dark');sync();const observer=new MutationObserver(sync);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect()},[]);
  // A single expiry update replaces continuous redraws, without extending a plan.
  useEffect(()=>{if(!data)return;const update=()=>setNow(Date.now());const t=setTimeout(update,Math.max(0,data.expiresAt-Date.now()+1));document.addEventListener('visibilitychange',update);return()=>{clearTimeout(t);document.removeEventListener('visibilitychange',update)}},[data]);
  const refresh=()=>{void load()};
  useEffect(()=>{if(modal)dialog.current?.showModal();else dialog.current?.close()},[modal]);
  const changeTheme=()=>{const next=!dark;setDark(next);document.documentElement.dataset.theme=next?'dark':'light';try{localStorage.setItem('market-lens-theme',next?'dark':'light')}catch{}};
  const stale=!!data&&(now>data.expiresAt||!!error),plan=data?.plan,usable=!!plan&&plan.state==='candidate'&&!stale;
  const ready=!!data&&!stale&&data.verdict.endsWith('SETUP');
  const status=!data&&!loading?'Click Analyse it to begin':loading&&!data?'Checking the evidence':stale?'Analyse again for fresh data':ready?`${data!.side==='LONG'?'Long':'Short'} setup aligned`:data?.verdict==='DATA UNAVAILABLE'?'Some evidence is missing':'Wait for confirmation';
  const livePrice=data&&!stale?data.price:null;
  const riskCash=+balance*(+risk)/100;
  const costPerUnit=usable?(plan!.entry+plan!.stop)*.0007:0;
  const units=usable&&+balance>0&&+risk>0&&+risk<=5?riskCash/(Math.abs(plan!.entry-plan!.stop)+costPerUnit):null;
  const download=()=>{
    if(!data)return;
    const blob=new Blob([JSON.stringify({...data,downloadedAt:new Date().toISOString(),stale,manualReview:review,costAssumptions:{feePctPerSide:.05,slippagePctPerSide:.02,fundingIncluded:false}},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${symbol}-15m-confirmation-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);
  };
  const copy=async()=>{
    if(!usable||!data)return;
    const text=`${symbol} / USDT · ${data.side} · 15m\n${ready?'Aligned research setup':'CONDITIONAL PLAN — not all confirmations passed'}\nReference entry: ${price(plan!.entry)}\nStop: ${price(plan!.stop)}\nT1: ${price(plan!.target1)} · T2: ${price(plan!.target2)}\nEstimated net reward/risk at T2: ${plan!.netRR.toFixed(2)}R\nValid until: ${new Date(plan!.validUntil).toISOString()}\nOKX prices. Basket proxy mode. Fee 0.05% + slippage 0.02% each side; funding excluded. No order placed.`;
    try{await navigator.clipboard.writeText(text);setCopied(true);setTimeout(()=>setCopied(false),2000)}catch{setError('Clipboard unavailable. Use Export analysis instead.')}
  };
  return <div className="app-shell">
    <RefreshFeedback feedback={feedback}/>
    <aside className="rail"><a className="brand-icon" href="/" aria-label="Trade Confirmation home"><Waves size={26}/></a><div className="rail-line"/><a className="rail-button active" href="#workspace" aria-label="Trade confirmation"><CheckCheck size={22}/></a><button className="rail-button" onClick={()=>setModal(true)} title="Methodology & sources" aria-label="Methodology and sources"><Compass size={21}/></button><span className="rail-spacer"/><span className="lab-icon" title="Trade Confirmation"><FlaskConical size={19}/></span><span className="avatar">ML</span></aside>
    <div className="workspace" id="workspace">
      <header className="topbar"><div className="brand">MARKET <b>LENS</b><span className="divider"/><span className="brand-sub">Trade Confirmation</span><span className="lab-badge">LAB</span></div><div className="header-actions"><span className="feed-label"><i/> Manual refresh · OKX</span><button className="icon-button" onClick={changeTheme} aria-label={`Switch to ${dark?'light':'dark'} theme`}>{dark?<Sun size={18}/>:<Moon size={18}/>}</button></div></header>
      <main>
        <div className="page-title"><div><span className="eyebrow">BEFORE THE ENTRY</span><h1>A clearer case for your trade.</h1><p>Seven checks. One 15-minute setup. Evidence before action.</p></div><button className="subtle-button" onClick={()=>setModal(true)}><Info size={16}/> How it works</button></div>
        <CoinSearch selected={symbol} onSelect={selectCoin} onEdit={editCoin}/>
        <section className="selection-bar"><div className="asset-title"><h2>{symbol||'No coin selected'}{symbol&&<span> / USDT</span>}</h2>{symbol&&<><span className="asset-name">OKX perpetual</span>{data&&<b className="asset-price">${price(livePrice)}</b>}</>}</div><div className="selection-actions"><span className="timeframe"><Activity size={13}/> 15m</span><div className="segmented" aria-label="Setup direction">{(['AUTO','LONG','SHORT'] as const).map(s=><button key={s} className={side===s?'on':''} aria-pressed={side===s} onClick={()=>selectSide(s)}>{s==='AUTO'?'Auto':s==='LONG'?'Long':'Short'}</button>)}</div><button className="analyse-button" onClick={refresh} disabled={loading||!symbol} aria-label="Analyse it">{loading?<LoaderCircle className="spin" size={17}/>:<Search size={17}/>} {loading?'Analysing…':'Analyse it'}</button></div></section>
        {error&&<div className="error-banner" role="alert">{error}</div>}
        {!!data?.errors.length&&<details className="error-banner"><summary>Unavailable feeds ({data.errors.length}) — view reasons</summary><ul>{data.errors.map((e,i)=><li key={i}>{e}</li>)}</ul></details>}
        {!data&&!loading?<section className="analysis-empty" aria-label="Analysis not started"><div className="analysis-empty-icon"><Search size={28}/></div><h2>{symbol?`${symbol} is ready to analyse`:'Find the coin you want to check.'}</h2><p>{symbol?'Click Analyse it to check this coin’s market structure, spot flow and positioning.':'Search a symbol, select its USDT perpetual, then click Analyse it.'}</p><span>Only the selected coin is analysed, with BTC and overall market context as reference inputs.</span></section>:<>
        <div className="analysis-grid">
          <div className="evidence-column">
            <section className={`verdict-card ${ready?'ready':''}`}>
              <div className="verdict-top"><span className="eyebrow"><span className="status-light"/> {loading?'ANALYZING':ready?'ALIGNED SETUP':'CONFIRMATION STATUS'}</span><span className="proxy-badge">BASKET PROXY MODE</span></div>
              <div className="verdict-main"><div><h2>{status}</h2><p>{!data?(loading?'Fetching closed candles, spot flow and positioning.':'Select a coin, then click Analyse it. Switching sections keeps your snapshot.'):stale?'The previous snapshot is no longer actionable.':`${data.side==='LONG'?'Long':'Short'} evidence · ${data.passed} of ${data.required} applicable checks aligned.`}</p></div><div className="score" aria-label={`${stale?0:data?.passed??0} of ${data?.required??7} checks aligned`}><strong>{stale?'—':data?.passed??'—'}</strong><span>/ {data?.required??7}</span></div></div>
              <div className="evidence-meter">{Array.from({length:data?.required??7},(_,i)=><span key={i} className={!stale&&i<(data?.passed??0)?'filled':''}/>)}</div>
              <div className="verdict-foot"><ShieldCheck size={14}/><span>Alignment measures agreement, not win probability.</span><span>{data?.alternative?`${data.alternative.side.toLowerCase()} ${data.alternative.passed}/${data.required}`:'Closed candles only'}</span></div>
            </section>
            <section className="checks-panel"><div className="section-heading"><div><span className="eyebrow">THE EVIDENCE</span><h3>Your seven confirmations</h3></div><span className="quiet-tag">1h context → 15m trigger</span></div>
              {!data?<div className="loading-evidence"><LoaderCircle size={25} className={loading?'spin':''}/><b>{loading?'Reading the market…':'Click Analyse it to load evidence'}</b><span>Each result includes its source and timestamp.</span></div>:data.checks.map((c,i)=><details className={`check-row ${stale?'stale':c.state}`} key={c.id}>
                <summary><span className="check-number">{c.state==='pass'&&!stale?<Check size={14}/>:String(i+1).padStart(2,'0')}</span><span className="check-name"><b>{c.name}</b><small>{c.window} <span>·</span> {c.value}</small></span><span className={`state-label ${stale?'missing':c.state}`}>{stale?'Stale':labels[c.state]}</span><ChevronDown size={15} className="chevron"/></summary>
                <div className="check-detail"><p>{c.reason}</p><span>{c.source} <b>·</b> {utc(c.at)}</span></div>
              </details>)}
            </section>
            <section className="reason-panel"><div className="reason-icon"><SlidersHorizontal size={18}/></div><div><h3>{ready?'What is aligned':'What needs to happen'}</h3>{data?<ul>{(stale?['Click Analyse it again before using any plan.']:data.reasons).slice(0,4).map((r,i)=><li key={i}>{r}</li>)}</ul>:<p>Reasons will appear as the live checks finish.</p>}</div></section>
          </div>
          <aside className="plan-column">
            <section className="plan-panel"><div className="section-heading"><div><span className="eyebrow">DEFINE THE TRADE</span><h3>Entry & risk plan</h3></div><Target size={21}/></div>
              <div className={`plan-state ${usable?'valid':''}`}><span className="status-light"/>{usable?(ready?'Aligned research setup':'Conditional · not confirmed'):plan?'Plan retired':'Waiting for a retest'}</div>
              {usable?<><div className="level-list">
                <div className="level entry"><span><i/> Reference entry<small>Confirmed 15m close</small></span><b>{price(plan!.entry)}</b></div>
                <div className="level stop"><span><i/> Stop-loss<small>Structure + ATR buffer</small></span><b>{price(plan!.stop)}</b></div>
                <div className="level target"><span><i/> Target 1<small>1R · before costs</small></span><b>{price(plan!.target1)}</b></div>
                <div className="level target"><span><i/> Target 2<small>2R · before costs</small></span><b>{price(plan!.target2)}</b></div>
              </div><div className="plan-stats"><span>Stop distance<b>{plan!.riskPct.toFixed(2)}%</b></span><span>Net R at T2<b>{plan!.netRR.toFixed(2)}R</b></span></div><p className="small-note">Valid until {utc(plan!.validUntil)}. Indicative levels; no execution or fill is implied.</p></>:<div className="empty-plan"><div className="empty-plan-icon"><Target size={34}/></div><h4>A level before a leap.</h4><p>{plan?.reason??'Entry, stop and targets appear after a confirmed breakout or breakdown and retest.'}</p><div className="empty-levels"><span>Entry <b>—</b></span><span>Stop-loss <b>—</b></span><span>Targets <b>— / —</b></span></div></div>}
              <details className="risk-calculator"><summary>Position sizing <ChevronDown size={14}/></summary><div className="risk-inputs"><label>Account (USDT)<input type="number" min="1" max="100000000" value={balance} onChange={e=>setBalance(e.target.value)}/></label><label>Risk (%)<input type="number" min=".01" max="5" step=".1" value={risk} onChange={e=>setRisk(e.target.value)}/></label></div><p>Illustrative inputs; adjust to your own limits.</p><div className="calculator-result"><span>Risk budget <b>${price(Number.isFinite(riskCash)&&riskCash>0?riskCash:null)}</b></span><span>Position <b>{units!==null?`${price(units)} ${symbol}`:'Needs a valid plan'}</b></span></div><small>Includes estimated round-trip stop costs. No leverage or exchange lot rounding applied.</small></details>
              <div className="cost-note">Costs: 0.05% fee + 0.02% slippage per side. Funding is shown separately and excluded from net R.</div>
              <button className="copy-button" disabled={!usable} onClick={()=>void copy()}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?'Plan copied':'Copy conditional plan'}</button>
            </section>
            <section className="review-panel"><div className="section-heading"><h3>Your final review</h3><span>{review.filter(Boolean).length}/3</span></div><p>Manual checks · separate from automated evidence</p>{['News & token unlocks checked','Liquidation / squeeze risk reviewed','Position size and maximum loss accepted'].map((label,i)=><label className="review-item" key={label}><input type="checkbox" checked={review[i]} onChange={()=>setReview(v=>v.map((x,j)=>j===i?!x:x))}/><span>{label}</span></label>)}</section>
          </aside>
        </div>
        <section className="support-section"><div className="section-heading"><div><span className="eyebrow">THE SURROUNDING CONDITIONS</span><h3>Supporting context</h3></div><span className="quiet-tag">Context, not extra votes</span></div><div className="context-grid">
          <div><span>Funding / 8h</span><strong>{stale?'—':pct(data?.context.funding8h,4)}</strong><small>{data?.context.fundingHours?`Normalized from ${data.context.fundingHours}h interval`:'Interval required'}</small></div>
          <div><span>USDT share · 1h</span><strong>{stale||data?.context.usdtDom==null?'—':`${data.context.usdtDom>=0?'+':''}${data.context.usdtDom.toFixed(4)} pp`}</strong><small>Top-125 basket estimate</small></div>
          <div><span>BTC share · 1h</span><strong>{stale||data?.context.btcDom==null?'—':`${data.context.btcDom>=0?'+':''}${data.context.btcDom.toFixed(4)} pp`}</strong><small>Top-125 basket estimate</small></div>
          <div><span>Session price average</span><strong>{stale?'—':price(data?.context.vwap)}</strong><small>UTC · quote-volume weighted estimate</small></div>
        </div></section>
        </>}
        <footer><span><i className={`footer-dot ${loading?'loading':''}`}/>{loading?'Updating evidence':data?`Analysis ${utc(data.at)} · candle close ${utc(data.asOf)}`:'No analysis requested'}<span className="footer-break"> · </span> Runs only when you click Analyse it</span><div><button disabled={!data} onClick={download}><Download size={13}/> Export analysis</button></div></footer>
      </main>
    </div>
    <dialog ref={dialog} onCancel={()=>setModal(false)} onClick={e=>{if(e.target===dialog.current)setModal(false)}}><div className="modal-header"><span className="eyebrow">READ THE RULES</span><button className="icon-button" onClick={()=>setModal(false)} aria-label="Close methodology"><X size={20}/></button></div><h2>Evidence, with its limits.</h2><p>This is an experimental 15-minute confirmation workspace. All pattern analysis runs on the server. No orders are placed.</p><h3>Seven checks, all applicable checks required</h3><p>Broad 1h context, BTC direction, a closed 15m range break and retest, spot CVD change, relative volume, OI participation and relative strength vs BTC. BTC itself has six applicable checks. Auto selects the side with the most aligned checks; it does not create a signal.</p><h3>Broad market uses a proxy</h3><p>The live CoinLore basket and breadth come from Altcoin Compass. They are not TradingView TOTAL3ES or its higher-high / lower-low structure. BTC.D and USDT.D labels are deliberately replaced by basket-share estimates. Exact TOTAL3ES requires a licensed history feed.</p><h3>Search and selected-coin analysis</h3><p>Search lists active OKX USDT crypto perpetuals. It loads the symbol directory only. Selecting a coin or side clears the previous result; click Analyse it to request a new analysis. Unsupported or incomplete feeds are labeled as missing.</p><h3>Live data and alignment</h3><p>OKX USDT perpetual candles and quotes provide prices. Spot CVD change uses currency-level spot taker buy minus sell volume over three 5m buckets. OI uses contract counts at matching timestamps. Missing, delayed or stale evidence cannot pass. Expect WAIT when all conditions do not agree.</p><h3>Plans expire</h3><p>A confirmed retest creates a conditional reference entry, a structure stop plus 0.25 ATR, and 1R / 2R targets. Plans retire after 15 minutes, an invalidation, target/stop touch, excessive price drift, an obstructing swing level, a stop over 5%, or net reward below 1.5R. Estimated fees and slippage are charged on both fills.</p><h3>Unconnected context</h3><p>Liquidation heatmaps, news and unlocks are manual reviews. They have no live feed here. This feature has not been backtested; alignment is not an accuracy or profitability claim.</p><div className="source-links"><a href="https://www.okx.com/docs-v5/en/" target="_blank" rel="noreferrer">OKX API documentation <ArrowRight size={14}/></a><a href="/overall-direction" target="_blank" rel="noreferrer">Altcoin Compass sources <ArrowRight size={14}/></a></div>{!!data?.errors.length&&<details className="diagnostics"><summary>Current feed diagnostics ({data.errors.length})</summary><ul>{data.errors.map((e,i)=><li key={i}>{e}</li>)}</ul></details>}</dialog>
  </div>;
}
