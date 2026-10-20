'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {CheckCircle2,AlertCircle,LoaderCircle,X} from 'lucide-react';
import type {RefreshOutcome} from '@/lib/refresh-outcome';

type Notice=RefreshOutcome|{kind:'loading';title:string;detail:string};
export function useRefreshFeedback(){
  const [notice,setNotice]=useState<Notice|null>(null);
  const [completion,setCompletion]=useState<{id:number;outcome:RefreshOutcome}|null>(null);
  const sequence=useRef(0);
  const begin=useCallback((detail='Fetching the latest available data…',title='Loading…')=>{
    const id=++sequence.current;setCompletion(null);setNotice({kind:'loading',title,detail});return id;
  },[]);
  const finish=useCallback((id:number,outcome:RefreshOutcome)=>{
    if(id===sequence.current)setCompletion({id,outcome});
  },[]);
  const dismiss=useCallback(()=>{sequence.current++;setCompletion(null);setNotice(null)},[]);
  useEffect(()=>{
    if(!completion)return;
    // The parent has committed its new data. Allow that frame to paint before
    // announcing success, rather than notifying when only the request finished.
    let second=0;
    const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{
      if(completion.id===sequence.current)setNotice(completion.outcome);
    })});
    return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second)};
  },[completion]);
  useEffect(()=>{
    if(notice?.kind!=='success')return;
    const timer=setTimeout(dismiss,6500);return()=>clearTimeout(timer);
  },[notice,dismiss]);
  return {notice,begin,finish,dismiss};
}
export default function RefreshFeedback({feedback,progress}:{feedback:ReturnType<typeof useRefreshFeedback>;progress?:string}){
  const n=feedback.notice;
  if(!n)return null;
  const pending=n.kind==='loading';
  return <div className={`refresh-feedback refresh-feedback-${n.kind}`} role={n.kind==='error'?'alert':'status'} aria-live={n.kind==='error'?'assertive':'polite'} aria-atomic="true" aria-busy={pending}>
    {pending?<LoaderCircle size={21} className="refresh-feedback-spinner"/>:n.kind==='success'?<CheckCircle2 size={21}/>:<AlertCircle size={21}/>}
    <div><strong>{n.title}</strong><p>{pending&&progress?progress:n.detail}</p></div>
    {!pending&&<button type="button" onClick={feedback.dismiss} aria-label="Dismiss refresh notification"><X size={16}/></button>}
  </div>;
}
