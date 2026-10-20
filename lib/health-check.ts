// Exchange APIs can reject a request inside an HTTP 200 response.
export function inspectHealth(status:number,body:string){
  let value:any;
  try{value=JSON.parse(body)}catch{return {healthy:false,message:'Endpoint did not return JSON market data'}}
  if(status<200||status>=300)return {healthy:false,message:String(value?.msg||value?.error||`HTTP ${status}`).slice(0,350)};
  if(value?.error||value?.code!==undefined&&!['0','200'].includes(String(value.code)))
    return {healthy:false,message:String(value.msg||value.error||`Provider error ${value.code}`).slice(0,350)};
  if(!value||typeof value!=='object'||!Object.keys(value).length)return {healthy:false,message:'Empty provider response'};
  return {healthy:true,message:'Public data endpoint responded successfully'};
}
