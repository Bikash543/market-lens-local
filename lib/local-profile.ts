import {isContractSymbol} from './contract-symbol';
export function validSymbols(input:unknown):string[]{
  if(!Array.isArray(input)||input.length>2000||input.some(s=>!isContractSymbol(s)))throw new Error('Use valid USDT contract symbols.');
  return [...new Set(input as string[])];
}
export function updateWatchlist(previous:string[],body:any){
  if(body.op==='add')return validSymbols([...previous,...validSymbols([body.symbol])]);
  if(body.op==='remove'){validSymbols([body.symbol]);return previous.filter(s=>s!==body.symbol)}
  if(body.op==='import')return validSymbols([...previous,...validSymbols(body.symbols)]);
  throw new Error('Unknown watchlist operation.');
}
