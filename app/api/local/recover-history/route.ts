import {env} from 'cloudflare:workers';
import {json} from '@/lib/local-store';
import {recoveryRows} from '@/lib/history-recovery';
export async function POST(req:Request){
  if(req.headers.get('origin'))return json({error:'Local collector requests only'},403);
  try{
    const text=await req.text();if(text.length>16_000_000)return json({error:'Backup too large'},400);
    const rows=recoveryRows(JSON.parse(text));
    const jobs=[
      ...rows.market.map(r=>env.DB!.prepare('INSERT OR IGNORE INTO market_history (time,body) VALUES (?,?)').bind(r.time,r.body)),
      ...rows.observations.map(r=>env.DB!.prepare('INSERT OR IGNORE INTO observations (time,body) VALUES (?,?)').bind(r.time,r.body)),
      ...rows.dominance.map(r=>env.DB!.prepare('INSERT OR IGNORE INTO dominance (time,btc,usdt,source) VALUES (?,?,?,?)').bind(r.time,r.btc,r.usdt,r.source))
    ];
    let restored=0;
    for(let i=0;i<jobs.length;i+=50){const results=await env.DB!.batch(jobs.slice(i,i+50));restored+=results.reduce((n,r)=>n+(r.meta.changes||0),0)}
    return json({restored,provider:'Original saved observations',synthetic:false});
  }catch(e){return json({error:(e as Error).message},400)}
}
