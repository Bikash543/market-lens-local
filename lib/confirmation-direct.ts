import {bars,Q,H,type Inputs} from './confirmation';
export type DirectPart={instrument:string;period:string;data:any[]};
export type DirectBundle={q:DirectPart|null;btcQ:DirectPart|null;btcH:DirectPart|null;ticker:DirectPart|null;errors:string[]};
export function applyDirectInputs(input:Inputs,bundle:DirectBundle,now=Date.now()){
  const instrument=input.symbol+'-USDT-SWAP';
  const take=(key:'q'|'btcQ'|'btcH',expected:string,period:string,step:number)=>{
    const part=bundle[key];if(!part)return;
    if(part.instrument!==expected||part.period!==period||!Array.isArray(part.data)||part.data.length>120)throw new Error('Mismatched direct candle payload');
    try{input[key]=bars(part.data,step,now)}catch(e){input.errors.push(`${key}: ${e instanceof Error?e.message:'Invalid candle data'}`)}
  };
  take('q',instrument,'15m',Q);
  if(input.symbol==='BTC')input.btcQ=input.q;else take('btcQ','BTC-USDT-SWAP','15m',Q);
  take('btcH','BTC-USDT-SWAP','1H',H);
  if(bundle.ticker){
    const p=bundle.ticker;
    if(p.instrument!==instrument||p.period!=='quote'||!Array.isArray(p.data)||p.data.length!==1||p.data[0]?.instId!==instrument)throw new Error('Mismatched direct quote payload');
    input.ticker=p.data[0];
  }
  if(Array.isArray(bundle.errors))input.errors.push(...bundle.errors.filter(x=>typeof x==='string').slice(0,8).map(x=>x.slice(0,250)));
}
