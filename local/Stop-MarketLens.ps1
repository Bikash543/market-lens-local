$ErrorActionPreference = 'Stop'
try {
    Invoke-RestMethod -Uri 'http://127.0.0.1:8788/stop' -Method Post -TimeoutSec 5 | Out-Null
    Write-Output 'Market Lens background collection stopped.'
} catch { Write-Output 'Market Lens is not running or could not be reached.' }
