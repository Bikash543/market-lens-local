# Market Lens Local 0.3.0 — Faster manual refresh and background collection

Download **Market-Lens-Local-Setup-0.3.0-x64.exe** below, run it, and open **Market Lens Local** from the desktop or Start menu.

## Improved in this release

- Bulk reuse of current closed-candle analyses, with fresh funding validation.
- Candle-aware background scheduling and a shared, bounded scan queue with deduplication, manual-request priority and starvation protection.
- Shared OKX data caches across compatible features; spot and futures flow remain separate.
- Compact market rows, batched screen updates and exact-version chart data loaded on selection.
- Recovery of genuine saved observations at startup or after sleep, plus official candle-history fallback.
- Existing manual refresh, watchlists, 15m/1h analyses, 4h context, themes and all workspaces are retained. Signal formulas and thresholds are unchanged.

## Included

- Complete app plus a pinned Node.js runtime: no Node/npm installation, commands, exchange API key or administrator access required.
- All Markets, persistent Watchlist, Overall Direction (15m/1h/4h), Trade Confirmation and local collector status.
- Manual screen refresh with loading, success and partial-result feedback.
- Optional desktop shortcut and background collection at Windows sign-in.
- Start-menu shortcut to stop background collection.
- Getting-started guide, Windows uninstall support and SHA-256 checksum file.

## System requirements

Windows 10 version 2004 or newer, or Windows 11; x64. Internet access is needed for market data. Brave is optional; the default browser is supported.

## Saved data and updates

The installer keeps watchlists, history, logs and backups in `%LOCALAPPDATA%\Market Lens Local\data`. Updating or uninstalling the app preserves this folder. Download and run a newer installer to update; automatic updates are not enabled.

Background collection works while Windows is running and connected, even after the browser closes. Sleep and shutdown pause collection. A fresh installation needs approximately four hours of measured history before its first complete 4h bias; provider delays can extend this.

Only one Market Lens installation may use the default local ports. Stop an existing source installation before launching this edition.

## Verification

- 107 automated tests passed, including seven-coin/two-timeframe signal parity, freshness rejection, queue deduplication, fairness and timeouts.
- TypeScript check and production build passed.
- Actual installer tested in an isolated directory, using the bundled Node runtime with developer Node/npm removed from PATH.
- Verified application pages, collector heartbeat without a browser, watchlist persistence after restart and reinstall, backup access, and uninstall with user-data retention.

## Signing and limitations

This installer is **unsigned**. Windows may show an unknown-publisher or SmartScreen notice. Obtain it from this repository's release and use `SHA256SUMS.txt` to verify the artifact when needed; a checksum is not a code-signing certificate.

Signals are research rules, not a win probability or a profit guarantee. Public market-data providers can be unavailable or delayed. The app does not execute orders or connect to a trading account.
