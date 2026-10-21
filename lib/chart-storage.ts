export async function encodeChart(value:any){
  const rows=await Promise.all(value.candles.map(async(c:any)=>{
    const body=JSON.stringify(c),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
    const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
    return {id:hash,body};
  }));
  return {rows,body:JSON.stringify({...value,candles:[],storageVersion:2,candleRefs:rows.map(r=>r.id)})};
}
export function decodeChart(value:any,rows:{id:string;body:string}[]){
  if(value.storageVersion!==2)return value;
  const byId=new Map(rows.map(r=>[r.id,r.body]));
  const candles=value.candleRefs.map((id:string)=>{const row=byId.get(id);if(!row)throw new Error('Saved candle reference unavailable');return JSON.parse(row)});
  const {storageVersion,candleRefs,...original}=value;
  return {...original,candles};
}
