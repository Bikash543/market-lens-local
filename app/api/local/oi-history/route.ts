import {recoverAggregateInterest,aggregateInterest} from '@/lib/local-compass/oi-recovery';
import {json,saveSnapshot} from '@/lib/local-store';

// Called by the local background service. No browser timers or auto-refresh.
export async function POST(request:Request){
  if(request.headers.has('origin'))return json({error:'Local service requests only'},403);
  try{
    const recovery=await recoverAggregateInterest();
    if(recovery.state!=='busy')await saveSnapshot('direction:oi',await aggregateInterest());
    return json(recovery);
  }catch(e){return json({error:e instanceof Error?e.message:'OI recovery unavailable'},503)}
}
