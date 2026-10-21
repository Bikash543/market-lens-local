import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const variables={cmc:['CMC_API_KEY','COINMARKETCAP_API_KEY'],coinalyze:['COINALYZE_API_KEY']};
const secrets=new Map();
function protect(value,decrypt=false){
  // Windows CurrentUser DPAPI. Secret material travels only over stdin/stdout,
  // never command-line arguments, logs, browser storage or database backups.
  const script=`Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); ${decrypt?
    '$bytes=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))':
    '$bytes=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($bytes))'}`;
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('Credential storage timed out'))},10000);
    child.stdout.on('data',b=>output+=b);child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(new Error('Windows credential protection unavailable'))});
    child.on('close',code=>{clearTimeout(timer);code===0?resolve(output.trim()):reject(new Error('Windows credential protection failed'))});child.stdin.end(value);
  });
}
export async function loadProviderSettings(root){
  for(const [provider,names] of Object.entries(variables)){
    let key=names.map(n=>process.env[n]).find(Boolean);
    if(!key){try{key=await protect(await fs.readFile(path.join(process.env.MARKET_LENS_DATA_DIR||path.join(root,'data'),`private/${provider}.dpapi`),'utf8'),true)}catch{}}
    if(key)secrets.set(provider,key);
  }
}
export function providerKey(provider){return secrets.get(provider)}
export function providerStatus(){return {cmc:{configured:secrets.has('cmc'),purpose:'Historical BTC/USDT dominance recovery; access is verified when requested'},coinalyze:{configured:secrets.has('coinalyze'),purpose:'Optional selected-coin multi-exchange derivatives'},gate:{configured:true,purpose:'Public Gate derivatives comparison; never substitutes another exchange in signal checks'}}}
export async function saveProviderKey(root,provider,key){
  if(!Object.hasOwn(variables,provider)||typeof key!=='string'||key.length>256||key&& !/^[A-Za-z0-9_-]+$/.test(key))throw new Error('Invalid provider or API key format');
  const dir=path.join(process.env.MARKET_LENS_DATA_DIR||path.join(root,'data'),'private');await fs.mkdir(dir,{recursive:true});
  const file=path.join(dir,`${provider}.dpapi`);
  if(!key){await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e});secrets.delete(provider)}
  else{const encrypted=await protect(key);await fs.writeFile(file+'.tmp',encrypted);await fs.rename(file+'.tmp',file);secrets.set(provider,key)}
  return providerStatus();
}
