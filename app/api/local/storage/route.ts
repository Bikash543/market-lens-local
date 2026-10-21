import {json} from '@/lib/local-store';
export async function GET(){
  const r=await fetch((process.env.MARKET_LENS_CONTROL_ORIGIN||'http://127.0.0.1:8788')+'/storage',{signal:AbortSignal.timeout(10000)});return json(await r.json(),r.status);
}
export async function POST(req:Request){
  if(req.headers.get('origin')!==new URL(req.url).origin||!req.headers.get('content-type')?.includes('application/json'))return json({error:'Local app requests only'},403);
  const r=await fetch((process.env.MARKET_LENS_CONTROL_ORIGIN||'http://127.0.0.1:8788')+'/storage',{method:'POST',signal:AbortSignal.timeout(15000)});return json(await r.json(),r.status);
}
