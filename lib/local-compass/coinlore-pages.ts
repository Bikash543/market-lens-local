import {coinLoreTiming} from './coinlore';

export const COINLORE_QUERIES=['start=0&limit=100','start=100&limit=100'] as const;
export type PageBuffer={version:1;pages:[any[],any[]]};
const time=(page:any)=>Number(page?.info?.time)*1000;
function validPage(page:any,index:number,now:number){
  if(!Number.isFinite(time(page))||time(page)<=0||time(page)>now+30000||now-time(page)>1200000||!Array.isArray(page?.data))return false;
  const required=index===0?100:25;
  return page.data.length>=required&&page.data.length<=100&&new Set(page.data.map((r:any)=>String(r.id))).size===page.data.length&&page.data.every((r:any,i:number)=>Number(r.rank)===index*100+i+1&&Number(r.price_usd)>0&&Number.isFinite(Number(r.market_cap_usd)));
}
// Keep recent real versions of each page, not just the last combined snapshot.
// A newer page can then match the other page's preceding publication cycle.
export function mergeCoinLorePages(previous:any,incoming:any[],now=Date.now()):PageBuffer{
  const pages=[0,1].map(index=>{
    const old=previous?.version===1&&Array.isArray(previous.pages?.[index])?previous.pages[index]:[];
    const unique=new Map<number,any>();
    for(const p of [...old,incoming[index]])if(validPage(p,index,now))unique.set(time(p),p);
    return [...unique.values()].sort((a,b)=>time(b)-time(a)).slice(0,24);
  });
  return {version:1,pages:pages as [any[],any[]]};
}
function completePair(pair:any[]){
  const rows=pair.flatMap(p=>p.data).filter((r:any)=>Number(r.rank)<=125);
  return rows.length===125&&new Set(rows.map((r:any)=>String(r.id))).size===125&&rows.some((r:any)=>String(r.id)==='90')&&rows.some((r:any)=>String(r.id)==='518');
}
export function selectCoinLorePages(buffer:PageBuffer,now=Date.now()){
  const candidates=[];
  for(const first of buffer.pages[0])for(const second of buffer.pages[1]){
    const pages=[first,second],timing=coinLoreTiming(pages,now);
    if(timing.state==='fresh'&&completePair(pages))candidates.push({pages,timing});
  }
  // The minimum provider timestamp determines freshness of the whole basket.
  candidates.sort((a,b)=>Math.min(...b.timing.pageTimes as number[])-Math.min(...a.timing.pageTimes as number[])||(a.timing.skewMs??0)-(b.timing.skewMs??0));
  return candidates[0]??null;
}
export async function collectCoinLorePages(options:{get:(query:string)=>Promise<any>;read:()=>Promise<any>;write:(buffer:PageBuffer)=>Promise<unknown>;diagnose:(value:any)=>Promise<unknown>;now?:()=>number}){
  const now=options.now??Date.now,latest:any[]=[null,null],errors:string[]=[];
  let buffer:PageBuffer=mergeCoinLorePages(await options.read().catch(()=>null),[],now());
  // Calls are paced by the shared upstream gate. Each successfully fetched page
  // is durable even when the other page fails or is from a different cycle.
  for(let index=0;index<2;index++){
    try{latest[index]=await options.get(COINLORE_QUERIES[index])}catch(e){errors.push(`Page ${index+1}: ${e instanceof Error?e.message:'unavailable'}`)}
  }
  buffer=mergeCoinLorePages(buffer,latest,now());
  await options.write(buffer);
  let selected=selectCoinLorePages(buffer,now());
  const initial=coinLoreTiming(latest,now());let retriedPage:number|null=null;
  // Retry at most one lagging page, and only if there is no usable saved pair.
  if(!selected&&initial.state==='misaligned'){
    retriedPage=initial.olderPage;
    try{latest[retriedPage!]=await options.get(COINLORE_QUERIES[retriedPage!]);buffer=mergeCoinLorePages(buffer,latest,now());await options.write(buffer);selected=selectCoinLorePages(buffer,now())}catch{}
  }
  const latestTiming=coinLoreTiming(latest,now()),buffered=!!selected&&selected.pages.some((p,index)=>p!==latest[index]);
  const diagnostics={...(selected?.timing??latestTiming),initial,latest:latestTiming,retriedPage,alignmentMethod:buffered?'matched-saved-pages':'current-pages',versions:buffer.pages.map(p=>p.length),errors};
  await options.diagnose(diagnostics).catch(()=>{});
  if(!selected)throw new Error(`CoinLore pages are not synchronized; waiting for a complete timestamp-matched update (${latestTiming.state}; page difference ${Math.round((latestTiming.skewMs??0)/1000)}s).`);
  return {...selected,diagnostics,buffered,warning:buffered?'Latest CoinLore pages are incomplete or not aligned yet. Using recent timestamp-matched saved pages.':errors.length?errors.join(' '):undefined};
}
