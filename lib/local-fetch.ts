// The local Node transport resolves the two exchange hosts with encrypted DNS.
// API responses, rate-limit codes and TLS verification remain unchanged.
export const localFetch:typeof fetch=(input,init)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  const parsed=new URL(url);
  if(['openapi.okx.com','fapi.binance.com'].includes(parsed.hostname)){
    return fetch('http://127.0.0.1:8789/?url='+encodeURIComponent(url),init);
  }
  return fetch(input,init);
};
