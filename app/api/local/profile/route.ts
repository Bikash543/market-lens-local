import {env} from 'cloudflare:workers';
import {readSetting,json} from '@/lib/local-store';
import {updateWatchlist} from '@/lib/local-profile';
export async function GET(){
  const watchlist=await readSetting<string[]>('watchlist');
  return json({watchlist:watchlist??[],initialized:watchlist!==null,storage:'Saved on this PC'});
}
export async function POST(req:Request){
  try{
    if(+(req.headers.get('content-length')||0)>100000)return json({error:'Import too large'},413);
    const body=await req.json();
    // Optimistic compare-and-swap prevents two tabs from losing each other's stars.
    for(let attempt=0;attempt<8;attempt++){
      const row=await env.DB!.prepare('SELECT body FROM local_settings WHERE key=?').bind('watchlist').first<{body:string}>();
      const previous=row?JSON.parse(row.body):[];
      const next=updateWatchlist(previous,body),serialized=JSON.stringify(next);
      const result=row?
        await env.DB!.prepare('UPDATE local_settings SET body=?,updated=? WHERE key=? AND body=? RETURNING body').bind(serialized,Date.now(),'watchlist',row.body).first():
        await env.DB!.prepare('INSERT OR IGNORE INTO local_settings (key,body,updated) VALUES (?,?,?) RETURNING body').bind('watchlist',serialized,Date.now()).first();
      if(result)return json({watchlist:next,initialized:true,storage:'Saved on this PC'});
    }
    return json({error:'Another tab is saving. Please retry.'},409);
  }catch(e){return json({error:e instanceof Error?e.message:'Cannot save watchlist'},400)}
}
