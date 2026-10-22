import '../scripts/sites-env.mjs';
import {createRequire} from 'node:module';
import {runtimeConfig} from './runtime-config.mjs';
import {runtimeOptions} from './runtime-options.mjs';

const config=runtimeConfig();
// Resolve the pinned runtime from node_modules for source installs, or from
// runtime/node_modules when launched by the self-contained Windows package.
const {unstable_startWorker}=createRequire(config.wrangler)('wrangler');
const worker=await unstable_startWorker(runtimeOptions(config.root,config));
await worker.ready;
console.log(`Local runtime ready at ${await worker.url}; developer inspector disabled.`);
let stopping=false;
async function stop(){
  if(stopping)return;stopping=true;
  await worker.dispose();process.exit(0);
}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
