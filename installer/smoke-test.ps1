param([string]$InstallerPath, [string]$PreviousInstallerPath)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
if (-not $InstallerPath) { $InstallerPath = Join-Path $repoRoot "release\Market-Lens-Local-Setup-$version-x64.exe" }
$registration = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{94D7F0AA-A8E4-4FA1-AB60-E579BCE62C54}_is1'
if (Test-Path -LiteralPath $registration) { throw 'An installer edition is already registered. Test in a clean Windows account instead.' }
$testBase = Join-Path $repoRoot 'work\installer-smoke'
$testRoot = Join-Path $testBase (Get-Date -Format 'yyyyMMdd-HHmmss')
$installDir = Join-Path $testRoot 'Installed app'
$dataDir = Join-Path $testRoot 'User data'
$base = 'http://127.0.0.1:18787'
$control = 'http://127.0.0.1:18788'
foreach ($port in @(18787,18788,18789)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Test port $port is already used" }
}
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
$env:MARKET_LENS_PORT = '18787'
$env:MARKET_LENS_DATA_DIR = $dataDir
$originalPath = $env:PATH
$originalStatus = $null
try { $originalStatus = Invoke-RestMethod 'http://127.0.0.1:8788/status' -TimeoutSec 2 } catch {}
$results = [Collections.Generic.List[string]]::new()
function Pass([string]$name) { $results.Add($name); Write-Output ("PASS: " + $name) }
function Install-App([string]$Setup = $InstallerPath) {
    $process = Start-Process -FilePath $Setup -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS','/TASKS=""',('/DIR="' + $installDir + '"'),('/LOG="' + (Join-Path $testRoot ('install-' + [IO.Path]::GetFileNameWithoutExtension($Setup) + '.log')) + '"')) -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer exit code $($process.ExitCode)" }
}
function Launch-App([string]$arguments) {
    # -Wait waits for descendants too, including the intentionally persistent
    # collector. Wait only for the launcher process itself.
    $process = Start-Process -FilePath (Join-Path $installDir 'MarketLens.exe') -ArgumentList $arguments -WorkingDirectory $installDir -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(250000)) { throw 'Launcher did not finish within its startup deadline' }
    if ($process.ExitCode -ne 0) {
        Get-Content -LiteralPath (Join-Path $dataDir 'logs\service.log') -Tail 60 -ErrorAction SilentlyContinue
        throw "Launcher exit code $($process.ExitCode)"
    }
}
function Read-Api([string]$route) { Invoke-RestMethod -Uri ($base + $route) -TimeoutSec 30 }
$installed = $false
try {
    if ($PreviousInstallerPath) { Install-App $PreviousInstallerPath } else { Install-App }
    $installed = $true
    foreach ($file in @('MarketLens.exe','runtime\node.exe','local\supervisor.mjs','local\work-queue.mjs','local\recover-history.mjs','dist\server\wrangler.json','Getting-started.html','unins000.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $installDir $file))) { throw "Missing installed file $file" }
    }
    Pass 'Silent installation in a folder containing spaces'
    if (-not (Test-Path -LiteralPath $registration)) { throw 'Windows uninstall registration is missing' }
    Pass 'Windows uninstall registration'
    # Remove developer tools from PATH: the installed launcher must use its own Node.
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
    Launch-App '--background --quiet'
    $state = Invoke-RestMethod -Uri ($control + '/status') -TimeoutSec 5
    if ($state.root.TrimEnd('\') -ne $installDir.TrimEnd('\')) { throw 'Wrong service installation root' }
    if ($state.dataDirectory -ne $dataDir) { throw 'Wrong durable data directory' }
    Pass 'Bundled-runtime launch without Node/npm on PATH'
    foreach ($route in @('/','/overall-direction','/trade-confirmation','/local')) {
        $page = Invoke-WebRequest -Uri ($base + $route) -UseBasicParsing -TimeoutSec 30
        if ($page.StatusCode -ne 200 -or $page.Content.Length -lt 500) { throw "Page failed: $route" }
    }
    Pass 'Market, direction, confirmation and local-status pages'
    $profile = Read-Api '/api/local/profile'
    if (@($profile.watchlist).Count -ne 0) { throw 'Installer contained an existing watchlist' }
    Pass 'Fresh installation contains no user watchlist'
    Invoke-RestMethod -Uri ($base + '/api/local/profile') -Method Post -ContentType 'application/json' -Body '{"op":"add","symbol":"BTCUSDT"}' | Out-Null
    $profile = Read-Api '/api/local/profile'
    if ('BTCUSDT' -notin $profile.watchlist) { throw 'Watchlist write failed' }
    Pass 'Watchlist write'
    if ($PreviousInstallerPath) {
        # Capture the old installation's real saved data with its service stopped.
        Launch-App '--stop --quiet'
        & (Join-Path $installDir 'runtime\node.exe') (Join-Path $PSScriptRoot 'verify-upgrade-data.mjs') seed $dataDir $testRoot
        if ($LASTEXITCODE -ne 0) { throw 'Cannot seed isolated upgrade fixtures' }
        Launch-App '--background --quiet'
        Install-App
        Launch-App '--background --quiet'
        if ('BTCUSDT' -notin (Read-Api '/api/local/profile').watchlist) { throw 'Watchlist lost during version upgrade' }
        & (Join-Path $installDir 'runtime\node.exe') (Join-Path $PSScriptRoot 'verify-upgrade-data.mjs') verify $dataDir $testRoot
        if ($LASTEXITCODE -ne 0) { throw 'Saved data changed during version upgrade' }
        Pass 'Upgrade from previous released installer preserves watchlist, saved views, preferences, history and protected files'
    }
    if ((Get-Content -LiteralPath (Join-Path $installDir 'bundle.json') -Raw | ConvertFrom-Json).version -ne $version) { throw 'Installed bundle version does not match release' }
    foreach ($route in @('/user-guide','/guides/Market-Lens-User-Guide-and-Rules.pdf')) {
        $page = Invoke-WebRequest -Uri ($base + $route) -UseBasicParsing -TimeoutSec 30
        if ($page.StatusCode -ne 200 -or $page.RawContentLength -lt 500) { throw "Guide failed: $route" }
    }
    Pass 'Updated bundle version and bundled PDF guide'
    $active = $null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $active = Read-Api '/api/local/status'
        if ($active.running -and $active.collector.startedAt) { break }
        Start-Sleep -Seconds 2
    }
    if (-not $active.running -or -not $active.collector.startedAt) { throw 'Background collector did not report activity' }
    Pass 'Background collector heartbeat without a browser'
    $queueBefore = (Invoke-RestMethod -Uri ($control + '/status') -TimeoutSec 5).queue
    if ($null -eq $queueBefore) { throw 'Shared scan queue status is missing' }
    $market = Read-Api '/api/market'
    if ($market.exchange -notin @('Binance','OKX') -or -not $market.rows) { throw 'No live market provider available for installer scan test' }
    $scanBody = @{exchange=$market.exchange;interval='1h';symbols=@('ETHUSDT');summary=$true;selected=$true} | ConvertTo-Json -Compress
    $scan = Invoke-RestMethod -Uri ($base + '/api/scan') -Method Post -ContentType 'application/json' -Body $scanBody -TimeoutSec 60
    $row = $scan.rows[0]
    if ($row.symbol -ne 'ETHUSDT' -or $row.error -or @($row.candles).Count -ne 0) { throw ('Compact scan failed: ' + ($row | ConvertTo-Json -Compress)) }
    $detail = Read-Api ("/api/local/analysis-detail?exchange=" + $market.exchange + "&symbol=ETHUSDT&interval=1h&closedAt=" + $row.closedAt)
    if ($detail.closedAt -ne $row.closedAt -or @($detail.candles).Count -lt 35) { throw 'Saved chart version does not match compact row' }
    $queueAfter = (Invoke-RestMethod -Uri ($control + '/status') -TimeoutSec 5).queue
    if ($queueAfter.submitted -lt 1) { throw 'Isolated installer scan queue did not receive work' }
    Pass 'New shared queue and exact-version compact chart API on isolated installer ports'
    $started = $active.collector.startedAt
    for ($restart = 0; $restart -lt 3; $restart++) {
        Launch-App '--stop --quiet'
        Launch-App '--background --quiet'
        if ('BTCUSDT' -notin (Read-Api '/api/local/profile').watchlist) { throw 'Watchlist was lost or unreadable after restart' }
    }
    Pass 'Watchlist is readable immediately after three service restarts'
    # Install over a running copy: setup must stop only its own service.
    Install-App
    Launch-App '--background --quiet'
    if ('BTCUSDT' -notin (Read-Api '/api/local/profile').watchlist) { throw 'Watchlist was lost after reinstall' }
    Pass 'Reinstall/update over a running app preserves watchlist'
    if ($PreviousInstallerPath) {
        & (Join-Path $installDir 'runtime\node.exe') (Join-Path $PSScriptRoot 'verify-upgrade-data.mjs') verify $dataDir $testRoot
        if ($LASTEXITCODE -ne 0) { throw 'Saved data changed after reinstall' }
        Pass 'Saved data fixtures survive reinstall'
    }
    $backup = Read-Api '/api/local/backup'
    if (-not $backup) { throw 'Backup endpoint is empty' }
    Pass 'Local backup endpoint'
    $process = Start-Process -FilePath (Join-Path $installDir 'unins000.exe') -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Uninstaller exit code $($process.ExitCode)" }
    $installed = $false
    if (Test-Path -LiteralPath (Join-Path $installDir 'MarketLens.exe')) { throw 'Launcher remains after uninstall' }
    if (Test-Path -LiteralPath $registration) { throw 'Uninstall registration remains' }
    if (-not (Test-Path -LiteralPath (Join-Path $dataDir 'state'))) { throw 'Uninstaller removed user data' }
    Pass 'Uninstall removes program and registration while retaining data'
    if ($PreviousInstallerPath) {
        & (Join-Path $repoRoot 'work\installer-tools\node-v24.21.0-win-x64\node.exe') (Join-Path $PSScriptRoot 'verify-upgrade-data.mjs') verify $dataDir $testRoot
        if ($LASTEXITCODE -ne 0) { throw 'Saved data changed after uninstall' }
        Pass 'Saved data fixtures survive uninstall'
    }
    if ($originalStatus) {
        $after = Invoke-RestMethod 'http://127.0.0.1:8788/status' -TimeoutSec 5
        if ($after.pid -ne $originalStatus.pid) { throw 'Original local service changed during test' }
        Pass 'Original local service PID unchanged'
    }
    $report = @{version=$version;at=(Get-Date).ToUniversalTime().ToString('o');checks=$results;result='PASS'} | ConvertTo-Json -Depth 5
    $report | Set-Content -LiteralPath (Join-Path $testRoot 'result.json') -Encoding UTF8
    $report | Set-Content -LiteralPath (Join-Path $testBase 'last-result.json') -Encoding UTF8
} finally {
    if ($installed -and (Test-Path -LiteralPath (Join-Path $installDir 'unins000.exe'))) {
        $cleanup = Start-Process -FilePath (Join-Path $installDir 'unins000.exe') -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -WindowStyle Hidden -Wait -PassThru
        if ($cleanup.ExitCode -ne 0) { Write-Warning 'Test installation cleanup needs attention.' }
    }
    $env:PATH = $originalPath
    Remove-Item Env:MARKET_LENS_PORT -ErrorAction SilentlyContinue
    Remove-Item Env:MARKET_LENS_DATA_DIR -ErrorAction SilentlyContinue
}
