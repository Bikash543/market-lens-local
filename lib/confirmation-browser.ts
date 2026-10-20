import type {DirectBundle,DirectPart} from './confirmation-direct';
type Dependencies={fetcher?:typeof fetch;now?:()=>number;spacing?:number};
// Only candle and quote endpoints permit public browser CORS. Rubik statistics
// continue through the shared backend. Every pattern is evaluated on the server.
export function createConfirmationTransport(deps:Dependencies={}){
  const now=deps.now??Date.now,fetcher=deps.fetcher??fetch;
  const saved=new Map<string,{part:DirectPart;until:number}>();
  const cooldown=new Map<string,number>();
  let next=0;
  const pause=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
    if(signal.aborted){reject(signal.reason);return}
    const abort=()=>{clearTimeout(timer);reject(signal.reason)};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
  async function read(instrument:string,period:string,signal:AbortSignal):Promise<DirectPart>{
    signal.throwIfAborted();
    const key=instrument+':'+period,previous=saved.get(key);
    if(previous&&previous.until>now())return previous.part;
    const endpoint=period==='quote'?'/api/v5/market/ticker':'/api/v5/market/candles';
    if((cooldown.get(endpoint)??0)>now())throw new Error('OKX public feed is cooling down; click Analyse it later.');
    const wait=Math.max(0,next-now());next=now()+wait+(deps.spacing??1600);
    if(wait)await pause(wait,signal);
    const response=await fetcher(`https://openapi.okx.com${endpoint}?instId=${encodeURIComponent(instrument)}${period==='quote'?'':`&bar=${period}&limit=100`}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(7000)]),credentials:'omit',cache:'no-store'});
    const value:any=await response.json();
    if(response.status===429||['50011','50040'].includes(String(value.code))){
      const header=response.headers.get('Retry-After'),retry=header?(Number.isFinite(+header)?+header*1000:Date.parse(header)-now()):0;
      cooldown.set(endpoint,now()+Math.max(60000,Number.isFinite(retry)?retry:0));
      throw new Error('OKX public feed is rate limited; click Analyse it after the cooldown.');
    }
    if(!response.ok||String(value.code)!=='0'||!Array.isArray(value.data))throw new Error('OKX public feed returned unavailable data.');
    const part={instrument,period,data:value.data};
    if(period!=='quote'){
      const step=period==='1H'?3600000:900000;
      const last=Math.max(0,...value.data.filter((x:any)=>Array.isArray(x)&&x[8]==='1'&&+x[0]+step<=now()).map((x:any)=>+x[0]+step));
      if(last>0&&now()-last<step)saved.set(key,{part,until:Math.min(last+step,now()+step)});
      if(saved.size>60)saved.delete(saved.keys().next().value!);
    }
    return part;
  }
  return async(symbol:string,signal:AbortSignal):Promise<DirectBundle>=>{
    if(!/^[A-Z0-9]{1,24}$/.test(symbol))throw new Error('Invalid coin');
    const bundle:DirectBundle={q:null,btcQ:null,btcH:null,ticker:null,errors:[]};
    const get=async(key:'q'|'btcQ'|'btcH'|'ticker',instrument:string,period:string)=>{
      try{bundle[key]=await read(instrument,period,signal)}
      catch(e){signal.throwIfAborted();bundle.errors.push(`${key}: ${e instanceof Error?e.message:'Public data unavailable'}`)}
    };
    await get('q',symbol+'-USDT-SWAP','15m');
    if(symbol==='BTC')bundle.btcQ=bundle.q;else await get('btcQ','BTC-USDT-SWAP','15m');
    await get('btcH','BTC-USDT-SWAP','1H');
    await get('ticker',symbol+'-USDT-SWAP','quote');
    return bundle;
  };
}
export const loadConfirmationInputs=createConfirmationTransport();
