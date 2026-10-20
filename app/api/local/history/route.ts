import {historyStatus} from '@/lib/local-compass/data';
import {json} from '@/lib/local-store';
export async function GET(){return json(await historyStatus())}
