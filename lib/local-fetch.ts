// The local Node transport resolves the two exchange hosts with encrypted DNS.
// API responses, rate-limit codes and TLS verification remain unchanged.
export const localFetch:typeof fetch=(input,init)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  const parsed=new URL(url);
  if(['openapi.okx.com','fapi.binance.com','api.gateio.ws','pro-api.coinmarketcap.com','api.coinalyze.net'].includes(parsed.hostname)){
    const transport=process.env.MARKET_LENS_TRANSPORT_ORIGIN||'http://127.0.0.1:8789';
    if(!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(transport))throw new Error('Invalid local exchange transport');
    return fetch(transport+'/?url='+encodeURIComponent(url),init);
  }
  return fetch(input,init);
};
