# Start RAG.AI so any PC on the university network can reach it.
# Serves the built React UI and the API from one port (8000).
# Run once as Administrator so the firewall rule can be created.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# The firewall rule needs Administrator. Re-launch elevated once, rather than
# starting up half-configured and leaving other PCs silently blocked.
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Requesting Administrator (needed once, to open the firewall port)..."
    Start-Process powershell -Verb RunAs -ArgumentList @(
        "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`""
    )
    return
}
$port = 8000
$ruleName = "RAG.AI (port $port)"

# Build the frontend if it has not been built yet.
if (-not (Test-Path "$root\frontend\dist\index.html")) {
    Write-Host "Building frontend..."
    Push-Location "$root\frontend"
    npm install
    npm run build
    Pop-Location
}

# Open the firewall for ALL profiles: campus networks are often classified
# Public, and a Private-only rule would silently block other PCs.
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    try {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound `
            -Protocol TCP -LocalPort $port -Action Allow `
            -Profile Domain,Private,Public | Out-Null
        Write-Host "Firewall rule created."
    } catch {
        Write-Warning "Could not create the firewall rule -- other PCs will be BLOCKED."
        Write-Warning "Close this window and re-run the script as Administrator (right-click -> Run as administrator)."
    }
} else {
    Write-Host "Firewall rule already present."
}

# Show every address other PCs could use, with the adapter each belongs to.
Write-Host ""
Write-Host "Share whichever of these is on the same network as the other lab PCs:"
Get-NetIPConfiguration | Where-Object { $_.NetIPv4Interface.ConnectionState -eq 'Connected' -and $_.IPv4Address } |
    ForEach-Object {
        foreach ($addr in $_.IPv4Address.IPAddress) {
            Write-Host ("  http://{0}:{1}   ({2})" -f $addr, $port, $_.InterfaceAlias)
        }
    }
Write-Host ""

Push-Location "$root\backend"
python -m uvicorn app.main:app --host 0.0.0.0 --port $port
Pop-Location
