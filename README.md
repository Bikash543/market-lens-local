# Market Lens Local

A local crypto futures research dashboard for Windows. Screen perpetual markets, review broader altcoin direction, and analyse a selected trade setup while a separate background collector maintains market history on your PC.

**Manual refresh on screen. Background collection without an open browser. No trading-account connection or order execution.**

## Install on Windows — no commands needed

1. Open [GitHub Releases](https://github.com/Bikash543/market-lens-local/releases/latest).
2. Download **Market-Lens-Local-Setup-0.3.0-x64.exe** from Assets.
3. Run the installer and choose whether to create a desktop shortcut and start background collection at Windows sign-in.
4. Open **Market Lens Local** from your desktop or Start menu.

The installer includes Node.js and the app runtime. No npm, terminal commands, API key or administrator access is required. Supported target: Windows 10 version 2004 or newer / Windows 11, x64. Brave is optional; your default browser works too.

The installer is **unsigned**, so Windows may display an unknown-publisher or SmartScreen notice. Download only from this repository's release and compare with the published SHA-256 checksum when verifying a file.

Installed app data is stored in `%LOCALAPPDATA%\Market Lens Local\data`, separately from the program files. Updates and uninstall preserve this folder. Use the Start menu's **Stop background collection** shortcut to stop the service; Windows Settings → Apps removes the program. The installer does not automatically update itself.

The v0.3.0 installer predates the source updates described below. Downloading source from `main` includes the latest fixes; the existing installer has not been rebuilt with them.

In current source, aggregate OI can recover 15m, 1h and 4h comparisons from official OKX history. This is separate from market-direction bias: an optional CoinMarketCap key enables verified historical recovery where the account has access; otherwise direction uses collected same-provider history. Missing history is never fabricated.

Developers can use the source installation below. Only run one installation on the default ports at a time.

## Features

### User guide

Open **User Guide** in the app's navigation for **Open PDF** and **Download PDF**. The 10-page guide includes the implemented signal rules, refresh and history warnings, entry/stop/target explanations, and a fillable review checklist. The PDF is bundled with the app and can be read offline.

[Read or download the user guide](public/guides/Market-Lens-User-Guide-and-Rules.pdf) · [Open the guide in the live app](https://market-lens-futures.rupeshwarsah35.chatgpt.site/user-guide)

Edition: 21 October 2026. Later source changes may supersede individual rules in this dated guide. The existing v0.3.0 installer has not been rebuilt with this addition.

| Workspace | What it does |
| --- | --- |
| All Markets | Screens active USDT perpetual contracts using price/trend, open interest, funding, taker flow and dominance context. Supports 15-minute and 1-hour analysis, search, sorting, pagination and scan progress. |
| Watchlist | Saves starred coins to local SQLite storage. The same watchlist is available across browsers, and watched coins receive background scan priority. |
| Overall Direction | Combines altcoin breadth, market-cap basket estimates, BTC direction and stablecoin-share changes across 15m, 1h and 4h windows. Preserves the displayed snapshot and selected settings across navigation. |
| Trade Confirmation | Search an active OKX coin, select a direction, then explicitly click **Analyse it**. Shows evidence, entry/stop/target references, reasons, missing inputs and exportable results. |
| Data health | Explains unavailable feeds, stale observations, signal checks and provider coverage. |
| This PC | Shows collector status, history readiness, watchlist import and a downloadable local backup. |

Also includes light/dark themes, desktop and Windows sign-in shortcuts, refresh loading indicators, success notifications after rendering, and clear partial/failure notifications.

## Latest source improvements

- The desktop supervisor checks the actual local API, recovers after three consecutive failures even if the server parent is still alive, and stops the previous collector before starting its replacement. Saved data remains in the same directory.
- The pinned local runtime runs without the developer inspector or browser live reload. Source and packaged installations retain their own ports and persistent data paths.
- When a CoinMarketCap key is configured, current dominance and four-hour listings use the authenticated endpoints too. Current dominance quotes are reused for five minutes with their original timestamps, and historical recovery requests only a missing same-provider baseline.
- Recovery status is checked against the saved baseline on each attempt. Current-quote failures replace an old Ready status, and history failures retain valid current quotes without claiming history is ready.
- Aggregate OI includes only exchange-classified, active crypto USDT perpetuals. Stocks, commodities and other non-crypto contracts are excluded from both endpoints of every comparison.
- Historical OI recovery continues toward full coverage after reaching the minimum usable threshold. Each timeframe shows matched-contract counts, notional coverage and remaining errors.
- Manual refresh and background collection remain independent. Navigation restores the displayed view; it never starts a market scan.
- CoinLore pages retain their original timestamps and are paired only when their publication times align. Saved, pending and fresh states are distinguished.
- All Markets can sort OI increases highest first or OI changes lowest first, with stale/missing observations last.
- Touched trade plans remain retired; improved candle checks prevent incomplete or stale data from becoming confirmation.
- Optional provider keys use Windows credential protection. Bounded caches, log rotation and lossless chart storage preserve watchlists and saved analysis.

See [runtime and provider update](docs/runtime-provider-update.md) and [aggregate OI methodology](docs/aggregate-oi-history.md). No personal watchlist, API key, history database or runtime log is included in this repository.

## Efficiency improvements in 0.3.0

- Reuses current closed-candle analyses in one bulk check; funding remains independently fresh.
- Shares a bounded, deduplicated scan queue between manual requests and background collection.
- Shares compatible OKX feeds across workspaces while keeping spot and futures flow separate.
- Sends compact table results and reads the exact saved chart version only when selected.
- Batches scan updates for a more responsive interface.
- Recovers original saved observations after startup or sleep and repairs candle coverage from official history endpoints. Missing intraday observations are never fabricated.

The signal rules are unchanged. Manual refresh, watchlists, themes, all workspaces and browser-independent collection remain available.

## Data and signal rules

- **Main screener:** Binance USDⓈ-M USDT perpetuals are preferred. OKX crypto USDT perpetuals are a clearly labelled fallback. Analyses identify their exchange and use that exchange's inputs.
- **Market direction:** CoinLore observations provide a top-125 market basket. Stablecoin exclusions, coverage thresholds and matching observation windows are applied. Basket estimates are **not** TradingView's licensed TOTAL3ES, TOTAL2ES, BTC.D or USDT.D indices.
- **Global dominance:** Optional CoinMarketCap data and history, with CoinPaprika/CoinGecko fallbacks. Provider-specific history is kept separate; availability depends on the API account and provider response.
- **Supporting context and Trade Confirmation:** OKX closed candles, open-interest statistics and spot-flow samples. Missing inputs remain unavailable.
- **Signals:** Rule agreement is an evidence score, not a win probability. These experimental rules have no validated profitability claim.

Candles must be closed and relevant timestamps must align. Stale, inconsistent or incomplete observations cannot become confirmed signals. Open-interest growth measures outstanding exposure; it does not identify whether new longs or shorts dominate.

## Requirements for running from source

- Windows 10/11.
- Node.js **24 LTS recommended**; the package requires Node 22.13 or newer.
- npm, bundled with Node.js.
- Internet access for public market-data APIs.
- Brave is optional; the launcher uses it when available and otherwise opens the default browser.

No exchange API key, trading account or Cloudflare login is required for local operation. Install Node from its official distribution and ensure `node` is available on PATH.

## Install and run

Clone this repository or extract its source into a permanent folder. Open PowerShell there:

```powershell
npm run install:ci
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File .\local\Install-Shortcuts.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\local\Start-MarketLens.ps1 -OpenBrowser
```

The shortcut installer creates:

- **Market Lens Local** on your desktop.
- **Market Lens Local Background** in your Windows Startup folder.

The latter starts collection at **Windows sign-in**, without opening a browser. The scripts do not require an administrator account. `ExecutionPolicy Bypass` above applies only to that PowerShell invocation.

Open **http://127.0.0.1:8787/**. Status and backups are at **http://127.0.0.1:8787/local**.

To run in the foreground without installing shortcuts:

```powershell
npm start
```

Only run one installation at a time; installations use the same local ports.

## Manual refresh and background collection

Navigation, timeframe changes and refocusing the browser do not trigger provider refreshes. Click **Refresh** to update a workspace or **Analyse it** to analyse the selected coin. Success appears after the requested results render; partial requests are labelled accordingly. A fresh Overall Direction session can read observations already stored locally.

Independently, the background service collects:

- Market quotes approximately every minute.
- Direction observations approximately every minute; dominance and supporting context approximately every five minutes. Provider caches and cooldowns can reduce outbound requests.
- Individual 15m/1h contract analyses after candle closes, sharing a paced queue with manual requests and prioritising the watchlist. Current analyses are reused with fresh funding checks.

Closing Brave does not stop the service. **Sleep, shutdown or loss of connectivity interrupts collection.** The collector resumes when the PC is running and connected; it never invents missed history.

A new installation starts with an empty watchlist and no saved history. Collected four-hour direction needs approximately four hours of suitable, timestamp-matched observations. Optional CoinMarketCap historical recovery can provide that context earlier when the account has working historical access; access is verified, not assumed. Aggregate OI has separate official-history recovery. Missing comparisons display **COLLECTING** or **UNAVAILABLE** with a reason; provider delays can extend the wait.

See [manual refresh behaviour](MANUAL-REFRESH.md) and [local operations](LOCAL-README.md).

## Storage and privacy

| Path | Contents |
| --- | --- |
| `data/state/` | Durable local database: settings, watchlist, observations and cached analyses |
| `data/backups/` | Daily JSON backups; up to 14 daily backups retained |
| `data/logs/` | Local service diagnostics |
| `data/verification/` | Locally generated verification output |

The entire `data/` directory is ignored by Git. This repository contains **source code only**, not an existing user's watchlist, market-history database, screenshots, logs or credentials.

The application, supervisor and public exchange transport bind to loopback ports **8787, 8788 and 8789**. Do not expose them through port forwarding. Public providers still receive market-data requests.

The exchange transport uses Cloudflare DNS-over-HTTPS for two fixed exchange hosts and retains TLS hostname verification. It does not change system DNS or rotate hosts to evade rate limits. Public endpoint allowlists, bounded requests and shared cooldowns limit upstream access.

## Stop, update and remove startup

Stop the service before rebuilding:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\local\Stop-MarketLens.ps1
git pull --ff-only
npm run install:ci
npm run build
```

Then open the desktop shortcut. Keep `data/state/` when updating to preserve your watchlist and history.

To disable sign-in startup, open `shell:startup` through **Win+R** and remove **Market Lens Local Background.lnk**. This does not remove saved data. The desktop shortcut can still start the service manually.

## Development and verification

Built with TypeScript, React, Vinext/Vite and Wrangler's local Cloudflare Worker/D1 runtime. The schema is initialised by the local worker on first API access.

```powershell
npm run typecheck
npm test
npm run build
```

Tests cover signal gates, closed-candle/flow alignment, caching and cooldowns, manual scans, direction persistence, collection cadence, refresh outcomes, symbol validation and local transport restrictions.

Optional live-feed verification, after starting the local service:

```powershell
node local/verify-live.mjs
```

This requests real provider data and writes results under `data/verification/`. Availability depends on the network and providers; it is not a strategy backtest.

See [Windows installer build instructions](installer/README.md) for packaging and isolated installation tests.

## Limits

This is a research application. It does not place trades or manage an account. A completed refresh means data was loaded, not that a trade is profitable. Illustrative trade plans are conditional and expire; fee, slippage and funding assumptions must be reviewed before using any plan.

Liquidation heatmaps, news and token-unlock feeds are not connected. Market-wide spot CVD and licensed index structure are not replaced by similarly named approximations. Public APIs can rate-limit, delay or reject requests; those states remain visible.

## Data-provider documentation

- [Binance USDⓈ-M market data](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api)
- [OKX API documentation](https://www.okx.com/docs-v5/en/)
- [CoinLore cryptocurrency API](https://www.coinlore.com/cryptocurrency-data-api)
- [CoinPaprika global data](https://docs.coinpaprika.com/api-reference/global/get-market-overview-data)
- [CoinGecko global data](https://docs.coingecko.com/reference/crypto-global)

Third-party dependencies retain their respective licences. The bundled stylesheet attribution is preserved in `vendor/`.
