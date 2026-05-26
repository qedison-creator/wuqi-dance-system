# 舞栖舞蹈社后端服务启动脚本 (PowerShell)
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  舞栖舞蹈社后端服务启动" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 切换到脚本所在目录
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath
Write-Host "当前目录: $scriptPath" -ForegroundColor Green
Write-Host ""

# 尝试查找 Node.js
Write-Host "正在查找 Node.js..." -ForegroundColor Yellow
$nodePaths = @(
    "C:\Program Files\nodejs\node.exe",
    "C:\Program Files (x86)\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
    "$env:APPDATA\npm\node.exe",
    "node.exe"
)

$foundNode = $null
foreach ($path in $nodePaths) {
    if (Test-Path $path) {
        $foundNode = $path
        break
    }
}

# 检查 npm
$npmPaths = @(
    "C:\Program Files\nodejs\npm.cmd",
    "C:\Program Files (x86)\nodejs\npm.cmd",
    "$env:LOCALAPPDATA\Programs\nodejs\npm.cmd",
    "$env:APPDATA\npm\npm.cmd",
    "npm.cmd"
)

$foundNpm = $null
foreach ($path in $npmPaths) {
    if (Test-Path $path) {
        $foundNpm = $path
        break
    }
}

if (-not $foundNpm) {
    $foundNpm = "npm"
}

Write-Host ""
Write-Host "尝试启动服务..." -ForegroundColor Cyan
Write-Host ""

try {
    # 直接尝试运行 npm
    & $foundNpm run dev
} catch {
    Write-Host ""
    Write-Host "启动失败！" -ForegroundColor Red
    Write-Host "请确保已正确安装 Node.js" -ForegroundColor Red
    Write-Host ""
    Write-Host "下载地址: https://nodejs.org/" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "按 Enter 键退出"
}
