import { deadline } from './feed-cache';
import {localFetch} from './local-fetch';

const UA='MarketLensLocal/1.0 (public market analytics)';
const cooldown=new Map<string,number>(),nextSlot=new Map<string,number>();
const rateFailures=new Map<string,{count:number;at:number}>();
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export type RequestGate={
  reserve:(key:string,spacing:number,maxQueue:number)=>Promise<number|null|{retryAfterMs:number}>;
  defer:(key:string,until:number)=>Promise<unknown>;
};
export type UpstreamOptions={timeoutMs?:number;attempts?:number;fetcher?:typeof fetch;gate?:RequestGate};
export class FeedError extends Error{
  retryAfterMs:number;
  constructor(message:string,retryAfterMs=15000){super(message);this.retryAfterMs=retryAfterMs}
}
export function retryAfter(header:string|null,now=Date.now()){
  if(!header)return 1500;
  const seconds=Number(header);
  return Math.max(1000,Math.min(300000,Number.isFinite(seconds)?seconds*1000:Date.parse(header)-now||1500));
}
export async function upstreamJSON(url:string,options:UpstreamOptions={}){
  const parsed=new URL(url),key=parsed.host+parsed.pathname,timeout=options.timeoutMs??6500;
  const until=cooldown.get(key)??0;
  if(until>Date.now())throw new FeedError(`${parsed.hostname} is cooling down after a rate limit`,until-Date.now());
  const finish=Date.now()+timeout;
  for(let attempt=0;attempt<(options.attempts??2);attempt++){
    // Every attempt is paced, including retries. D1 reservations coordinate
    // visitors across isolates without retaining another request's I/O promise.
    if(parsed.pathname.startsWith('/api/v5/')){
      const spacing=parsed.pathname.includes('/market/')?1500:parsed.pathname.startsWith('/api/v5/rubik/')?750:250;
      let at:number|null|{retryAfterMs:number}|undefined;
      if(options.gate){try{at=await deadline(options.gate.reserve(key,spacing,3000),700,'Rate gate timed out')}catch{/* Local pacing if storage is unavailable. */}}
      if(at===undefined){
        at=Math.max(Date.now(),nextSlot.get(key)??0);
        if(at-Date.now()<=3000)nextSlot.set(key,at+spacing);else at=null;
      }
      if(typeof at==='object'&&at!==null)throw new FeedError('Exchange is cooling down; automatic retry scheduled',Math.max(5000,at.retryAfterMs));
      if(at===null||at-Date.now()>finish-Date.now()-500)throw new FeedError('Exchange queue is busy; retry shortly',Math.max(5000,(at??Date.now())-Date.now()));
      if(at>Date.now())await sleep(at-Date.now());
    }
    const remaining=finish-Date.now();
    if(remaining<100)throw new FeedError(`${parsed.hostname} response timed out`);
    const controller=new AbortController();
    let r:Response,data:any;
    try{
      const task=(async()=>{
        r=await (options.fetcher??localFetch)(url,{signal:controller.signal,cache:'no-store',headers:{Accept:'application/json','User-Agent':UA}});
        if(!r.ok){
          const text=(await r.text()).slice(0,1200);
          try{return JSON.parse(text)}catch{return {httpMessage:text.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,350)}}
        }
        return await r.json();
      })();
      data=await deadline(task,remaining,`${parsed.hostname} response timed out`);
    }catch(e){
      controller.abort();
      // A hung response has consumed its budget. Fast connection failures get
      // one bounded retry; permanent errors never enter a retry loop.
      if(attempt+1<(options.attempts??2)&&finish-Date.now()>800){await sleep(250);continue}
      throw new FeedError(e instanceof Error?e.message:`Cannot reach ${parsed.hostname}`);
    }finally{controller.abort()}
    const response=r!;
    const rateLimited=response.status===429||data?.code==='50011'||data?.code==='50040';
    if(rateLimited){
      const previous=rateFailures.get(key),count=previous&&Date.now()-previous.at<600000?previous.count+1:1;
      rateFailures.set(key,{count,at:Date.now()});
      const wait=Math.max(Math.min(300000,60000*2**Math.min(count-1,3)),retryAfter(response.headers.get('Retry-After')));
      cooldown.set(key,Date.now()+wait);
      if(options.gate){try{await deadline(options.gate.defer(key,Date.now()+wait),700,'Rate cooldown timed out')}catch{}}
      console.warn('upstream_rate_limit',{provider:parsed.hostname,path:parsed.pathname,instrument:parsed.searchParams.get('instId'),interval:parsed.searchParams.get('bar')||parsed.searchParams.get('period'),status:response.status,code:data?.code,message:data?.msg||data?.httpMessage,cacheStatus:response.headers.get('cf-cache-status'),age:response.headers.get('age'),retryAfterMs:wait});
      throw new FeedError(`${parsed.hostname} rate limited; automatic retry scheduled`,wait);
    }
    if(!response.ok){
      if(response.status>=500&&attempt+1<(options.attempts??2)&&finish-Date.now()>800){await sleep(350);continue}
      throw new FeedError(`${parsed.hostname} returned ${response.status}${response.status===451?' (regional access restriction)':''}`,response.status===403||response.status===451?60000:15000);
    }
    if(data?.code!==undefined&&String(data.code)!=='0')throw new FeedError(data.msg||'Exchange rejected request',30000);
    rateFailures.delete(key);
    return data;
  }
  throw new FeedError('Feed retry budget exhausted');
}
