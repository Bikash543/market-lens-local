// Used only against the disposable data directory created by smoke-test.ps1.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
const [mode,dataArg,testArg]=process.argv.slice(2);
const data=path.resolve(dataArg),testRoot=path.resolve(testArg);
const smokeRoot=path.resolve(import.meta.dirname,'../work/installer-smoke');
assert.ok(testRoot.startsWith(smokeRoot+path.sep));
assert.equal(data,path.join(testRoot,'User data'));
assert.ok(['seed','verify'].includes(mode));
const dir=path.join(data,'state/v3/d1/miniflare-D1DatabaseObject');
const file=fs.readdirSync(dir).find(f=>f.endsWith('.sqlite'));
assert.ok(file,'The old installer must have created its own database');
const db=new DatabaseSync(path.join(dir,file),{readOnly:mode==='verify'});db.exec('PRAGMA busy_timeout=5000');
const manifest=path.join(testRoot,'protected-data.json');
const protectedFiles=['private/upgrade-fixture.dpapi','backups/upgrade-fixture.json'];
const digest=b=>createHash('sha256').update(b).digest('hex');
function protectedFixture(value,decrypt=false){
  const script="$ProgressPreference='SilentlyContinue'; Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); "+(decrypt?
    '$bytes=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))':
    '$bytes=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($bytes))');
  return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-OutputFormat','Text','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{input:value,encoding:'utf8',windowsHide:true,timeout:15000}).trim();
}
try {
  if(mode==='seed'){
    // Extra fixture keys cannot be mistaken for live market data or provider keys.
    db.prepare('INSERT OR REPLACE INTO local_settings VALUES (?,?,?)').run('installer-test-preferences',JSON.stringify({theme:'dark',manualRefresh:true}),Date.now());
    db.exec('CREATE TABLE IF NOT EXISTS local_snapshots(key TEXT PRIMARY KEY,body TEXT,updated INTEGER)');
    db.prepare('INSERT OR REPLACE INTO local_snapshots VALUES (?,?,?)').run('installer-test-saved-view',JSON.stringify({saved:true,selection:'BTCUSDT',values:[1,2,3]}),Date.now());
    for(const name of protectedFiles){fs.mkdirSync(path.dirname(path.join(data,name)),{recursive:true});const value='Isolated installer preservation fixture: '+name;fs.writeFileSync(path.join(data,name),name.endsWith('.dpapi')?protectedFixture(value):value);}
    // History fixtures are outside the six-hour calculation window but inside
    // retention. They exercise schema continuity without influencing live rules.
    const at=Date.now()-7*3600000;
    db.prepare('INSERT INTO dominance(time,btc,usdt,source) VALUES(?,?,?,?)').run(at,57,6,'Installer preservation fixture');
    for(const table of ['observations','market_history'])db.prepare(`INSERT INTO ${table}(time,body) VALUES(?,?)`).run(at,JSON.stringify({at,source:'Installer preservation fixture',values:{},prices:{}}));
    const tables=['dominance','observations','market_history'];
    const history=Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()]));
    const settings=db.prepare("SELECT * FROM local_settings WHERE key IN ('watchlist','installer-test-preferences') ORDER BY key").all();
    const snapshot=db.prepare("SELECT * FROM local_snapshots WHERE key='installer-test-saved-view'").get();
    db.prepare('INSERT INTO local_analysis_details(exchange,symbol,interval,closedAt,body) VALUES(?,?,?,?,?)').run('OKX','INSTALLERFIXTUREUSDT','15m',at,JSON.stringify({symbol:'INSTALLERFIXTUREUSDT',candles:[{t:at-900000,o:10,h:11,l:9,c:10.5,v:1}],cvdSeries:[{t:at-900000,value:0.25}]}));
    const analysis=db.prepare("SELECT * FROM local_analysis_details WHERE symbol='INSTALLERFIXTUREUSDT'").get();
    fs.writeFileSync(manifest,JSON.stringify({settings,snapshot,history,analysis,files:Object.fromEntries(protectedFiles.map(name=>[name,digest(fs.readFileSync(path.join(data,name)))]))}));
    console.log('Captured isolated upgrade fixtures and '+Object.values(history).flat().length+' existing history records');
  }else{
    const saved=JSON.parse(fs.readFileSync(manifest,'utf8'));
    for(const row of saved.settings)assert.deepEqual({...db.prepare('SELECT * FROM local_settings WHERE key=?').get(row.key)},row);
    assert.deepEqual({...db.prepare('SELECT * FROM local_snapshots WHERE key=?').get(saved.snapshot.key)},saved.snapshot);
    assert.deepEqual({...db.prepare('SELECT * FROM local_analysis_details WHERE symbol=?').get(saved.analysis.symbol)},saved.analysis);
    for(const [table,rows] of Object.entries(saved.history))for(const row of rows)assert.deepEqual({...db.prepare(`SELECT * FROM ${table} WHERE time=?`).get(row.time)},row,table+' history was changed');
    for(const [name,hash] of Object.entries(saved.files))assert.equal(digest(fs.readFileSync(path.join(data,name))),hash,name+' changed');
    const secretName=protectedFiles[0];assert.equal(protectedFixture(fs.readFileSync(path.join(data,secretName),'utf8'),true),'Isolated installer preservation fixture: '+secretName,'Protected fixture no longer decrypts for this user');
    console.log('Saved watchlist, preferences, view, history and protected files verified');
  }
}finally{db.close();}
