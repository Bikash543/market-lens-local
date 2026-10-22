param(
    [string]$IsccPath,
    [switch]$SkipAppBuild
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$buildRoot = Join-Path $repoRoot 'work\installer'
$toolRoot = Join-Path $repoRoot 'work\installer-tools'
$releaseRoot = Join-Path $repoRoot 'release'
$version = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
$stage = Join-Path $buildRoot ('stage-' + $version)
$nodeVersion = '24.21.0'
$nodeHash = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
New-Item -ItemType Directory -Force -Path $buildRoot,$toolRoot,$releaseRoot | Out-Null
function Assert-NativeSuccess([string]$step) {
    if ($LASTEXITCODE -ne 0) { throw "$step failed ($LASTEXITCODE)" }
}
if (-not $SkipAppBuild) {
    Push-Location $repoRoot
    try { npm run build; Assert-NativeSuccess 'App build' } finally { Pop-Location }
}
if (Test-Path -LiteralPath $stage) {
    # Delete only the generated stage directory within this project's build root.
    $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
    $resolvedBuild = (Resolve-Path -LiteralPath $buildRoot).Path.TrimEnd('\') + '\'
    if (-not $resolvedStage.StartsWith($resolvedBuild, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe stage path' }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stage,(Join-Path $stage 'runtime'),(Join-Path $stage 'local'),(Join-Path $stage 'scripts') | Out-Null
$archive = Join-Path $toolRoot "node-v$nodeVersion-win-x64.zip"
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip" -OutFile $archive -UseBasicParsing
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $nodeHash) { throw 'Node runtime checksum mismatch' }
$nodeDirectory = Join-Path $toolRoot "node-v$nodeVersion-win-x64"
if (-not (Test-Path -LiteralPath (Join-Path $nodeDirectory 'node.exe'))) { Expand-Archive -LiteralPath $archive -DestinationPath $toolRoot -Force }
Copy-Item -LiteralPath (Join-Path $nodeDirectory 'node.exe') -Destination (Join-Path $stage 'runtime')
Copy-Item -LiteralPath (Join-Path $nodeDirectory 'LICENSE') -Destination (Join-Path $stage 'runtime\NODE-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime\package.json'),(Join-Path $PSScriptRoot 'runtime\package-lock.json') -Destination (Join-Path $stage 'runtime')
Push-Location (Join-Path $stage 'runtime')
try {
    npm ci --omit=dev --include=optional --prefer-offline --no-audit --no-fund
    Assert-NativeSuccess 'Runtime installation'
} finally { Pop-Location }
Copy-Item -LiteralPath (Join-Path $repoRoot 'dist') -Destination $stage -Recurse
foreach ($name in @('supervisor.mjs','collector.mjs','exchange-network.mjs','cadence.mjs','work-queue.mjs','recover-history.mjs','runtime-config.mjs','desktop-command.mjs','server.mjs','runtime-options.mjs','service-health.mjs','retry-policy.mjs','provider-settings.mjs','storage-maintenance.mjs')) {
    Copy-Item -LiteralPath (Join-Path $repoRoot "local\$name") -Destination (Join-Path $stage 'local')
}
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'lib') | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot 'lib\data-readiness.mjs') -Destination (Join-Path $stage 'lib')
foreach ($name in @('sites-env.mjs','tool-environment.mjs')) {
    Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\$name") -Destination (Join-Path $stage 'scripts')
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Getting-started.html') -Destination $stage
Copy-Item -LiteralPath (Join-Path $repoRoot 'README.md') -Destination $stage
@{application='Market Lens Local';version=$version;node=$nodeVersion;platform='win32-x64'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'bundle.json') -Encoding UTF8
'{"name":"market-lens-local-desktop","private":true,"type":"module"}' | Set-Content -LiteralPath (Join-Path $stage 'package.json') -Encoding UTF8

# Render the existing wave logo with Windows drawing APIs; no downloaded artwork.
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object Drawing.Bitmap 64,64
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([Drawing.Color]::FromArgb(20,34,31))
$pen = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(104,214,184)),4
$pen.StartCap = $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
foreach ($y in @(23,33,43)) {
    $curve = New-Object Drawing.Drawing2D.GraphicsPath
    $curve.AddBezier(12,$y,20,($y+7),24,($y-7),32,$y)
    $curve.AddBezier(32,$y,40,($y+7),44,($y-7),52,$y)
    $graphics.DrawPath($pen,$curve)
    $curve.Dispose()
}
$icon = [Drawing.Icon]::FromHandle($bitmap.GetHicon())
$iconFile = [IO.File]::Create((Join-Path $stage 'market-lens.ico'))
try { $icon.Save($iconFile) } finally { $iconFile.Dispose();$icon.Dispose();$pen.Dispose();$graphics.Dispose();$bitmap.Dispose() }
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll ("/win32icon:" + (Join-Path $stage 'market-lens.ico')) ("/out:" + (Join-Path $stage 'MarketLens.exe')) (Join-Path $PSScriptRoot 'Launcher.cs')
Assert-NativeSuccess 'Windows launcher compilation'

# Preserve licences for dependencies incorporated into the built JS/CSS as well.
& node (Join-Path $PSScriptRoot 'notices.mjs') $repoRoot $stage
Assert-NativeSuccess 'Third-party notices'
if (-not $IsccPath) { $IsccPath = Join-Path $toolRoot 'inno\ISCC.exe' }
if (-not (Test-Path -LiteralPath $IsccPath)) { throw 'Install Inno Setup 7 and pass -IsccPath to its ISCC.exe.' }
& $IsccPath /Q "/DAppVersion=$version" "/DStageDir=$stage" "/DReleaseDir=$releaseRoot" (Join-Path $PSScriptRoot 'MarketLens.iss')
Assert-NativeSuccess 'Installer compilation'
$installer = Join-Path $releaseRoot "Market-Lens-Local-Setup-$version-x64.exe"
$digest = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
("$digest  " + [IO.Path]::GetFileName($installer)) | Set-Content -LiteralPath (Join-Path $releaseRoot 'SHA256SUMS.txt') -Encoding ASCII
Write-Output "Installer: $installer"
Write-Output "SHA256: $digest"
