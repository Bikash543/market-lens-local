'use client';
import {useEffect,useState} from 'react';

// Workspace panels stay mounted. Visibility is explicitly signalled by their
// parent because hiding an iframe does not fire document.visibilitychange.
export function usePanelActive(){
  const [active,setActive]=useState(true);
  useEffect(()=>{
    let selected=true;
    const update=()=>setActive(selected&&!document.hidden);
    const receive=(e:MessageEvent)=>{
      if(e.origin!==location.origin||e.source!==window.parent||e.data?.type!=='workspace-activity')return;
      selected=e.data.active===true;update();
    };
    window.addEventListener('message',receive);document.addEventListener('visibilitychange',update);update();
    if(window.parent!==window)window.parent.postMessage({type:'workspace-ready'},location.origin);
    return()=>{window.removeEventListener('message',receive);document.removeEventListener('visibilitychange',update)};
  },[]);
  return active;
}
