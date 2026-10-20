import {env} from 'cloudflare:workers';
import {readSetting,writeSetting,json} from '@/lib/local-store';
import {historyStatus} from '@/lib/local-compass/data';
export async function GET(){
  const [collector,watchlist,counts,history]=await Promise.all([
    readSetting<any>('collector'),readSetting<string[]>('watchlist'),
    env.DB!.prepare('SELECT exchange,interval,COUNT(*) AS checked,SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) AS loaded,MAX(attempted) AS lastAttempt FROM local_analyses GROUP BY exchange,interval').all(),
    historyStatus()
  ]);
  return json({application:'Market Lens Local',version:1,now:Date.now(),collector,
    running:!!collector&&Date.now()-collector.heartbeatAt<90000,watchlist:watchlist??[],counts:counts.results,history,
    storage:'data/state (local SQLite)',refresh:'Manual display refresh; background data collection'});
}
export async function POST(req:Request){
  const body:any=await req.json();
  if(!body||typeof body!=='object'||JSON.stringify(body).length>50000)return json({error:'Invalid status'},400);
  await writeSetting('collector',{...body,heartbeatAt:Date.now()});
  return json({saved:true});
}
