#!/bin/bash

# Baidu-Pan-Alist 文件夹多选下载功能 - 部署验证脚本

echo "=========================================="
echo "文件夹多选下载功能 - 部署前检查"
echo "=========================================="
echo ""

# 检查 Node.js
echo "✓ 检查 Node.js..."
node --version || echo "✗ Node.js 未安装"
echo ""

# 检查 npm
echo "✓ 检查 npm..."
npm --version || echo "✗ npm 未安装"
echo ""

# 检查项目依赖
echo "✓ 检查项目依赖..."
if npm list archiver > /dev/null 2>&1; then
    echo "  ✓ archiver 已安装"
else
    echo "  ⚠ archiver 未安装，运行: npm install archiver"
fi
echo ""

# 检查关键文件
echo "✓ 检查关键文件..."
FILES=(
    "src/app/page.tsx"
    "src/app/api/alist-zip-download/route.ts"
    "package.json"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✓ $file 存在"
    else
        echo "  ✗ $file 不存在"
    fi
done
echo ""

# 编译检查
echo "✓ 编译检查..."
npm run build 2>&1 | grep -i "error" && echo "  ✗ 编译失败" || echo "  ✓ 编译成功"
echo ""

echo "=========================================="
echo "部署前检查完成！"
echo "=========================================="
echo ""
echo "后续步骤："
echo "1. npm install archiver (如果还未安装)"
echo "2. npm run build"
echo "3. npm start"
echo ""
echo "测试用例："
echo "- 选择文件 → 下载"
echo "- 选择文件夹 → 下载为 ZIP"
echo "- 混合选择 → 多任务下载"
echo "- 权限检查 → 无权限提示"
echo ""
