import {confirmationMarkets} from './confirmation-symbols';
import {interest,type Interest} from './local-compass/context';

export const CRYPTO_OI_UNIVERSE='okx-crypto-usdt-perpetuals-v1';
export function isCryptoOI(value:unknown):boolean{
  return !!value&&typeof value==='object'&&'universe' in value&&value.universe===CRYPTO_OI_UNIVERSE;
}
// Use the same explicit exchange classification as the market screener.
// Missing/unknown metadata never falls back to an all-contract aggregate.
export function cryptoInterest(raw:any[],instruments:unknown,now=Date.now()){
  const allowed=new Set(confirmationMarkets(instruments).map(m=>m.instrument));
  if(allowed.size<50)throw new Error('Crypto OI instrument directory is incomplete or unavailable');
  const current:Interest={...interest(raw.filter(r=>allowed.has(r.instId)),now),universe:CRYPTO_OI_UNIVERSE};
  const count=Object.keys(current.values).length;
  if(count<allowed.size*.9)throw new Error('Incomplete or stale crypto open interest');
  const directory=new Map((instruments as any[]).map(r=>[r.instId,r]));
  const excluded=[...new Set(raw.filter(r=>r.instId?.endsWith('-USDT-SWAP')).map(r=>r.instId as string))].filter(id=>!allowed.has(id));
  const excludedNonCrypto=excluded.filter(id=>{const category=directory.get(id)?.instCategory;return category&&category!=='1'}).length;
  return {current,coverage:{eligible:allowed.size,missing:allowed.size-count,excludedNonCrypto,excludedOther:excluded.length-excludedNonCrypto}};
}
// Keep original times and source, but project legacy mixed-market observations
// onto today's measured crypto set before comparisons or recovery planning.
export function cryptoHistory(history:Interest[],current:Interest):Interest[]{
  const allowed=new Set(Object.keys(current.values));
  return history.map(s=>({...s,universe:CRYPTO_OI_UNIVERSE,values:Object.fromEntries(Object.entries(s.values).filter(([id])=>allowed.has(id)))}));
}
