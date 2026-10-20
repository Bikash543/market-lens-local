# Windows packaging

The installer is a per-user Inno Setup package with a small .NET Framework launcher, a pinned Node 24.21.0 x64 runtime, the compiled dashboard and a locked Wrangler runtime. End users do not need a developer toolchain. The launcher starts the local service with hidden console windows and opens Brave or the default browser.

## Build

On a Windows x64 build machine with Node/npm, the .NET Framework C# compiler and [Inno Setup 7](https://jrsoftware.org/isinfo.php):

```powershell
npm run install:ci
npm test
npm run typecheck
powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\build.ps1 -IsccPath "C:\path\to\Inno Setup 7\ISCC.exe"
```

The build downloads Node from nodejs.org and verifies a pinned SHA-256. The runtime dependencies use `installer/runtime/package-lock.json`. It stages only an allowlist of application files under `work/installer/` and writes the setup executable and `SHA256SUMS.txt` under `release/`; both directories are ignored by Git. It includes Node's licence, dependency licence files and generated notices for bundled frontend dependencies.

No signing certificate is configured. A release must say the executable is unsigned; a checksum establishes the release artifact's identity, not publisher code signing.

## Persistence and lifecycle

- Program: `%LOCALAPPDATA%\Programs\Market Lens Local`.
- Durable data: `%LOCALAPPDATA%\Market Lens Local\data`.
- Shortcuts: desktop (optional), Start menu, stop background service, and Windows sign-in (optional).
- Upgrades and uninstall stop only the service whose reported installation root matches this installation. They do not terminate all Node processes or a separate source checkout.
- Uninstall removes program files and shortcuts, retaining user data.
- No broker or exchange account is connected; no orders are executed.

## Isolated installation test

`smoke-test.ps1` installs the actual setup executable silently into a test folder with shortcuts disabled, runs it using its bundled Node executable, checks application routes and collector activity, verifies watchlist persistence after restart and reinstall, then uninstalls it and checks that saved data survives.

It uses ports 18787–18789 and a data directory inside `work/installer-smoke/`. It leaves any service on the default ports untouched. Run it only on a machine that does **not** already have the packaged installer version registered, since a Windows installation has one registration per AppId:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\smoke-test.ps1
```

This verifies packaging and local persistence. It does not establish strategy profitability, guarantee public API availability, or simulate four hours of market history.
