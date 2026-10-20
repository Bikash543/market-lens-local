import { api, APIError } from './browser-api';
import { normalizeOKXMarket } from './market-data';

type Dependencies={fetcher?:typeof fetch;hosted?:(signal?:AbortSignal)=>Promise<any>;now?:()=>number};
export function createMarketFeed(deps:Dependencies={}){
  const now=deps.now??Date.now,cache=new Map<string,{value:any[];until:number}>();
  let browserUntil=0,cooldown=0,failures=0,reason='';
  async function direct(path:string,ttl:number,signal?:AbortSignal){
    const saved=cache.get(path);if(saved&&saved.until>now())return saved.value;
    if(cooldown>now())throw new APIError('OKX market feed is cooling down; click Refresh to retry',cooldown-now());
    const timeout=AbortSignal.timeout(8000);
    const r=await (deps.fetcher??fetch)(`https://openapi.okx.com${path}`,{signal:signal?AbortSignal.any([signal,timeout]):timeout,credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}});
    const d:any=await r.json();
    if(r.status===429||d.code==='50011'||d.code==='50040'){
      const header=r.headers.get('Retry-After'),retry=header?(Number.isFinite(+header)?+header*1000:Date.parse(header)-now()):0;
      const wait=Math.max(Math.min(300000,60000*2**Math.min(failures++,3)),Number.isFinite(retry)?retry:0);
      cooldown=now()+wait;
      throw new APIError('OKX market feed is rate limited; click Refresh to retry',wait);
    }
    if(!r.ok||String(d.code)!=='0'||!Array.isArray(d.data))throw new APIError(d.msg||'OKX market snapshot unavailable',30000);
    cache.set(path,{value:d.data,until:now()+ttl});return d.data;
  }
  return async function loadMarket(signal?:AbortSignal){
    signal?.throwIfAborted();
    if(browserUntil<=now()){
      try{return await (deps.hosted??(cancel=>api('/api/market',undefined,cancel)))(signal)}
      catch(error){
        if(signal?.aborted)throw error;
        reason=(error as Error).message;browserUntil=now()+900000;
      }
    }
    try{
      // One batch, four different public endpoints. Successful components survive
      // partial failures; no credential forwarding, retry bursts or host rotation.
      const [info,tickers,marks,funding]=await Promise.all([
        direct('/api/v5/public/instruments?instType=SWAP',3600000,signal),
        direct('/api/v5/market/tickers?instType=SWAP',25000,signal),
        direct('/api/v5/public/mark-price?instType=SWAP',25000,signal),
        direct('/api/v5/public/funding-rate?instId=ANY',25000,signal),
      ]);
      signal?.throwIfAborted();
      const snapshot=normalizeOKXMarket(info,tickers,marks,funding,now());failures=0;
      return {...snapshot,transport:'browser',fallbackReason:`Hosted market feed unavailable (${reason}). Public OKX snapshots connect directly from your browser; the hosted feed is rechecked after 15 minutes.`};
    }catch(error){
      if(signal?.aborted)throw error;
      if(error instanceof APIError)throw error;
      throw new APIError('Cannot reach fresh OKX market data; click Refresh to retry',30000);
    }
  };
}
export const loadMarketFeed=createMarketFeed();
