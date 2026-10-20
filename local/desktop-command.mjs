import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {runtimeConfig, sameInstallation} from './runtime-config.mjs';

const config = runtimeConfig();
async function status() {
  try {
    const response = await fetch(config.controlOrigin + '/status', {signal: AbortSignal.timeout(2000)});
    if (!response.ok) throw new Error('Unexpected service on the local control port.');
    const value = await response.json();
    if (value.application !== 'Market Lens Local supervisor') throw new Error('Unexpected service on the local control port.');
    return value;
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return null;
    throw error;
  }
}
async function run() {
  const current = await status();
  const owned = current && sameInstallation(current.root, config.root);
  const stopOnly = process.argv.includes('--stop') || process.argv.includes('--stop-if-owned');
  if (stopOnly) {
    if (!current || (!owned && process.argv.includes('--stop-if-owned'))) return;
    if (!owned) throw new Error('Another Market Lens installation is running. It has not been stopped.');
    await fetch(config.controlOrigin + '/stop', {method: 'POST', signal: AbortSignal.timeout(5000)});
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      if (!(await status())) return;
    }
    throw new Error('The background service is still stopping. Please try again in a moment.');
  }
  if (current && !owned) throw new Error('Another Market Lens installation is already running. Close its background service before opening this installation.');
  if (!current) {
    const child = spawn(process.execPath, [path.join(config.root, 'local', 'supervisor.mjs')], {
      cwd: config.root, detached: true, windowsHide: true, stdio: 'ignore',
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  }
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try {
      const response = await fetch(config.origin + '/api/local/status', {signal: AbortSignal.timeout(1500)});
      const value = await response.json();
      if (response.ok && value.application === 'Market Lens Local') { ready = true; break; }
    } catch {}
    await sleep(1000);
  }
  if (!ready) throw new Error('Market Lens did not finish starting. Diagnostics: ' + path.join(config.data, 'logs', 'service.log'));
  if (!process.argv.includes('--background')) {
    const brave = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ].find(existsSync);
    const program = brave || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe');
    const args = brave ? ['--app=' + config.origin + '/'] : ['url.dll,FileProtocolHandler', config.origin + '/'];
    const browser = spawn(program, args, {detached: true, stdio: 'ignore'});
    await new Promise((resolve, reject) => { browser.once('spawn', resolve); browser.once('error', reject); });
    browser.unref();
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
