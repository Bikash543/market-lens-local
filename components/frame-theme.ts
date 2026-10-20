'use client';
import {useEffect} from 'react';
export function useFrameTheme(){
  useEffect(()=>{
    if(window.parent===window)return;
    const receive=(e:MessageEvent)=>{
      if(e.origin!==location.origin||e.source!==window.parent||e.data?.type!=='workspace-theme'||!['light','dark'].includes(e.data.theme))return;
      if(document.documentElement.dataset.theme!==e.data.theme)document.documentElement.dataset.theme=e.data.theme;
    };
    const observer=new MutationObserver(()=>{
      window.parent.postMessage({type:'workspace-theme',theme:document.documentElement.dataset.theme},location.origin);
    });
    window.addEventListener('message',receive);
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    window.parent.postMessage({type:'workspace-ready'},location.origin);
    return()=>{observer.disconnect();window.removeEventListener('message',receive)};
  },[]);
}
