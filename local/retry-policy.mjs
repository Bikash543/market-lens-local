// Separate publication delays from unavailable instruments and provider outages.
export function retryPolicy(error,attempt=1){
  const message=String(error?.message??error?.error??error??'');
  const supplied=Number(error?.retryAfterMs)||0;
  let kind='network',delayMs=Math.min(300000,15000*2**Math.min(Math.max(0,attempt-1),4));
  if(/rate limit|cooling down|queue is busy|429|50011|50040/i.test(message)){kind='rate-limit';delayMs=Math.max(60000,supplied)}
  else if(/unsupported|not an active|not found|invalid contract|404|CONTRACT_NOT_FOUND/i.test(message)){kind='unsupported';delayMs=21600000}
  else if(/451|403|regional|access restriction/i.test(message)){kind='restricted';delayMs=1800000}
  else if(/aligned open-interest|matching.*bucket|reconciled|waiting for.*funding|insufficient.*interest/i.test(message)){kind='publication';delayMs=Math.min(180000,30000*Math.max(1,attempt))}
  else if(/timed out|timeout|abort/i.test(message)){kind='timeout';delayMs=Math.min(300000,30000*2**Math.min(Math.max(0,attempt-1),3))}
  else if(/invalid|discontinuous|misaligned|stale/i.test(message)){kind='quality';delayMs=60000}
  return {kind,delayMs:Math.max(delayMs,supplied)};
}
