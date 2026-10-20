param([switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
$localRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$ready = $false
try {
    $state = Invoke-RestMethod -Uri 'http://127.0.0.1:8788/status' -TimeoutSec 3
    $ready = $state.application -eq 'Market Lens Local supervisor'
} catch {}
if (-not $ready) {
    $supervisorPath = Join-Path $localRoot 'local\supervisor.mjs'
    Start-Process -FilePath $nodePath -ArgumentList @('"' + $supervisorPath + '"') -WorkingDirectory $localRoot -WindowStyle Hidden
}
if ($OpenBrowser) {
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        try {
            $app = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/local/status' -TimeoutSec 2
            if ($app.application -eq 'Market Lens Local') { break }
        } catch {}
        Start-Sleep -Seconds 1
    }
    $bravePaths = @(
        'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe',
        'C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe',
        (Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\Application\brave.exe')
    )
    $bravePath = $bravePaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    # This visible browser window is the desktop app the user requested.
    if ($bravePath) { Start-Process -FilePath $bravePath -ArgumentList '--app=http://127.0.0.1:8787/' }
    else { Start-Process 'http://127.0.0.1:8787/' }
}
