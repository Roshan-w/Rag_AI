# Silent autostart variant of start-server.ps1 -- runs at login with no UAC
# prompt and no console window. Assumes the firewall rule was already created
# once via start-server.ps1 (Administrator) -- Windows Firewall rules persist
# across reboots, so that one-time step doesn't need repeating here.
#
# Self-cleaning like start-llama-router.ps1: kills anything already on port
# 8000 before starting, so re-running this after a crash or double-login is
# always safe.
$root = $PSScriptRoot
$port = 8000

Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
        Write-Host "Stopping stale process on port $port (pid $_)"
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    }

Start-Sleep -Seconds 2

Push-Location "$root\backend"
python -m uvicorn app.main:app --host 0.0.0.0 --port $port
Pop-Location
