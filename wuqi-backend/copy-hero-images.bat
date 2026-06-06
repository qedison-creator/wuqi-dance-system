@echo off
chcp 65001 >nul
echo ==========================================
echo 复制首页背景图到后端uploads目录
echo ==========================================

set "SRC_DIR=..\wuqi-admin\images\hero"
set "DEST_DIR=.\uploads\hero"

echo 源目录: %SRC_DIR%
echo 目标目录: %DEST_DIR%

if not exist "%DEST_DIR%" (
    echo 创建目标目录...
    mkdir "%DEST_DIR%"
)

echo.
echo 正在复制文件...

copy "%SRC_DIR%\*.jpg" "%DEST_DIR%\" /Y

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [成功] 图片已复制到 %DEST_DIR%
    echo 请确保后端已启动，并可以访问 /uploads/hero/ 路径
) else (
    echo.
    echo [失败] 复制图片出错，请检查源目录是否存在
)

echo.
echo 按任意键退出...
pause >nul
