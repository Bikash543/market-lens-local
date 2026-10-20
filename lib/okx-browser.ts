import { analyze } from './engine';
import { normalizeOKX } from './okx';
import { windowCacheMs } from './window-cache';
import { api,APIError } from './browser-api';
import {isContractSymbol} from './contract-symbol';

type Context={symbol:string;interval:string;exchange:string;instrument:string;flow:any[];interest:any[];funding:number;fundingAt:number};
type Dependencies={fetcher?:typeof fetch;context?:(symbol:string,interval:string,signal?:AbortSignal)=>Promise<Context>;now?:()=>number;spacingMs?:number};
// Public CORS candle access, using the same OKX venue, normalization and rules
// as the server. OI/CVD stay on the shared cache because Rubik does not allow CORS.
export function createOKXBrowserFeed(deps:Dependencies={}){
  const now=deps.now??Date.now,windows=new Map<string,{bars:any[];expires:number}>();
  let nextStart=0,cooldown=0,failures=0;
  const delay=(ms:number,signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{
    if(signal?.aborted){reject(signal.reason);return}
    const abort=()=>{clearTimeout(timer);reject(signal?.reason)};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},ms);
    signal?.addEventListener('abort',abort,{once:true});
  });
  return async function scanOKX(symbol:string,interval:string,signal?:AbortSignal){
    if(!isContractSymbol(symbol)||!['15m','1h'].includes(interval))throw new APIError('Invalid OKX analysis request');
    signal?.throwIfAborted();
    const key=symbol+':'+interval,instrument=symbol.slice(0,-4)+'-USDT-SWAP';
    let saved=windows.get(key),bars=saved&&saved.expires>now()?saved.bars:undefined;
    if(!bars){
      if(cooldown>now())throw new APIError('OKX candle feed is cooling down; click Refresh to retry',cooldown-now());
      const at=Math.max(now(),nextStart),wait=at-now();
      if(wait>5000)throw new APIError('OKX candle queue is busy; retry shortly',wait);
      nextStart=at+(deps.spacingMs??1500);
      if(wait>0)await delay(wait,signal);
      // Another concurrent request may have received a cooldown while we waited.
      if(cooldown>now())throw new APIError('OKX candle feed is cooling down; click Refresh to retry',cooldown-now());
      const timeout=AbortSignal.timeout(8000),abort=signal?AbortSignal.any([signal,timeout]):timeout;
      try{
        const r=await (deps.fetcher??fetch)(`https://openapi.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instrument)}&bar=${interval==='1h'?'1H':'15m'}&limit=99`,{signal:abort,credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}});
        const d:any=await r.json();
        if(r.status===429||d.code==='50011'||d.code==='50040'){
          failures++;
          const header=r.headers.get('Retry-After');
          const retry=header?(Number.isFinite(+header)?+header*1000:Date.parse(header)-now()):0;
          const pause=Math.max(Math.min(300000,60000*2**Math.min(failures-1,3)),Number.isFinite(retry)?retry:0);
          cooldown=now()+pause;
          throw new APIError('OKX candle feed is rate limited; click Refresh to retry',pause);
        }
        if(!r.ok||String(d.code)!=='0'||!Array.isArray(d.data))throw new APIError(d.msg||`OKX candle request failed (${r.status})`,30000);
        bars=d.data;failures=0;
      }catch(e){
        if(signal?.aborted)throw e;
        throw e instanceof APIError?e:new APIError(timeout.aborted?'OKX candle request timed out; click Refresh to retry':'Cannot reach OKX candles from this browser; click Refresh to retry',30000);
      }
    }
    const context=await (deps.context??((s,t,cancel)=>api('/api/okx-context',{symbol:s,interval:t},cancel)))(symbol,interval,signal);
    signal?.throwIfAborted();
    if(context.exchange!=='OKX'||context.symbol!==symbol||context.interval!==interval||context.instrument!==instrument)throw new APIError('Mismatched OKX statistics; analysis withheld');
    if(!Number.isFinite(context.fundingAt)||now()-context.fundingAt>180000||context.fundingAt>now()+60000)throw new APIError('Waiting for fresh OKX funding');
    const window=normalizeOKX(bars!,context.flow,context.interest,interval,now());
    const result=analyze(symbol,interval,window.raw,window.oi,context.funding,now());
    // Keep only successfully validated candles, and expire at the next close.
    windows.set(key,{bars:bars!,expires:now()+windowCacheMs(interval,result.closedAt,now())});
    if(windows.size>1000)windows.delete(windows.keys().next().value!);
    return {...result,exchange:'OKX',instrument,dataNote:window.dataNote};
  };
}
export const scanBrowserOKX=createOKXBrowserFeed();
