'use client';
import {useEffect,useRef,useState} from 'react';
import NavigationRail from './navigation-rail';

type View='markets'|'watchlist'|'direction'|'confirmation'|'guide'|'methodology'|'health';
const panelFor=(v:View)=>v==='direction'||v==='confirmation'||v==='guide'?v:'markets';
function currentView():View{
  if(location.pathname==='/overall-direction')return 'direction';
  if(location.pathname==='/trade-confirmation')return 'confirmation';
  if(location.pathname==='/user-guide')return 'guide';
  const q=new URLSearchParams(location.search).get('view');
  return ['watchlist','methodology','health'].includes(q??'')?q as View:'markets';
}
export default function Workspace({initialView='markets'}:{initialView?:string}){
  const initial:View=['watchlist','direction','confirmation','guide','methodology','health'].includes(initialView)?initialView as View:'markets';
  const [view,setView]=useState<View>(initial),[visited,setVisited]=useState(()=>new Set([panelFor(initial)]));
  const frames=useRef<Record<string,HTMLIFrameElement|null>>({}),viewRef=useRef(view);
  const panel=panelFor(view);
  useEffect(()=>{
    document.title=panel==='direction'?'Overall Direction · Market Lens':panel==='confirmation'?'Trade Confirmation · Market Lens':panel==='guide'?'User Guide · Market Lens':'Market Lens · Futures Intelligence';
  },[panel]);
  function sendTheme(){
    const theme=document.documentElement.dataset.theme==='dark'?'dark':'light';
    for(const frame of Object.values(frames.current))frame?.contentWindow?.postMessage({type:'workspace-theme',theme},location.origin);
  }
  function sendActivity(){
    for(const [name,frame] of Object.entries(frames.current))frame?.contentWindow?.postMessage({type:'workspace-activity',active:name===panelFor(viewRef.current)},location.origin);
  }
  function sendView(){
    sendActivity();
    frames.current.markets?.contentWindow?.postMessage({type:'workspace-view',view:viewRef.current},location.origin);
  }
  function navigate(next:View,push=true){
    viewRef.current=next;setView(next);setVisited(previous=>new Set([...previous,panelFor(next)]));
    if(push)history.pushState({},'',next==='direction'?'/overall-direction':next==='confirmation'?'/trade-confirmation':next==='guide'?'/user-guide':next==='markets'?'/':`/?view=${next}`);
    sendView();
  }
  useEffect(()=>{
    const back=()=>navigate(currentView(),false);
    const receive=(e:MessageEvent)=>{
      if(e.origin!==location.origin||!Object.values(frames.current).some(frame=>frame?.contentWindow===e.source))return;
      if(e.data?.type==='workspace-ready'){sendTheme();sendView()}
      if(e.data?.type==='workspace-theme'&&['light','dark'].includes(e.data.theme)&&document.documentElement.dataset.theme!==e.data.theme){
        document.documentElement.dataset.theme=e.data.theme;
        try{localStorage.setItem('market-lens-theme',e.data.theme)}catch{}
      }
    };
    const observer=new MutationObserver(sendTheme);
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    window.addEventListener('popstate',back);window.addEventListener('message',receive);
    return()=>{observer.disconnect();window.removeEventListener('popstate',back);window.removeEventListener('message',receive)};
  },[]);
  return <div className="persistent-workspace">
    <NavigationRail active={view==='watchlist'?'watchlist':panel} onMarkets={()=>navigate('markets')} onWatchlist={()=>navigate('watchlist')} onDirection={()=>navigate('direction')} onConfirmation={()=>navigate('confirmation')} onGuide={()=>navigate('guide')} onMethod={()=>navigate('methodology')} onHealth={()=>navigate('health')}/>
    <div className="workspace-host">
      {(['markets','direction','confirmation','guide'] as const).filter(p=>visited.has(p)).map(p=><div className="workspace-pane" hidden={panel!==p} key={p}>
        <iframe ref={el=>{frames.current[p]=el}} src={`/workspace/${p}`} title={p==='markets'?'All markets':p==='direction'?'Overall Direction':p==='guide'?'User Guide':'Trade Confirmation'} onLoad={()=>{sendTheme();sendView()}}/>
      </div>)}
    </div>
  </div>;
}
