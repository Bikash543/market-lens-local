import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {appendFileSync,mkdirSync,existsSync,renameSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {runCollector} from './collector.mjs';
import {startExchangeNetwork} from './exchange-network.mjs';
import {maintainStorage,storageStatus,trimLogs} from './storage-maintenance.mjs';
import {loadProviderSettings,providerStatus,saveProviderKey} from './provider-settings.mjs';
import {createWorkQueue} from './work-queue.mjs';
import {localJSON,monitorServer} from './service-health.mjs';
import {runtimeConfig} from './runtime-config.mjs';
const config=runtimeConfig(),root=config.root;
process.env.MARKET_LENS_DATA_DIR=config.data;
const logs=path.join(config.data,'logs');mkdirSync(logs,{recursive:true});
const logfile=path.join(logs,'service.log');
function log(message){
  try{
    if(existsSync(logfile)&&statSync(logfile).size>4_000_000)renameSync(logfile,path.join(logs,`service-${Date.now()}.log`));
    appendFileSync(logfile,new Date().toISOString()+' '+String(message).slice(0,6000)+'\n');
    trimLogs(root);
  }catch{}
}
let serverProcess=null,stopping=false,collectorAbort=null,exchangeNetwork=null;
const scanQueue=createWorkQueue({spacingMs:job=>job.exchange==='Binance'?1000:1600,run:async(job,signal)=>{
  const response=await fetch(config.origin+'/api/local/scan-work',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(job),signal});
  return localJSON(response);
}});
async function stopServer(child){
  if(!child?.pid||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise(resolve=>{
    const killer=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true});
    killer.on('close',resolve);killer.on('error',resolve);
  });
}
async function stop(){
  if(stopping)return;stopping=true;collectorAbort?.abort();
  scanQueue.close();
  await stopServer(serverProcess);
  exchangeNetwork?.close();log('Stopped by user.');control.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref();
}
const control=createServer(async(req,res)=>{
  if(req.headers.host!==`127.0.0.1:${config.controlPort}`||(req.headers.origin&&req.headers.origin!==config.origin)){
    res.writeHead(403);res.end('Local access only');return;
  }
  res.setHeader('Content-Type','application/json');
  if(req.url==='/providers'){
    if(req.headers.origin){res.writeHead(403);res.end('{}');return}
    try{
      if(req.method==='GET'){res.end(JSON.stringify(providerStatus()));return}
      if(req.method!=='POST')throw new Error('Unsupported method');
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1000)throw new Error('Settings too large')}
      const body=JSON.parse(raw);res.end(JSON.stringify(await saveProviderKey(root,body.provider,body.key)));
    }catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}))}return;
  }
  if(req.url==='/storage'){
    if(req.headers.origin){res.writeHead(403);res.end('{}');return}
    try{if(req.method==='POST')maintainStorage(root);else if(req.method!=='GET')throw new Error('Unsupported method');res.end(JSON.stringify(storageStatus(root)))}
    catch(e){res.writeHead(503);res.end(JSON.stringify({error:e.message}))}return;
  }
  if(req.url==='/scan'&&req.method==='POST'){
    if(req.headers.origin){res.writeHead(403);res.end('{"error":"Server requests only"}');return}
    try{
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2048)throw new Error('Job too large')}
      const job=JSON.parse(raw);
      if(typeof job.symbol!=='string'||job.symbol!==job.symbol.toUpperCase()||!/^[\p{L}\p{M}\p{N}_]{1,30}USDT$/u.test(job.symbol)||!['OKX','Binance'].includes(job.exchange)||!['15m','1h'].includes(job.interval))throw new Error('Invalid job');
      const value=await scanQueue.submit(`${job.exchange}:${job.symbol}:${job.interval}`,job,Math.max(0,Math.min(8,Number(job.priority)||0)));
      if(!res.destroyed)res.end(JSON.stringify(value));
    }catch(e){if(!res.destroyed){res.writeHead(503);res.end(JSON.stringify({error:e.message}))}}
  }
  else if(req.url==='/stop'&&req.method==='POST'){res.end('{"stopping":true}');void stop()}
  else if(req.url==='/status'&&req.method==='GET')res.end(JSON.stringify({application:'Market Lens Local supervisor',root,dataDirectory:config.data,pid:process.pid,serverPid:serverProcess?.pid,stopping,queue:scanQueue.stats()}));
  else{res.writeHead(404);res.end('{}')}
});
control.on('error',e=>{log('Supervisor not started: '+e.message);process.exit(e.code==='EADDRINUSE'?0:1)});
process.on('SIGINT',stop);process.on('SIGTERM',stop);
process.on('uncaughtException',e=>{log(e.stack||e);void stop()});
control.listen(config.controlPort,'127.0.0.1',async()=>{
  writeFileSync(path.join(config.data,'service-pid.json'),JSON.stringify({pid:process.pid,startedAt:Date.now(),root}));
  log('Local service started. Binds only to 127.0.0.1.');
  await loadProviderSettings(root);
  exchangeNetwork=await startExchangeNetwork(log,config.transportPort);
  const maintenance=setInterval(()=>{try{maintainStorage(root)}catch(e){log('Storage maintenance: '+e.message)}},3600000);maintenance.unref();
  let delay=5000;
  while(!stopping){
    // Complete startup maintenance before the worker opens the same database.
    // A first installation has no database yet; its scheduled pass handles it.
    try{maintainStorage(root)}catch(e){if(e.code!=='ENOENT')log('Storage maintenance: '+e.message)}
    collectorAbort=new AbortController();
    serverProcess=spawn(process.execPath,[
      '--experimental-vm-modules','./local/server.mjs'
    ],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,SITES_RUNTIME_ROOT:path.join(config.data,'runtime'),WRANGLER_SEND_METRICS:'false',BROWSER:'none',NO_COLOR:'1'}});
    let exited=false;
    const ended=new Promise(resolve=>{
      serverProcess.on('error',e=>{exited=true;log('Server spawn error: '+e.message);resolve()});
      serverProcess.on('exit',(code,signal)=>{exited=true;log(`Server exited ${code} ${signal}`);resolve()});
    });
    serverProcess.stdout.on('data',b=>log(b.toString().trim()));
    serverProcess.stderr.on('data',b=>log(b.toString().trim()));
    const child=serverProcess;
    let collection=Promise.resolve(),health=Promise.resolve();
    const serverLifetime=new AbortController();
    void ended.then(()=>serverLifetime.abort());
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
      collection=(async()=>{
        while(!collectorSignal.aborted&&!stopping){
          try{await runCollector({root,dataDirectory:config.data,origin:config.origin,signal:collectorSignal,log})}
          catch(e){log('Collector error: '+e.stack)}
          if(!collectorSignal.aborted&&!stopping){
            log('Restarting collector in 5 seconds.');
            await sleep(5000,undefined,{signal:collectorSignal}).catch(()=>{});
          }
        }
      })();
      health=monitorServer({signal:serverLifetime.signal,probe:async signal=>{
        const r=await fetch(config.origin+'/api/local/status',{signal:AbortSignal.any([signal,AbortSignal.timeout(3000)])});
        return (await localJSON(r))?.application==='Market Lens Local';
      },onUnhealthy:async()=>{
        if(stopping||exited)return;
        log('Local worker failed 3 consecutive health checks. Restarting its process tree; saved data is retained.');
        collectorAbort.abort();await stopServer(child);
      }});
    }else if(!exited&&!stopping){
      log('Server readiness timed out. Restarting its process tree.');
      await stopServer(child);
    }
    await ended;collectorAbort.abort();serverLifetime.abort();
    await Promise.allSettled([collection,health]);serverProcess=null;
    if(!stopping){await sleep(delay);delay=Math.min(60000,delay*2)}
  }
});
