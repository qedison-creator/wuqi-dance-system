# 复制首页背景图到后端uploads目录
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "复制首页背景图到后端uploads目录" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$srcDir = Join-Path $PSScriptRoot "..\wuqi-admin\images\hero"
$destDir = Join-Path $PSScriptRoot "uploads\hero"

Write-Host "源目录: $srcDir"
Write-Host "目标目录: $destDir"

if (-not (Test-Path $destDir)) {
    Write-Host "创建目标目录..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
}

Write-Host ""
Write-Host "正在复制文件..." -ForegroundColor Yellow

try {
    Copy-Item -Path "$srcDir\*.jpg" -Destination "$destDir\" -Force
    Write-Host ""
    Write-Host "[成功] 图片已复制到 $destDir" -ForegroundColor Green
    Write-Host "请确保后端已启动，并可以访问 /uploads/hero/ 路径" -ForegroundColor Gray
}
catch {
    Write-Host ""
    Write-Host "[失败] 复制图片出错: $_" -ForegroundColor Red
}

Write-Host ""
Read-Host "按回车键退出"
