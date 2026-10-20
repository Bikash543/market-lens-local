import { AsyncLocalStorage } from 'node:async_hooks';

export type CacheBox = {body:string;expires:number};
type Storage = {
  read:(key:string)=>Promise<CacheBox|null>;write:(key:string,box:CacheBox)=>Promise<unknown>;
  acquire?:(key:string,owner:string)=>Promise<boolean>;release?:(key:string,owner:string)=>Promise<unknown>;
};
type Options<T> = {staleMs?:number;onStale?:(value:T,error:Error)=>T;background?:(work:Promise<unknown>)=>void;canRevalidate?:(value:T)=>boolean;onRevalidate?:(value:T)=>T;waitForShared?:boolean};

export function deadline<T>(work:Promise<T>,ms:number,message='Request timed out'):Promise<T>{
  let timer:ReturnType<typeof setTimeout>;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms)});
  return Promise.race([work,timeout]).finally(()=>clearTimeout(timer));
}

export function createFeedCache(storage?:Storage,storageMs=700){
  // Only resolved JSON belongs in isolate-wide state. Cloudflare I/O promises
  // belong to their originating request and must never be reused by another.
  const memory=new Map<string,CacheBox>();
  const failures=new Map<string,{until:number;error:Error}>();
  const context=new AsyncLocalStorage<Map<string,Promise<unknown>>>();
  const scope=<T>(fn:()=>Promise<T>)=>context.run(new Map(),fn);
  async function get<T>(key:string,ttl:number|((value:T)=>number),fn:()=>Promise<T>,options:Options<T>={}):Promise<T>{
    if(!context.getStore())return scope(()=>get(key,ttl,fn,options));
    const pending=context.getStore()!;
    const hit=memory.get(key);
    if(hit&&hit.expires>Date.now())return JSON.parse(hit.body);
    if(pending.has(key))return pending.get(key) as Promise<T>;
    const work=(async()=>{
      let saved=hit;
      if(storage){
        // Another isolate may already have refreshed our expired memory entry.
        try{saved=await deadline(storage.read(key),storageMs,'Cache read timed out')??saved}catch{/* Cache is optional. */}
        if(saved){memory.set(key,saved);if(saved.expires>Date.now())return JSON.parse(saved.body)}
      }
      // Serve usable JSON immediately. Each background refresh owns its request
      // context; the storage lease coordinates work across visitors/isolate restarts.
      if(saved&&options.background&&options.canRevalidate?.(JSON.parse(saved.body))){
        const refresh=scope(()=>get(key,ttl,fn,{...options,background:undefined,waitForShared:false})).catch(()=>undefined);
        options.background(refresh);
        const value=JSON.parse(saved.body) as T;
        return options.onRevalidate?options.onRevalidate(value):value;
      }
      let owner:string|undefined;
      try{
        const failure=failures.get(key);
        if(failure&&failure.until>Date.now())throw failure.error;
        if(storage?.acquire){
          const token=crypto.randomUUID();let acquired:boolean|undefined;
          try{acquired=await deadline(storage.acquire(key,token),storageMs,'Cache lock timed out')}catch{}
          if(acquired)owner=token;
          if(acquired===false){
            if(options.waitForShared===false)throw new Error('Another request is refreshing this feed');
            const end=Date.now()+3500;
            while(Date.now()<end){
              await new Promise(resolve=>setTimeout(resolve,200));
              const shared=await deadline(storage.read(key),storageMs,'Shared refresh timed out');
              if(shared&&shared.expires>Date.now()){memory.set(key,shared);return JSON.parse(shared.body)}
            }
            throw Object.assign(new Error('This feed is already refreshing; retry shortly'),{retryAfterMs:5000});
          }
        }
        const value=await deadline(fn(),14000,'Feed refresh timed out; automatic retry scheduled');
        const box={body:JSON.stringify(value),expires:Date.now()+(typeof ttl==='function'?ttl(value):ttl)};
        memory.set(key,box);failures.delete(key);
        if(memory.size>1600)memory.delete(memory.keys().next().value!);
        if(storage){try{await deadline(storage.write(key,box),storageMs,'Cache write timed out')}catch{/* Do not discard good exchange data. */}}
        return value;
      }catch(error){
        const e=error instanceof Error?error:new Error('Feed unavailable');
        if(!failures.has(key)||failures.get(key)!.until<Date.now())failures.set(key,{until:Date.now()+8000,error:e});
        if(failures.size>1600)failures.delete(failures.keys().next().value!);
        if(saved&&options.onStale&&Date.now()<saved.expires+(options.staleMs??0))return options.onStale(JSON.parse(saved.body),e);
        throw e;
      }finally{if(owner&&storage?.release){try{await deadline(storage.release(key,owner),storageMs,'Cache unlock timed out')}catch{/* Expiring leases recover after a cancelled request. */}}}
    })();
    pending.set(key,work);
    try{return await work}finally{pending.delete(key)}
  }
  return {get,scope};
}
