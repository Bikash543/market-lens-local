import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
async function status(port){
  try{const r=await fetch(`http://127.0.0.1:${port}/${port===8788?'status':'api/local/status'}`,{signal:AbortSignal.timeout(2000)});return r.ok?await r.json():null}catch{return null}
}
if((await status(8788))?.application!=='Market Lens Local supervisor'){
  const child=spawn(process.execPath,[path.join(root,'local','supervisor.mjs')],{cwd:root,detached:true,windowsHide:true,stdio:'ignore'});child.unref();
}
if(process.argv.includes('--open')){
  let ready=false;
  for(let i=0;i<45;i++){
    if((await status(8787))?.application==='Market Lens Local'){ready=true;break}
    await sleep(1000);
  }
  const brave=[
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    path.join(process.env.LOCALAPPDATA||'','BraveSoftware','Brave-Browser','Application','brave.exe')
  ].find(existsSync);
  if(ready&&brave){
    const browser=spawn(brave,['--app=http://127.0.0.1:8787/'],{detached:true,stdio:'ignore'});browser.unref();
  }else if(ready){
    const browser=spawn('C:\\Windows\\System32\\rundll32.exe',['url.dll,FileProtocolHandler','http://127.0.0.1:8787/'],{detached:true,stdio:'ignore'});browser.unref();
  }else{
    const editor=spawn('C:\\Windows\\System32\\notepad.exe',[path.join(root,'data','logs','service.log')],{detached:true,stdio:'ignore'});editor.unref();
  }
}
