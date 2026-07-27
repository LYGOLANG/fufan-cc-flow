# Agent Flow 桌面版安装脚本
#
# 为什么需要独立脚本：安装必须先关掉 Agent Flow，而助手会话跑在它的 Node
# sidecar 里 —— 关掉应用等于切断助手自己。所以这段流程要以**独立进程**运行
# （Start-Process 拉起本脚本），这样助手断线后它仍会跑完。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/install-desktop.ps1 -Installer "<安装包路径>"

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
Log "=== 开始安装 $Installer ==="

if (-not (Test-Path $Installer)) {
    Log "安装包不存在，中止"
    exit 1
}

# ── 1. 关闭应用 ──
# 连同 sidecar 一起：NSIS 覆盖不了被占用的 node.exe，残留会导致
# "Error opening file for writing: node.exe"
Log "关闭 Agent Flow 及其 sidecar…"
Get-Process -Name "app" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "*cc-flow*" } |
    ForEach-Object { Log "  停止 app.exe (PID $($_.Id))"; Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }

Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -like "*cc-flow*" } |
    ForEach-Object { Log "  停止 sidecar node.exe (PID $($_.ProcessId))"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 3

# ── 2. 静默安装 ──
Log "运行安装程序（静默）…"
$proc = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
Log "安装程序退出码：$($proc.ExitCode)"

if ($proc.ExitCode -ne 0) {
    Log "安装失败，未启动应用。可手动重装上一版回滚。"
    exit $proc.ExitCode
}

# ── 3. 确认版本并启动 ──
Start-Sleep -Seconds 2
if (Test-Path $AppExe) {
    $ver = (Get-Item $AppExe).VersionInfo.ProductVersion
    Log "已安装版本：$ver"
    Log "启动应用…"
    Start-Process -FilePath $AppExe
    Log "=== 完成 ==="
    exit 0
} else {
    Log "找不到 $AppExe —— 安装目录可能变了，请手动启动"
    exit 1
}
