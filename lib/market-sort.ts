type Row={symbol:string;volume:number;change:number;analysis?:{oiChange:number};signal:{side:string;score:number}};
export function compareMarketRows(a:Row,b:Row,sort:string){
  const tie=()=>b.volume-a.volume||a.symbol.localeCompare(b.symbol);
  if(sort==='oi'||sort==='oi-asc'){
    // Put usable observations first, explicitly cached ones next, missing last.
    const tier=(r:Row)=>!Number.isFinite(r.analysis?.oiChange)?2:['stale','waiting'].includes(r.signal.side)?1:0;
    const group=tier(a)-tier(b);if(group)return group;
    const av=a.analysis?.oiChange,bv=b.analysis?.oiChange;
    if(Number.isFinite(av)&&Number.isFinite(bv)){const delta=sort==='oi-asc'?av!-bv!:bv!-av!;if(delta)return delta}
    return tie();
  }
  return sort==='signal'?b.signal.score-a.signal.score||tie():sort==='change'?b.change-a.change||tie():tie();
}
