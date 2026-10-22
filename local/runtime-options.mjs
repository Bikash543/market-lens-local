import path from 'node:path';
import {runtimeConfig} from './runtime-config.mjs';

// Keep source and packaged installations on their own persistent database.
// The desktop runtime needs neither developer tracing nor browser reloads.
export function runtimeOptions(root, config=runtimeConfig(process.env,root)){
  return {
    config:path.join(root,'dist/server/wrangler.json'),
    sendMetrics:false,
    bindings:{
      MARKET_LENS_TRANSPORT_ORIGIN:{type:'plain_text',value:config.transportOrigin},
      MARKET_LENS_CONTROL_ORIGIN:{type:'plain_text',value:config.controlOrigin}
    },
    dev:{remote:false,inspector:false,liveReload:false,watch:false,
      persist:path.join(config.data,'state'),
      server:{hostname:'127.0.0.1',port:config.port},logLevel:'info',enableContainers:false}
  };
}
