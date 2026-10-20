$ErrorActionPreference = 'Stop'
$localRoot = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')
$shell = New-Object -ComObject WScript.Shell
$launcher = Join-Path $PSScriptRoot 'Launch-MarketLens.vbs'
$icon = 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe,0'
if (-not (Test-Path -LiteralPath ($icon -replace ',0$',''))) { $icon = 'C:\Windows\System32\shell32.dll,14' }
foreach ($item in @(
    @{Path=(Join-Path $desktop 'Market Lens Local.lnk');Args=('--open');Description='Open your private Market Lens dashboard. Starts its local background collector if needed.'},
    @{Path=(Join-Path $startup 'Market Lens Local Background.lnk');Args='';Description='Collect Market Lens data locally after Windows sign-in. No browser window is opened.'}
)) {
    $shortcut = $shell.CreateShortcut($item.Path)
    $shortcut.TargetPath = 'C:\Windows\System32\wscript.exe'
    $shortcut.Arguments = '"' + $launcher + '" ' + $item.Args
    $shortcut.WorkingDirectory = $localRoot
    $shortcut.Description = $item.Description
    $shortcut.WindowStyle = 7
    $shortcut.IconLocation = $icon
    $shortcut.Save()
    Write-Output $item.Path
}
