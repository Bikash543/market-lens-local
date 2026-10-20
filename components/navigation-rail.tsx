'use client';
import { BookOpen, CheckCheck, Compass, Layers3, Radio, Star, Waves } from 'lucide-react';
import type { ReactNode } from 'react';

type Props={active:'markets'|'watchlist'|'direction'|'confirmation';onMarkets?:()=>void;onWatchlist?:()=>void;onDirection?:()=>void;onConfirmation?:()=>void;onMethod?:()=>void;onHealth?:()=>void};
export default function NavigationRail({active,onMarkets,onWatchlist,onDirection,onConfirmation,onMethod,onHealth}:Props){
  function item(label:string,href:string,icon:ReactNode,selected=false,onClick?:()=>void){
    const className=`nav-icon${selected?' active':''}`;
    return onClick?<button className={className} title={label} aria-label={label} aria-pressed={selected} onClick={onClick}>{icon}</button>:<a className={className} href={href} title={label} aria-label={label} aria-current={selected?'page':undefined}>{icon}</a>;
  }
  return <aside className="rail" aria-label="Workspace navigation">
    <a href="/" className="mark" aria-label="Market Lens home" onClick={onMarkets?e=>{e.preventDefault();onMarkets()}:undefined}><Waves size={26}/></a>
    {item('All markets','/',<Layers3 size={21}/>,active==='markets',onMarkets)}
    {item('Watchlist','/?view=watchlist',<Star size={21}/>,active==='watchlist',onWatchlist)}
    {item('Overall Direction','/overall-direction',<Compass size={21}/>,active==='direction',onDirection)}
    {item('Trade Confirmation','/trade-confirmation',<CheckCheck size={21}/>,active==='confirmation',onConfirmation)}
    {item('Signal methodology','/?view=methodology',<BookOpen size={21}/>,false,onMethod)}
    <div className="rail-bottom">{item('Data health','/?view=health',<Radio size={20}/>,false,onHealth)}<span className="avatar">ML</span></div>
  </aside>;
}
