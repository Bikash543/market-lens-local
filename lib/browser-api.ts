export class APIError extends Error{
  retryAfterMs:number;
  constructor(message:string,retryAfterMs=15000){super(message);this.retryAfterMs=retryAfterMs}
}
export async function api(path:string,body?:unknown,signal?:AbortSignal){
  const timeout=AbortSignal.timeout(19000);
  let r:Response;
  try{
    r=await fetch(path,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout});
    if(!r.headers.get('content-type')?.includes('application/json'))throw new APIError(r.status===401||r.status===403?'Sign in again to restore the data connection':'The server is reconnecting. Click Refresh to retry.',30000);
    const d:any=await r.json();
    if(!r.ok)throw new APIError(!d.error||/internal error; reference/i.test(d.error)?'Data temporarily unavailable. Click Refresh to retry.':d.error,d.retryAfterMs||15000);
    return d;
  }catch(e){
    if(signal?.aborted)throw e;
    if(timeout.aborted)throw new APIError('Request timed out. Click Refresh to retry.');
    throw e instanceof APIError?e:new APIError('Connection interrupted. Click Refresh to retry.');
  }
}
