# Agent Flow desktop installer helper.
#
# Why a standalone script: installing requires closing Agent Flow first, but the
# assistant session runs inside its Node sidecar -- closing the app cuts the
# assistant off. So this flow must run as an INDEPENDENT process (launched via
# Start-Process) to survive that disconnect.
#
# NOTE: intentionally ASCII-only. This file is executed by Windows PowerShell,
# which reads .ps1 as ANSI/GBK on a Chinese locale; UTF-8 Chinese text here gets
# mis-decoded and breaks string parsing (hit exactly that -- the script failed to
# start at all and left no log).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/install-desktop.ps1 -Installer "<path>"

param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [string]$AppExe = "D:\cc-flow\Agent Flow\app.exe",
    [string]$LogFile = "$env:LOCALAPPDATA\com.fufan.ccflow\install.log"
)

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
    Write-Output $line
    try { Add-Content -Path $LogFile -Value $line -ErrorAction Stop } catch {}
}

New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
Log "=== install start: $Installer ==="

if (-not (Test-Path $Installer)) {
    Log "ERROR: installer not found, aborting"
    exit 1
}

# --- 1. close app + sidecar ---
# NSIS cannot overwrite a locked node.exe; leftovers cause
# "Error opening file for writing: node.exe"
Log "closing Agent Flow and its sidecar..."
Get-Process -Name "app" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "*cc-flow*" } |
    ForEach-Object {
        Log ("  stopping app.exe pid {0}" -f $_.Id)
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }

Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -like "*cc-flow*" } |
    ForEach-Object {
        Log ("  stopping sidecar node.exe pid {0}" -f $_.ProcessId)
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Start-Sleep -Seconds 3

# --- 2. silent install ---
Log "running installer (silent)..."
$proc = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
Log "installer exit code: $($proc.ExitCode)"

if ($proc.ExitCode -ne 0) {
    Log "ERROR: install failed; app NOT relaunched. Reinstall previous version to roll back."
    exit $proc.ExitCode
}

# --- 3. verify version and relaunch ---
Start-Sleep -Seconds 2
if (Test-Path $AppExe) {
    $ver = (Get-Item $AppExe).VersionInfo.ProductVersion
    Log "installed version: $ver"
    Log "launching app..."
    Start-Process -FilePath $AppExe
    Log "=== done ==="
    exit 0
} else {
    Log "ERROR: $AppExe not found -- install dir may have changed; launch manually"
    exit 1
}
