const encoder=new TextEncoder();
async function digest(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),v=>v.toString(16).padStart(2,'0')).join('')}
export async function packChart(body:string){
  const bytes=encoder.encode(body);
  const packed=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let binary='';for(const n of packed)binary+=String.fromCharCode(n);
  const result=JSON.stringify({storageVersion:3,codec:'gzip',sha256:await digest(bytes),data:btoa(binary)});
  return result.length<body.length*.9?result:body;
}
export async function unpackChart(value:any){
  if(value?.storageVersion!==3)return value;
  if(value.codec!=='gzip'||typeof value.data!=='string'||value.data.length>2000000)throw new Error('Invalid chart archive');
  const bytes=Uint8Array.from(atob(value.data),c=>c.charCodeAt(0));
  const restored=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  if(restored.length>4000000||await digest(restored)!==value.sha256)throw new Error('Chart archive checksum mismatch');
  return JSON.parse(new TextDecoder().decode(restored));
}
