# 文件夹多选下载功能 - 快速参考

## 💡 功能总结
- ✅ 文件和文件夹都支持复选框选择
- ✅ 支持批量混合下载（文件 + 文件夹）
- ✅ 文件夹自动打包为 ZIP 下载
- ✅ 完整的权限系统集成

## 📝 主要文件改动

| 文件 | 改动类型 | 关键变化 |
|---|---|---|
| `src/app/page.tsx` | 修改 | 复选框支持文件夹、批量下载增强 |
| `src/app/api/alist-zip-download/route.ts` | **新增** | ZIP 打包和权限检查 |
| `package.json` | 修改 | 添加 archiver 依赖 |

## 🔧 快速部署

### 1️⃣ 本地开发
```bash
# 已自动完成
npm install archiver
npm run dev
```

### 2️⃣ 生产部署
```bash
npm run build
npm start
```

## 👥 用户使用指南

### 基本操作
1. **选择项目**：点击任何文件或文件夹前的☐ 复选框
2. **全选快捷**：点击状态栏的项目计数处快速全选/取消全选
3. **执行下载**：点击"↓ 批量下载"按钮
4. **自动处理**：
   - 📄 文件直接下载
   - 📁 文件夹打包为ZIP后下载

### 混合选择示例
```
选择：文件A + 文件B + 文件夹C + 文件夹D
    ↓
点击"批量下载"
    ↓
- 文件A、文件B 直接下载到默认位置
- 文件夹C、文件夹D 打包为 download.zip，开始下载
```

## 🔐 权限系统集成

### 权限检查流程
```
前端权限检查
  ↓ canDownload? (基本权限)
  ↓ 否 → 提示"无下载权限"
  ↓
  ↓ 是 → 后端处理
     ↓
     检查每个路径的 view 权限
        ↓ 否 → 返回 403
     ↓
     检查每个路径的 download 权限
        ↓ 否 → 返回 403
     ↓
     检查 basePath 隔离
        ↓ 否 → 返回 403
     ↓
     ✅ 生成 ZIP 并下载
```

### 权限场景

#### 场景 A：管理员（admin）
- 全部权限 ✅
- 可下载任何文件和文件夹

#### 场景 B：核心成员（manager）
- 有 view 和 download 权限 ✅
- 可下载设定的 basePath 内的内容

#### 场景 C：游客（guest）
- 有 view 权限 ✅
- 无 download 权限 ❌
- 无法使用批量下载

#### 场景 D：受限用户
- basePath = `/Movies`
- 无法下载 `/Music` 中的文件夹 ❌

## ⚙️ 系统配置

### 环境变量需求
已有（无需更改）：
- `NEXT_PUBLIC_ALIST_URL` - AList 服务地址
- `ALIST_USERNAME` - AList 用户名
- `ALIST_PASSWORD` - AList 密码

### 依赖库
- `archiver` v6+ (ZIP 打包)

## 📊 API 架构

### 新增 API：`GET /api/alist-zip-download`

**请求参数**：
```
?paths=["path1","path2"]&token=xxx
```

**权限检查**：
- 验证用户身份
- 对每个路径检查 view + download 权限
- 基于 basePath 隔离

**响应**：
```
Content-Type: application/zip
Content-Disposition: attachment; filename=download.zip
```

**错误响应**：
- 401: 用户未登录
- 403: 权限不足
- 503: archiver 库未安装

## 🧪 测试验证清单

- [ ] 选择单个文件 → 直接下载
- [ ] 选择单个文件夹 → ZIP 下载
- [ ] 混合选择（3文件+2文件夹）→ 分别处理
- [ ] 全选 → 包括所有文件和文件夹
- [ ] 权限检查：无下载权限用户 → 提示"无下载权限"
- [ ] 权限检查：basePath 限制用户 → 无法下载外部文件夹
- [ ] 嵌套文件夹（3层） → ZIP 内保留目录结构
- [ ] 百度网盘文件夹 → 能正常打包
- [ ] 大文件夹（>100MB） → 能完成打包（可能较慢）
- [ ] 空文件夹 → 生成空 ZIP

## 📿 故障排查

### 问题：下载按钮灰显
- **原因**：没有选中任何项目
- **解决**：点击至少一个复选框

### 问题：提示"无下载权限"
- **原因**：用户权限中 download 设为 false
- **解决**：管理员在用户权限面板启用 download

### 问题：ZIP 下载失败，返回 503
- **原因**：archiver 库未安装
- **解决**：运行 `npm install archiver`

### 问题：ZIP 文件很小或为空
- **原因**：部分文件无访问权限，已跳过
- **解决**：检查单个文件的权限

### 问题：下载很慢
- **原因**：文件夹过大、网络不稳定或服务器负载高
- **解决**：分小批下载，检查网络连接

## 📚 相关文档

完整技术文档：[FOLDER_DOWNLOAD_IMPLEMENTATION.md](./FOLDER_DOWNLOAD_IMPLEMENTATION.md)

## 🎯 未来计划

- 进度条显示
- 文件夹内文件二级选择
- 缓存已打包的 ZIP
- 支持多种压缩格式（7z、rar）
- 限制单次打包大小

---

**状态**：✅ **已完成核心功能**
**最后更新**：2026-04-18
**维护人**：AI Assistant
