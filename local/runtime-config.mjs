import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function runtimeConfig(env = process.env, root = fileURLToPath(new URL('../', import.meta.url)), packaged = existsSync(path.join(root, 'bundle.json'))) {
  const port = Number(env.MARKET_LENS_PORT || 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65533) throw new Error('MARKET_LENS_PORT must be between 1024 and 65533.');
  if (packaged && !env.MARKET_LENS_DATA_DIR && !env.LOCALAPPDATA) throw new Error('Windows local application data folder is unavailable.');
  const data = path.resolve(env.MARKET_LENS_DATA_DIR || (packaged
    ? path.join(env.LOCALAPPDATA, 'Market Lens Local', 'data')
    : path.join(root, 'data')));
  return {
    root: path.resolve(root), data, port, controlPort: port + 1, transportPort: port + 2,
    origin: `http://127.0.0.1:${port}`,
    controlOrigin: `http://127.0.0.1:${port + 1}`,
    transportOrigin: `http://127.0.0.1:${port + 2}`,
    wrangler: path.join(root, packaged ? 'runtime' : '', 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
  };
}

export function sameInstallation(actual, expected) {
  return typeof actual === 'string' && path.resolve(actual).toLowerCase() === path.resolve(expected).toLowerCase();
}
