import {env} from 'cloudflare:workers';
import {createFeedCache} from './feed-cache';
import {upstreamJSON,type RequestGate} from './upstream';

export const sharedGate:RequestGate={
  reserve:async(key,spacing,maxQueue)=>{
    const now=Date.now();
    const row=await env.DB!.prepare("INSERT INTO feed_cache (key,body,expires) VALUES (?,'{}',?) ON CONFLICT(key) DO UPDATE SET expires=MAX(?,feed_cache.expires)+? WHERE feed_cache.expires<=? RETURNING expires")
      .bind(`rate:v1:${key}`,now+spacing,now,spacing,now+maxQueue).first<{expires:number}>();
    if(row)return row.expires-spacing;
    const saved=await env.DB!.prepare('SELECT expires FROM feed_cache WHERE key=?').bind(`rate:v1:${key}`).first<{expires:number}>();
    return saved?{retryAfterMs:saved.expires-now}:null;
  },
  defer:async(key,until)=>env.DB!.prepare("INSERT INTO feed_cache (key,body,expires) VALUES (?,'{}',?) ON CONFLICT(key) DO UPDATE SET expires=MAX(feed_cache.expires,excluded.expires)").bind(`rate:v1:${key}`,until).run()
};
export const sharedFeedCache=createFeedCache({
  read:async key=>env.DB!.prepare('SELECT body,expires FROM feed_cache WHERE key=?').bind(key).first(),
  write:async(key,v)=>env.DB!.prepare('INSERT INTO feed_cache (key,body,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires=excluded.expires').bind(key,v.body,v.expires).run(),
  acquire:async(key,owner)=>!!await env.DB!.prepare('INSERT INTO feed_cache (key,body,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires=excluded.expires WHERE feed_cache.expires<=? RETURNING key').bind(`lease:shared:${key}`,owner,Date.now()+18000,Date.now()).first(),
  release:async(key,owner)=>env.DB!.prepare('DELETE FROM feed_cache WHERE key=? AND body=?').bind(`lease:shared:${key}`,owner).run()
},1500,12000);
export function canonicalFeedPath(path:string){
  const u=new URL(path,'https://openapi.okx.com');u.searchParams.sort();
  return u.pathname+u.search;
}
export async function sharedOKX(path:string,ttl:number|((data:any[])=>number)=30000,timeoutMs=7000,staleMs=0):Promise<any[]>{
  const canonical=canonicalFeedPath(path);
  return sharedFeedCache.get('public:OKX:v1:'+canonical,ttl,async()=>{
    const raw=await upstreamJSON('https://openapi.okx.com'+canonical,{gate:sharedGate,timeoutMs,attempts:1});
    if(!Array.isArray(raw.data))throw new Error('Malformed OKX public response');
    return raw.data;
  },staleMs?{staleMs,onStale:value=>value}:{});
}
// All consumers share one raw 100-bar series, then keep their original lookback.
// Historical fallback repairs missing candle coverage without changing providers.
export async function sharedOKXCandles(symbol:string,bar:string,limit:number){
  const step=bar==='1H'?3600000:bar==='4H'?14400000:900000;
  const query=`?instId=${symbol}-USDT-SWAP&bar=${bar}&limit=100`;
  const ttl=(rows:any[])=>{
    const last=Math.max(0,...rows.filter(v=>v[8]==='1'&&+v[0]+step<=Date.now()).map(v=>+v[0]+step));
    return last===Math.floor(Date.now()/step)*step?Math.max(1000,last+step-Date.now()):2000;
  };
  const valid=(rows:any[])=>{
    const closed=rows.filter(v=>v[8]==='1'&&+v[0]+step<=Date.now()).sort((a,b)=>+b[0]-+a[0]);
    return closed.length>=Math.min(35,limit-1)&&closed.every((r,i)=>i===0||+closed[i-1][0]-+r[0]===step);
  };
  let rows:any[];
  try{rows=await sharedOKX('/api/v5/market/candles'+query,ttl,5000);if(!valid(rows))throw new Error('Candle gap');}
  catch{rows=await sharedOKX('/api/v5/market/history-candles'+query,ttl,5000);}
  return rows.slice(0,limit);
}
