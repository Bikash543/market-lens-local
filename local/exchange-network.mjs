import {createServer} from 'node:http';
import https from 'node:https';
const hosts=new Set(['openapi.okx.com','fapi.binance.com']);
const cache=new Map(),flights=new Map();
export function allowedURL(raw){
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.has(url.hostname))throw new Error('Unsupported exchange URL');
  const allowed=url.hostname==='openapi.okx.com'?
    /^\/api\/v5\/(public|market|rubik\/stat)\//.test(url.pathname):
    ['/fapi/v1/time','/fapi/v1/exchangeInfo','/fapi/v1/ticker/24hr','/fapi/v1/premiumIndex','/fapi/v1/fundingInfo','/fapi/v1/klines','/futures/data/openInterestHist'].includes(url.pathname);
  if(!allowed||url.search.length>1500)throw new Error('Only public market-data endpoints are allowed');
  return url;
}
async function addresses(host){
  const saved=cache.get(host);if(saved&&saved.until>Date.now())return saved.values;
  if(flights.has(host))return flights.get(host);
  const promise=(async()=>{
    const r=await fetch('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(host)+'&type=A',{
      headers:{Accept:'application/dns-json'},signal:AbortSignal.timeout(6000)});
    if(!r.ok)throw new Error('Exchange DNS resolver unavailable');
    const result=await r.json();
    const answers=(result.Answer??[]).filter(a=>a.type===1&&/^\d+\.\d+\.\d+\.\d+$/.test(a.data)&&! /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.data));
    if(result.Status!==0||!answers.length)throw new Error('No public exchange address returned');
    const values=answers.map(a=>({address:a.data,family:4}));
    cache.set(host,{values,until:Date.now()+Math.max(60,Math.min(300,...answers.map(a=>a.TTL||60)))*1000});
    return values;
  })();flights.set(host,promise);try{return await promise}finally{flights.delete(host)}
}
const agent=new https.Agent({keepAlive:true,maxSockets:8,lookup(host,options,callback){
  addresses(host).then(values=>options.all?callback(null,values):callback(null,values[0].address,4),error=>callback(error));
}});
export async function startExchangeNetwork(log){
  const server=createServer((req,res)=>{
    if(req.method!=='GET'||req.headers.host!=='127.0.0.1:8789'||req.headers.origin){
      res.writeHead(403);res.end('Local server requests only');return;
    }
    let url;
    try{url=allowedURL(new URL(req.url,'http://127.0.0.1:8789').searchParams.get('url')||'')}
    catch{res.writeHead(400);res.end('Unsupported public endpoint');return}
    const upstream=https.get(url,{agent,timeout:12000,headers:{Accept:'application/json','User-Agent':'MarketLensLocal/1.0'}},response=>{
      const chunks=[];let bytes=0;
      response.on('data',chunk=>{bytes+=chunk.length;if(bytes>8_000_000)upstream.destroy(new Error('Exchange response too large'));else chunks.push(chunk)});
      response.on('end',()=>{
        if(res.destroyed||res.writableEnded)return;
        res.writeHead(response.statusCode||502,{'Content-Type':'application/json','Cache-Control':'no-store',
          ...(response.headers['retry-after']?{'Retry-After':response.headers['retry-after']}:{})});
        res.end(Buffer.concat(chunks));
      });
    });
    // TLS remains verified against the original exchange hostname and SNI.
    upstream.on('timeout',()=>upstream.destroy(new Error('Exchange request timed out')));
    upstream.on('error',e=>{
      log('Exchange connection: '+e.message);
      if(!res.writableEnded&&!res.destroyed){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}))}
    });
    res.on('close',()=>{if(!res.writableEnded)upstream.destroy()});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8789,'127.0.0.1',resolve)});
  log('Exchange network ready: app-only encrypted DNS, verified TLS, fixed public endpoints.');
  return server;
}
