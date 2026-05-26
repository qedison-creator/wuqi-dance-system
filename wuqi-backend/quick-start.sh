#!/bin/bash
# 舞栖舞蹈社快速启动脚本

echo "🎭 舞栖舞蹈社系统 - 快速启动"
echo "=================================="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 请先安装 Node.js"
    exit 1
fi

# 进入后端目录
cd "$(dirname "$0")"

echo ""
echo "📦 安装依赖..."
if [ ! -d "node_modules" ]; then
    npm install
fi

# 检查 MongoDB（仅在 macOS/Linux
echo ""
echo "🗄️  检查 MongoDB 连接..."

echo ""
echo "🗄️  初始化数据库..."
echo "   请确保 MongoDB 服务已启动"
echo "   如果未初始化，请运行: npm run seed"

echo ""
echo "🚀 启动后端服务..."
echo "   服务地址: http://localhost:3000"
echo ""
echo "📱 管理端登录: admin / admin123"
echo "=================================="
echo ""

npm run dev
