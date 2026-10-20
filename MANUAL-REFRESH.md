# Manual refresh workspace

The local app's workspace retains its Markets, Overall Direction and Trade
Confirmation panels for the lifetime of the page. Section navigation preserves
loaded results, selected inputs and panel scroll positions.

Browser-triggered provider data is requested only by an explicit Refresh action.
Mounting, navigating, focusing the browser, reconnecting and changing a timeframe
do not trigger provider calls. A new Overall Direction session reads existing
collector snapshots from local disk; returning restores the same displayed view.
Local clocks only update data ages and expire stale plans.

- All Markets and Watchlist share a retained panel. Refresh performs one finite
  pass over all active contracts, or all current watchlist members in Watchlist.
  Pagination, search and signal filters never truncate that queue. The spotlight
  refresh checks only the selected active contract. Starts are paced 1.6 seconds
  apart with at most two analyses active; a 30-second per-coin deadline prevents a
  hung feed from blocking completion. Progress distinguishes checked, available
  and unavailable assets. Failed assets are not automatically rescheduled.
  Stop or changing timeframe cancels an unfinished pass. Row count (25/50/100/All)
  only changes presentation, and never triggers requests.
- Overall Direction refreshes its primary snapshot and three supporting contexts
  once per click. The selected timeframe, alignment preference, search, main
  snapshot and supporting results are saved across section changes and reloads.
  Old snapshots remain visible with their original timestamps, with stale signals
  withheld. Its independent five-minute background collector stores history for
  four-hour comparisons while the PC is awake, without needing any browser.
- Trade Confirmation starts with no selected coin. A user search loads a cached
  directory of active OKX USDT crypto perpetuals; further searches filter it
  locally. It does not fetch quotes or analyses while searching or selecting.
  Only Analyse it requests the selected coin's evidence and its BTC/market
  reference inputs. Editing the selection or side clears and cancels the previous
  analysis. Section navigation retains the current result. Expired plans remain
  disabled until Analyse it is clicked again.

The original hosted website and standalone test sites are unchanged. This manual
refresh policy applies to the local Market Lens app.
The copied analysis rules retain their source and proxy-data disclosures.
