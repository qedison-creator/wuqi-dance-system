@echo off
REM 舞栖舞蹈社系统 - 快速启动脚本 (Windows)

chcp 65001 >nul
echo 🎭 舞栖舞蹈社系统 - 快速启动
echo ==================================

REM 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ 请先安装 Node.js
    pause
    exit /b 1
)

REM 进入后端目录
cd /d "%~dp0"

echo.
echo 📦 安装依赖...
if not exist "node_modules" (
    npm install
)

echo.
echo 🗄️  检查环境配置已就绪
echo.
echo ==================================
echo 📌 快速开始:
echo.
echo 1️⃣  初始化数据库（第一次运行^):
echo    npm run seed
echo.
echo 2️⃣  启动服务:
echo    npm run dev
echo.
echo 🚀 服务地址: http://localhost:3000
echo 🔑 管理端登录: admin / admin123
echo ==================================
echo.
echo 按任意键启动服务...
pause >nul

npm run dev
