# Local operations

Follow [README.md](README.md) for installation.

The desktop shortcut starts the background service when needed, then opens the app. The Startup shortcut starts it at Windows sign-in without opening a browser.

## Keep these files together

Keep the application folder in a permanent location. Its `data/state/` directory contains the durable local database; browser cache clearing does not remove it. If you move the installation, rerun `local/Install-Shortcuts.ps1` so the shortcuts point to the new folder.

## Background service

The supervisor starts the local web server, a restricted public exchange-data transport, and the collector. It recovers from unexpected server exits and collector errors. All listeners use `127.0.0.1`; ports 8787–8789 must be available.

Closing the browser does not stop collection. Keep the PC awake and online when accumulating history. Missing observations after sleep or outages are skipped. Four-hour bias remains unavailable until real observations cover the required comparison window.

## Manual refresh

Displayed results update on Refresh or Analyse. Loading feedback remains until the requested work settles, followed by success, partial completion or an error. Expired signals remain withheld even when an older snapshot is still visible.

Opening a new Overall Direction session may load an existing disk snapshot. Returning to a section restores its displayed data and settings; it does not refresh provider feeds.

## Status, backup and troubleshooting

Open http://127.0.0.1:8787/local to inspect the collector heartbeat, history coverage and recent errors. This page also imports watchlist symbols and exports a backup.

- Service logs: `data/logs/service.log`.
- Daily backups: `data/backups/`.
- Live checks: `node local/verify-live.mjs`.
- Stop collection: `powershell -NoProfile -ExecutionPolicy Bypass -File .\local\Stop-MarketLens.ps1`.
- Restart: open **Market Lens Local** on the desktop.

If startup fails, check that Node.js is installed and on PATH, dependencies are installed, the application has been built, and no other installation uses the same ports.

If providers fail, inspect their error messages rather than assuming a neutral or missing signal is a working feed. Rate limits are respected. A successful HTTP response may still contain a provider-level error.

Do not remove `data/state/` to fix a browser display issue. Stop the service before copying the installation or rebuilding it.
