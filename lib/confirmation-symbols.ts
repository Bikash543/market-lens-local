export type ConfirmationMarket={symbol:string;instrument:string};

// Accept ticker and USDT-pair searches without ever passing arbitrary paths to OKX.
export function normalizeCoin(value:string):string|null{
  const raw=value.trim().toUpperCase();
  if(!/^[A-Z0-9/-]{1,50}$/.test(raw))return null;
  const symbol=raw.replace(/-USDT-SWAP$|\/USDT$|-USDT$|USDT$/,'');
  return /^[A-Z0-9]{1,30}$/.test(symbol)?symbol:null;
}

export function confirmationMarkets(raw:unknown):ConfirmationMarket[]{
  if(!Array.isArray(raw))throw new Error('Market directory unavailable');
  const found=new Map<string,ConfirmationMarket>();
  for(const row of raw){
    if(row?.state!=='live'||row.instCategory!=='1'||row.settleCcy!=='USDT'||row.ctType!=='linear'||row.instType!=='SWAP')continue;
    if(typeof row.instId!=='string'||!row.instId.endsWith('-USDT-SWAP'))continue;
    const symbol=normalizeCoin(row.instId);
    if(symbol&&row.instId===`${symbol}-USDT-SWAP`)found.set(symbol,{symbol,instrument:row.instId});
  }
  return [...found.values()].sort((a,b)=>a.symbol.localeCompare(b.symbol));
}

export function searchConfirmationMarkets(markets:ConfirmationMarket[],query:string):ConfirmationMarket[]{
  const q=normalizeCoin(query);
  if(!q)return [];
  return markets.filter(m=>m.symbol.includes(q)).sort((a,b)=>
    Number(b.symbol===q)-Number(a.symbol===q)||
    Number(b.symbol.startsWith(q))-Number(a.symbol.startsWith(q))||
    a.symbol.localeCompare(b.symbol)
  ).slice(0,12);
}
