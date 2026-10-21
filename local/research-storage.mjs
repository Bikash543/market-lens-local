import fs from 'node:fs';
import path from 'node:path';
import {createGzip,createGunzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {Writable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';

function inside(root,file){
  const resolved=fs.realpathSync(file),relative=path.relative(fs.realpathSync(root),resolved);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||fs.lstatSync(file).isSymbolicLink())throw new Error('Archive path is outside the approved research folder');
  return resolved;
}
async function digest(file,gzip=false){
  const hash=createHash('sha256');let bytes=0;
  const sink=new Writable({write(chunk,encoding,done){hash.update(chunk);bytes+=chunk.length;done()}});
  await pipeline(...(gzip?[fs.createReadStream(file),createGunzip(),sink]:[fs.createReadStream(file),sink]));
  return {sha256:hash.digest('hex'),bytes};
}
export async function archiveBinary(root,file){
  file=inside(root,file);if(!file.endsWith('.bin'))throw new Error('Only generated binary working files can be archived');
  const target=file+'.gz',temp=target+'.partial';
  if(fs.existsSync(target)||fs.existsSync(temp))throw new Error('Archive already exists; original preserved');
  const before=fs.statSync(file),original=await digest(file);
  await pipeline(fs.createReadStream(file),createGzip({level:1}),fs.createWriteStream(temp,{flags:'wx'}));
  const verified=await digest(temp,true),after=fs.statSync(file);
  if(verified.sha256!==original.sha256||verified.bytes!==original.bytes||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('Archive validation failed; original preserved');
  const record={file:path.relative(root,file),archive:path.relative(root,target),...original,archiveBytes:fs.statSync(temp).size,archivedAt:new Date().toISOString()};
  if(record.archiveBytes>=original.bytes){fs.unlinkSync(temp);return {...record,skipped:'No space saving',archiveBytes:original.bytes}}
  // Durable sidecar first: even a power loss before the index is updated leaves
  // the checksum and restoration path next to the archive.
  fs.writeFileSync(target+'.json',JSON.stringify(record,null,2),{flag:'wx'});
  fs.renameSync(temp,target);
  // A verified, lossless copy exists before the generated original is removed.
  inside(root,file);fs.unlinkSync(file);
  return record;
}
export async function restoreBinary(root,record){
  const archive=inside(root,path.resolve(root,record.archive)),target=path.resolve(root,record.file),relative=path.relative(fs.realpathSync(root),target);
  if(relative.startsWith('..')||path.isAbsolute(relative)||archive!==target+'.gz')throw new Error('Invalid archive manifest');
  if(fs.existsSync(target))return {alreadyRestored:true};
  const verified=await digest(archive,true);if(verified.sha256!==record.sha256||verified.bytes!==record.bytes)throw new Error('Archive checksum mismatch');
  const temp=target+'.restoring';await pipeline(fs.createReadStream(archive),createGunzip(),fs.createWriteStream(temp,{flags:'wx'}));
  fs.renameSync(temp,target);return {restored:record.file};
}
export async function archiveResearch(policy,notify=()=>{}){
  const root=fs.realpathSync(policy.root),manifest=path.join(root,'research-archive-manifest.json');
  const index=new Map((fs.existsSync(manifest)?JSON.parse(fs.readFileSync(manifest,'utf8')):[]).map(r=>[r.archive,r]));
  const files=[];
  function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(item.isSymbolicLink())continue;const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(item.isFile()&&file.endsWith('.bin.gz.json')){
    const r=JSON.parse(fs.readFileSync(file,'utf8')),archive=path.resolve(root,r.archive);
    if(file!==archive+'.json'||archive!==path.resolve(root,r.file)+'.gz'||!fs.existsSync(archive))continue;
    inside(root,archive);index.set(r.archive,r);
  }else if(item.isFile()&&file.endsWith('.bin')&&Date.now()-fs.statSync(file).mtimeMs>=policy.minAgeHours*3600000)files.push(file)}}
  for(const folder of policy.folders){const dir=path.resolve(root,folder);inside(root,dir);walk(dir)}
  async function saveIndex(){
    fs.writeFileSync(manifest+'.tmp',JSON.stringify([...index.values()],null,2));
    for(let attempt=0;;attempt++){try{fs.renameSync(manifest+'.tmp',manifest);return}catch(e){if(!['EPERM','EBUSY','EACCES'].includes(e.code)||attempt>=10)throw e;await pause(150*(attempt+1))}}
  }
  await saveIndex();let pending=0;
  for(const file of files){
    if(fs.existsSync(file+'.gz'))continue;
    const record=await archiveBinary(root,file);if(record.skipped){notify(record);continue}index.set(record.archive,record);
    // Each archive has a durable sidecar. Batch the redundant searchable index.
    if(++pending>=100){await saveIndex();pending=0}notify(record);
  }
  await saveIndex();const records=[...index.values()];
  return {files:records.length,originalBytes:records.reduce((s,r)=>s+r.bytes,0),archiveBytes:records.reduce((s,r)=>s+r.archiveBytes,0)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,config]=process.argv.slice(2),policy=JSON.parse(fs.readFileSync(config,'utf8'));
  if(mode==='archive')console.log(JSON.stringify(await archiveResearch(policy,r=>console.log(JSON.stringify({file:r.file,savedBytes:r.bytes-r.archiveBytes})))));
  else if(mode==='restore')for(const record of JSON.parse(fs.readFileSync(path.join(policy.root,'research-archive-manifest.json'),'utf8')))console.log(JSON.stringify(await restoreBinary(policy.root,record)));
  else throw new Error('Use archive or restore with an explicit policy file');
}
