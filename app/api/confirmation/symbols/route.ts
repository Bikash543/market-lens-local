import {directory,scope} from '@/lib/confirmation-data';
export const dynamic='force-dynamic';
export async function GET(){
  try{return Response.json({provider:'OKX',rows:await scope(directory)},{headers:{'Cache-Control':'no-store'}})}
  catch{return Response.json({error:'Coin search is temporarily unavailable. Edit your search to retry.'},{status:503,headers:{'Cache-Control':'no-store'}})}
}
