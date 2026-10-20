'use client';
import { useEffect,useState } from 'react';
import { Moon,Sun } from 'lucide-react';

export function ThemeToggle(){
  const [dark,setDark]=useState(false);
  useEffect(()=>{
    const sync=()=>setDark(document.documentElement.dataset.theme==='dark');
    sync();
    const storage=(e:StorageEvent)=>{
      if(e.key!=='market-lens-theme')return;
      document.documentElement.dataset.theme=e.newValue==='dark'?'dark':'light';sync();
    };
    const observer=new MutationObserver(sync);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    window.addEventListener('storage',storage);
    return()=>{observer.disconnect();window.removeEventListener('storage',storage)};
  },[]);
  const toggle=()=>{
    const next=dark?'light':'dark';
    document.documentElement.dataset.theme=next;setDark(!dark);
    try{localStorage.setItem('market-lens-theme',next)}catch{}
  };
  return <button className="theme-toggle" onClick={toggle} aria-label={`Switch to ${dark?'light':'dark'} theme`} title={`Switch to ${dark?'light':'dark'} theme`}>
    {dark?<Sun size={16}/>:<Moon size={16}/>}<span>{dark?'Light':'Dark'}</span>
  </button>;
}
