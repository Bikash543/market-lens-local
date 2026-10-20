import {env} from 'cloudflare:workers';
import {json} from '@/lib/local-store';
export async function GET(){
  const [settings,dominance,marketHistory,observations]=await Promise.all([
    env.DB!.prepare('SELECT * FROM local_settings WHERE key!=?').bind('collector').all(),
    env.DB!.prepare('SELECT * FROM dominance ORDER BY time').all(),
    env.DB!.prepare('SELECT * FROM market_history ORDER BY time').all(),
    env.DB!.prepare('SELECT * FROM observations ORDER BY time').all()
  ]);
  return json({format:'market-lens-local-backup-v1',createdAt:Date.now(),settings:settings.results,dominance:dominance.results,marketHistory:marketHistory.results,observations:observations.results});
}
