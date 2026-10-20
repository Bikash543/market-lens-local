// Public exchanges can list non-Latin tickers. Allow letters/numbers only;
// separators, URL parameters and control characters remain invalid.
const contractPattern = new RegExp('^[\\p{L}\\p{M}\\p{N}_]{1,30}USDT(?![\\s\\S])', 'u');
export function isContractSymbol(value: unknown): value is string {
  return typeof value === 'string' && value === value.toUpperCase() && contractPattern.test(value);
}
