import {env} from 'cloudflare:workers';
import {json,readSetting} from '@/lib/local-store';

// Disk-only hydration. Opening a section never initiates provider requests.
export async function GET(){
  const [rows,collector]=await Promise.all([
    env.DB!.prepare("SELECT key,body,updated FROM local_snapshots WHERE key IN ('direction:market','direction:btc','direction:oi','direction:flow')").all<{key:string;body:string;updated:number}>(),
    readSetting<any>('collector')
  ]);
  const saved:Record<string,unknown>={};
  for(const row of rows.results){try{saved[row.key.slice('direction:'.length)]=JSON.parse(row.body)}catch{}}
  return json({snapshot:saved.market??null,context:{btc:saved.btc,oi:saved.oi,flow:saved.flow},
    collector:{running:!!collector&&Date.now()-collector.heartbeatAt<90000,heartbeatAt:collector?.heartbeatAt??null},
    source:'Saved on this PC; no provider requests'});
}
