import {setTimeout as sleep} from 'node:timers/promises';

// Read the response once. A restarting worker may return plain text instead of
// JSON; retain that useful diagnostic rather than reporting a JSON syntax error.
export async function localJSON(response){
  const text=await response.text();let value;
  try{value=JSON.parse(text)}catch{throw new Error(`Local API ${response.status}: ${text.slice(0,240)||'Empty response'}`)}
  if(!response.ok)throw new Error(value?.error||`Local API ${response.status}`);
  return value;
}

// A healthy Wrangler parent does not imply its child worker is alive. Require
// consecutive failed HTTP probes before recycling only our recorded child tree.
export async function monitorServer({signal,probe,onUnhealthy,intervalMs=10000,maxFailures=3,pause=(ms,s)=>sleep(ms,undefined,{signal:s})}){
  let failures=0;
  while(!signal.aborted){
    try{await pause(intervalMs,signal)}catch{if(signal.aborted)return;throw new Error('Health timer failed')}
    if(signal.aborted)return;
    let healthy=false;
    try{healthy=await probe(signal)}catch{}
    if(signal.aborted)return;
    failures=healthy?0:failures+1;
    if(failures>=maxFailures){await onUnhealthy();return}
  }
}
