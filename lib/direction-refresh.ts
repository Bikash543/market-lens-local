type SnapshotResponse = {status:number; data:Record<string,any>};

// Finish the refresh the user requested. Follow-ups read the server's shared
// cache; they do not start a client polling loop or another upstream collector.
export async function finishDirectionRefresh(
  read:()=>Promise<SnapshotResponse>,
  pause:(ms:number)=>Promise<void> = ms=>new Promise(resolve=>setTimeout(resolve,ms)),
):Promise<SnapshotResponse>{
  let latest=await read();
  if(latest.status!==200||!latest.data.refreshing)return latest;
  try{
    for(const delay of [1500,3000,4500]){
      await pause(delay);
      const next=await read();
      if(next.status!==200)break;
      latest=next;
      if(!next.data.refreshing)return next;
    }
  }catch{/* Keep the real saved snapshot, with its original observation time. */}
  return {...latest,data:{...latest.data,refreshing:false,refreshError:'The source has not completed a fresh observation yet. This is the saved snapshot; click Refresh to try again.'}};
}
