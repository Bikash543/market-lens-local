'use client';
import {useEffect,useRef,useState} from 'react';
import type {useRefreshFeedback} from './refresh-feedback';
import {refreshOutcome} from '@/lib/refresh-outcome';
export default function DerivativesContext({symbol,feedback}:{symbol:string;feedback:ReturnType<typeof useRefreshFeedback>}){
  const [data,setData]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const active=useRef<AbortController|null>(null),serial=useRef(0);
  useEffect(()=>{serial.current++;active.current?.abort();setData(null);setError('');setLoading(false);return()=>active.current?.abort()},[symbol]);
  async function refresh(){
    if(!symbol||loading)return;const id=++serial.current,controller=new AbortController();active.current=controller;
    const notice=feedback.begin(`Loading ${symbol} Gate derivatives context…`);
    const timer=setTimeout(()=>controller.abort(),12000);setLoading(true);setError('');
    try{const r=await fetch('/api/local/derivatives?symbol='+encodeURIComponent(symbol)+'&interval=15m',{signal:controller.signal});const value:any=await r.json();if(!r.ok)throw new Error(value.error||'Gate unavailable');if(serial.current===id){setData(value);feedback.finish(notice,refreshOutcome({loaded:1,detail:`${symbol} Gate context is displayed. Your signal checks are unchanged.`}))}}
    catch(e){if(serial.current===id){const message=controller.signal.aborted?'Gate timed out. Existing signal checks are unchanged.':(e as Error).message;setError(message);feedback.finish(notice,refreshOutcome({loaded:0,failed:1,detail:message}))}}
    finally{clearTimeout(timer);if(serial.current===id)setLoading(false)}
  }
  return <section className="checks-panel" style={{padding:20,marginTop:20}} aria-label="Additional derivatives context">
    <div className="section-heading"><div><h3>Gate derivatives context</h3><p>Optional comparison · separate exchange · excluded from your seven checks</p></div><button className="subtle-button" onClick={refresh} disabled={!symbol||loading}>{loading?'Loading…':'Refresh Gate context'}</button></div>
    {error&&<p role="alert">{error}</p>}
    {!data?<p>Select and analyse a coin, then request its supporting Gate data.</p>:<><p><b>{data.instrument}</b> · completed 15m buckets · {new Date(data.at).toLocaleString()}</p><p>OI: ${Number(data.openInterestUsd).toLocaleString(undefined,{maximumFractionDigits:0})} · OI change over 1h: {data.oiChange.toFixed(2)}% · Funding / 8h: {data.funding8h==null?'Unavailable':(data.funding8h*100).toFixed(4)+'%'}</p><p>Recorded liquidations over 1h: longs {data.longLiquidationsUsd==null?'Unavailable':'$'+data.longLiquidationsUsd.toFixed(2)} · shorts {data.shortLiquidationsUsd==null?'Unavailable':'$'+data.shortLiquidationsUsd.toFixed(2)}</p><small>{data.note} Saved results change only when you click Refresh.</small></>}
  </section>;
}
