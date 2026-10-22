# Runtime and provider reliability update

This source update carries the current original desktop app fixes into the public repository. Existing signal rules, manual refresh, selected-coin analysis, watchlists and background collection are preserved.

## CoinMarketCap recovery

Configured accounts now use authenticated endpoints for current dominance quotes and four-hour constituent listings as well as history. Keyless current quotes use a separate cache. Current dominance quotes are reused for five minutes without changing their original observation time.

Dominance recovery verifies that a comparable same-provider baseline was actually saved. It updates status after current-quote failures rather than leaving an earlier Ready message. Historical access failures retain valid current quotes, back off further recovery attempts, and keep missing history explicit. The change does not grant historical API access or guarantee provider availability.

## Background runtime recovery

The supervisor probes the local API after startup. Three consecutive failed probes restart only its recorded child process tree, including when the parent process survives a worker crash. Startup timeouts also trigger recovery. Collection is cancelled and awaited before a replacement starts, preventing overlapping collectors.

The desktop uses the existing pinned Wrangler runtime through its worker API, with the developer inspector and live reload disabled. Source installations keep their existing database. Packaged installations keep user data outside replaceable program files and preserve configurable ports for isolated tests.

Startup storage maintenance finishes before the worker opens SQLite, preventing startup reads from competing with maintenance. Its report follows the configured user-data path. Scheduled maintenance and manual display refresh remain independent.

## Distribution

The installer build allowlist includes the new runtime entry point and its local dependencies. The v0.4.0 installer packages these fixes and the bundled user guide; the previous v0.3.0 artifact remains available unchanged. Packaged storage maintenance also writes its report to the configured user data directory.

The repository excludes personal databases, provider keys, watchlists, logs and verification screenshots. The experimental Signal Lab rules and proposed AI features are not part of this update.

## Verification

Run `npm test`, `npm run typecheck` and `npm run build` from a source checkout. Regression tests cover authenticated/keyless cache isolation, saved-baseline validation, history failures, recovery status changes, worker health monitoring, stop behaviour and persistent paths for source/packaged installations. Tests of signal calculations do not establish trading profitability.

Publication checks passed on 22 October 2026: 192 tests, TypeScript and production build. Isolated source and staged-package runtime checks each served the market, direction, confirmation, guide and PDF routes, forwarded the configured control port, and preserved a test watchlist through a server restart. The staged runtime dependency check covered all 17 reachable local modules. These checks used separate ports and disposable databases; they did not alter an existing installation or rebuild the released executable.

The subsequent v0.4.0 packaging verification passed 193 tests, including the configured storage-report path regression. The actual 0.3.0-to-0.4.0 upgrade preserved an isolated watchlist, preferences, saved view/chart, history fixtures and Windows-encrypted test file through upgrade, reinstall and uninstall. Decryption was verified, as were immediate watchlist reads after three restarts. The original desktop service's process ID was unchanged. See the release notes for installer verification and requirements.
