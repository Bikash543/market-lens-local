import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {appendFileSync,mkdirSync,existsSync,renameSync,statSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {runCollector} from './collector.mjs';
import {startExchangeNetwork} from './exchange-network.mjs';
import {runtimeConfig} from './runtime-config.mjs';
const config=runtimeConfig(),root=config.root;
const logs=path.join(config.data,'logs');mkdirSync(logs,{recursive:true});
const logfile=path.join(logs,'service.log');
function log(message){
  try{
    if(existsSync(logfile)&&statSync(logfile).size>4_000_000)renameSync(logfile,path.join(logs,`service-${Date.now()}.log`));
    appendFileSync(logfile,new Date().toISOString()+' '+String(message).slice(0,6000)+'\n');
  }catch{}
}
let serverProcess=null,stopping=false,collectorAbort=null,exchangeNetwork=null;
async function stop(){
  if(stopping)return;stopping=true;collectorAbort?.abort();
  if(serverProcess?.pid){
    // Only the child process tree started and recorded by this supervisor.
    await new Promise(resolve=>{
      const killer=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(serverProcess.pid),'/T','/F'],{windowsHide:true});
      killer.on('close',resolve);killer.on('error',resolve);
    });
  }
  exchangeNetwork?.close();log('Stopped by user.');control.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref();
}
const control=createServer((req,res)=>{
  if(req.headers.host!==`127.0.0.1:${config.controlPort}`||(req.headers.origin&&req.headers.origin!==config.origin)){
    res.writeHead(403);res.end('Local access only');return;
  }
  res.setHeader('Content-Type','application/json');
  if(req.url==='/stop'&&req.method==='POST'){res.end('{"stopping":true}');void stop()}
  else if(req.url==='/status'&&req.method==='GET')res.end(JSON.stringify({application:'Market Lens Local supervisor',root,dataDirectory:config.data,pid:process.pid,serverPid:serverProcess?.pid,stopping}));
  else{res.writeHead(404);res.end('{}')}
});
control.on('error',e=>{log('Supervisor not started: '+e.message);process.exit(e.code==='EADDRINUSE'?0:1)});
process.on('SIGINT',stop);process.on('SIGTERM',stop);
process.on('uncaughtException',e=>{log(e.stack||e);void stop()});
control.listen(config.controlPort,'127.0.0.1',async()=>{
  writeFileSync(path.join(config.data,'service-pid.json'),JSON.stringify({pid:process.pid,startedAt:Date.now(),root}));
  log('Local service started. Binds only to 127.0.0.1.');
  exchangeNetwork=await startExchangeNetwork(log,config.transportPort);
  let delay=5000;
  while(!stopping){
    collectorAbort=new AbortController();
    serverProcess=spawn(process.execPath,[
      '--import','./scripts/sites-env.mjs',config.wrangler,'dev',
      '--config','dist/server/wrangler.json','--local','--persist-to',path.join(config.data,'state'),
      '--ip','127.0.0.1','--port',String(config.port),'--inspector-port','0',
      '--var',`MARKET_LENS_TRANSPORT_ORIGIN:${config.transportOrigin}`
    ],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,SITES_RUNTIME_ROOT:path.join(config.data,'runtime'),WRANGLER_SEND_METRICS:'false',BROWSER:'none',NO_COLOR:'1'}});
    let exited=false;
    const ended=new Promise(resolve=>{
      serverProcess.on('error',e=>{exited=true;log('Server spawn error: '+e.message);resolve()});
      serverProcess.on('exit',(code,signal)=>{exited=true;log(`Server exited ${code} ${signal}`);resolve()});
    });
    serverProcess.stdout.on('data',b=>log(b.toString().trim()));
    serverProcess.stderr.on('data',b=>log(b.toString().trim()));
    let ready=false;
    for(let i=0;i<60&&!exited&&!stopping;i++){
      try{
        const r=await fetch(config.origin+'/api/local/status',{signal:AbortSignal.timeout(2500)});
        const d=await r.json();if(r.ok&&d.application==='Market Lens Local'){ready=true;break}
      }catch{}
      await sleep(1000);
    }
    if(ready){
      delay=5000;log('Server ready. Starting browser-independent collector.');
      const collectorSignal=collectorAbort.signal;
      void (async()=>{
        while(!collectorSignal.aborted&&!stopping){
          try{await runCollector({root,dataDirectory:config.data,origin:config.origin,signal:collectorSignal,log})}
          catch(e){log('Collector error: '+e.stack)}
          if(!collectorSignal.aborted&&!stopping){
            log('Restarting collector in 5 seconds.');
            await sleep(5000,undefined,{signal:collectorSignal}).catch(()=>{});
          }
        }
      })();
    }else log('Server has not become ready; inspect log for errors.');
    await ended;collectorAbort.abort();serverProcess=null;
    if(!stopping){await sleep(delay);delay=Math.min(60000,delay*2)}
  }
});
