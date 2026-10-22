# Market Lens Local 0.4.0 — History recovery and desktop reliability

Download **Market-Lens-Local-Setup-0.4.0-x64.exe**, run it, and open **Market Lens Local** from the desktop or Start menu. Existing installer users can install over their current version.

## Fixes and improvements

- CoinMarketCap recovery uses a configured key for current dominance and four-hour listings as well as history. Authenticated and keyless caches remain separate; cached quotes retain their original timestamps.
- Dominance readiness checks the saved same-provider baseline. Failed quotes or unavailable history no longer leave an earlier Ready status displayed.
- The desktop supervisor checks the actual local API and recovers a failed worker without overlapping background collectors. Developer live reload and the inspector are disabled.
- Aggregate OI historical recovery covers 15m, 1h and 4h using only active crypto USDT perpetuals, with matching-contract coverage and remaining errors shown.
- CoinLore page alignment, partial-refresh messages, OI sorting, trade-plan retirement and storage improvements from the current source are now included in the installer.
- User Guide navigation includes the bundled PDF, available to open or download offline.
- Packaged storage maintenance writes its report beside the configured user database instead of the replaceable program files.
- Startup maintenance completes before the web worker opens the database, avoiding competing access during launch.

The original signal rules remain in place. This release does not include the retired Signal Lab filters or AI features. All Markets, Watchlist, Overall Direction, selected-coin Trade Confirmation, data health, themes and background collection remain available.

## Manual refresh and saved data

Screens retain manual refresh. Background collection continues independently while Windows is awake and connected, including after the browser closes. Sleep and shutdown pause collection.

Watchlists, provider settings, saved analyses, history and backups remain in `%LOCALAPPDATA%\Market Lens Local\data`, outside the program directory. Updates and uninstall retain this folder. Optional provider keys stay locally protected with Windows credential protection. No personal keys or saved user data are included in the installer.

Historical recovery depends on provider availability and the account's access. It can avoid waiting for a new four-hour observation window when suitable history is available; it does not guarantee immediate 15m/1h/4h readiness or fabricate missing observations.

## Included and requirements

- Bundled Node.js runtime: no Node/npm installation, terminal commands or administrator access required.
- Optional desktop shortcut and background collection at Windows sign-in; a Start-menu command stops collection.
- Windows 10 version 2004 or newer / Windows 11, x64. Internet is required for market data. Brave is optional.
- Run only one installation on the default ports. Source installations and installer editions have separate data folders; installing does not automatically import a source checkout's watchlist.

## Verification

193 automated tests, TypeScript and the production build passed. Installation checks cover actual silent installation with bundled Node, application and PDF routes, background heartbeat without a browser, and an upgrade from the published 0.3.0 installer. Persistence checks include watchlist, preferences, saved views/charts, history fixtures and Windows-encrypted test data retained through upgrade, reinstall and uninstall. Immediate watchlist reads passed across three restarts. The original desktop service remained running with the same process ID.

## Signing

This installer is **unsigned**. Windows may show an unknown-publisher or SmartScreen notice. Download from this repository and use the attached `SHA256SUMS.txt` to check the artifact. A checksum is not a code-signing certificate.

Signals express rule agreement, not a win probability. Data providers can be unavailable or delayed. The app does not execute orders.
