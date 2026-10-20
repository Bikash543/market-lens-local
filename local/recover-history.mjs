import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
// Runs at startup and on wake/reconnection gaps. Public candle histories are
// fetched by shared feeds; private backup recovery never leaves this computer.
export async function recoverHistory(dataDirectory,request,log){
  const directory=path.join(dataDirectory,'backups');
  const result={at:Date.now(),files:0,restored:0,note:'Missing provider observations remain unavailable; no synthetic history.'};
  let files;try{files=await readdir(directory)}catch{return result}
  for(const name of files.filter(x=>/^history-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().slice(-2)){
    const file=path.join(directory,name);
    try{
      if((await stat(file)).size>16_000_000)continue;
      const backup=JSON.parse(await readFile(file,'utf8'));
      const response=await request('/api/local/recover-history',backup,20000);
      result.files++;result.restored+=response.restored;
    }catch(e){log('History recovery: '+e.message)}
  }
  log(`History recovery checked ${result.files} local backups; restored ${result.restored} observations.`);
  return result;
}
