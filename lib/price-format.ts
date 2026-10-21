export function formatPrice(n:number|null|undefined):string{
  if(n==null||!Number.isFinite(n))return '—';
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',
    ...(Math.abs(n)>=1e6?{notation:'compact' as const,maximumFractionDigits:2}:Math.abs(n)>0&&Math.abs(n)<1?{maximumSignificantDigits:5}:{minimumFractionDigits:2,maximumFractionDigits:2})}).format(n);
}
