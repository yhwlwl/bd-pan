# Baidu-Pan-Alist 文件夹多选下载功能实现说明

## 功能概述
增添文件夹多选框，允许用户同时选择文件和文件夹批量下载，生成 ZIP 压缩包。

## 核心改动

### 前端改动 (src/app/page.tsx)

#### 1. **扩展复选框支持** (line ~2939)
- **改动前**：仅文件显示复选框，文件夹显示占位符
- **改动后**：文件和文件夹都显示复选框，支持统一选择

```typescript
// 原代码：
{!file.is_dir ? (
  <input type="checkbox" ... />
) : <span className="w-3 shrink-0" />}

// 新代码：
<input type="checkbox" checked={alistSelected.has(file.name)} 
  onChange={() => alistToggleSelect(file.name)}
  className="w-3 h-3 accent-pink-500 shrink-0 cursor-pointer" 
  title={file.is_dir ? '选择文件夹' : '选择文件'} />
```

#### 2. **修改全选逻辑** (line ~965)
- **改动前**：`alistSelectAll()` 过滤掉文件夹，仅选中文件
- **改动后**：选择所有项目（文件和文件夹）

```typescript
// 原代码：
const fileNames = alistFiles.filter((f: any) => !f.is_dir).map((f: any) => f.name);

// 新代码：
const allNames = alistFiles.map((f: any) => f.name);
```

#### 3. **增强批量下载逻辑** (line ~936)
- **权限检查**：检查 `canDownload` 权限
- **项目分离**：区分文件和文件夹
- **差异化处理**：
  - 文件：使用原有的代理下载 / 直连下载
  - 文件夹：调用新的 ZIP 打包 API
  
```typescript
const alistBatchDownload = () => {
  // 权限检查
  if (!canDownload) { setAlistMsg('❌ 无下载权限'); return; }
  
  // 分离文件夹和文件
  const selectedItems = Array.from(alistSelected).map(name => {
    const file = alistFiles.find((f: any) => f.name === name);
    const filePath = `${alistPath.replace(/\/+$/, '')}/${name}`;
    return { name, file, filePath, isDir: file?.is_dir || false };
  });

  const files = selectedItems.filter(item => !item.isDir);
  const folders = selectedItems.filter(item => item.isDir);

  // 下载文件
  files.forEach(({ name, file, filePath }) => { ... });

  // 下载文件夹 (ZIP)
  if (folders.length > 0) {
    alistBatchDownloadFolders(folders);
  }
};
```

#### 4. **新增文件夹下载函数**
```typescript
const alistBatchDownloadFolders = (folders: Array<{ name: string; filePath: string }>) => {
  const paths = folders.map(f => f.filePath);
  logUserAction('批量下载文件夹', `${alistPath} - ${paths.join(', ')}`);
  
  const params = new URLSearchParams();
  params.set('paths', JSON.stringify(paths));
  if (userToken) params.set('token', userToken);

  const downloadUrl = `/api/alist-zip-download?${params.toString()}`;
  // 触发下载
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = '文件夹打包.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};
```

#### 5. **改进状态栏显示** (line ~3045-3047)
- 显示选中项目总数和文件夹数量
- 示例："☑ 5 个选中项 (含 2 个文件夹)"

### 后端改动 (新文件：src/app/api/alist-zip-download/route.ts)

#### API 端点
- **路由**：`GET /api/alist-zip-download`
- **参数**：
  - `paths`: JSON 数组，包含要打包的文件/文件夹路径
  - `token`: 用户认证令牌（可选，如果在 Authorization header 中已提供）

#### 核心功能
1. **权限验证**
   - 验证用户身份
   - 对每个路径检查 `view` + `download` 权限
   - 基于用户的 `basePath` 进行隔离检查

2. **递归文件收集**
   - 对于文件夹，递归获取所有子文件
   - 支持自定义深度限制（默认 5 层）

3. **ZIP 生成**
   - 使用 `archiver` 库生成 ZIP 压缩包
   - 压缩级别设为 5（平衡速度和大小）
   - 保留目录结构

4. **错误处理**
   - 若 archiver 库未安装，返回友好的错误提示
   - 无法访问的文件会跳过（不中断流程）

#### 权限系统对接
```typescript
// 对每个路径进行权限检查
for (const path of paths) {
  const absolutePath = applyBasePathForPermissions(path, basePerms.basePath);
  const pathPerms = await getEffectivePermissionsForPath(
    user.username, 
    user.role, 
    absolutePath
  );
  
  // 需要同时有 view 和 download 权限
  if (!pathPerms.view || !pathPerms.download) {
    return new Response(`路径 ${path} 禁止访问或下载`, { status: 403 });
  }
}
```

## 依赖安装
已添加 `archiver` 库：
```bash
npm install archiver
```

## 使用流程

### 用户操作：
1. **选择项目**：点击文件或文件夹前的复选框，支持混合选择
2. **全选**：点击状态栏的项目计数，快速全选/取消全选
3. **批量下载**：点击"↓ 批量下载"按钮
4. **系统自动处理**：
   - 单个文件：直接下载到浏览器默认路径
   - 文件夹项：打包成 ZIP 后下载
   - 混合选择：多个下载任务并行进行

### 权限检查流程：
1. **前端**：检查 `canDownload` 权限（基本权限）
2. **后端**：
   - 验证用户身份
   - 对每个路径检查 `view`（浏览）权限
   - 对每个路径检查 `download`（下载）权限
   - 检查 `basePath` 隔离

## 测试场景

### 场景 1：基本文件夹下载
- [ ] 选择单个文件夹 → 下载为 ZIP
- [ ] 验证 ZIP 内文件结构正确
- [ ] 文件大小和内容完整

### 场景 2：混合选择
- [ ] 同时选择 3 个文件 + 2 个文件夹
- [ ] 点击批量下载
- [ ] 验证文件直接下载，文件夹打包为 ZIP

### 场景 3：权限检查
- [ ] 创建无下载权限的用户
- [ ] 尝试下载文件夹 → 应返回权限错误
- [ ] 创建受限的 basePath 用户
- [ ] 验证无法下载 basePath 外的文件夹

### 场景 4：嵌套文件夹
- [ ] 创建 3 层文件夹结构
- [ ] 选择顶层文件夹下载
- [ ] 验证所有子文件都被包含

### 场景 5：不同云盘类型
- [ ] 百度网盘：测试文件夹下载
- [ ] 阿里云盘：测试文件夹下载
- [ ] 普通 HTTP：测试文件夹下载

## 已知限制

1. **大文件夹**：超深层级（>5 层）的子文件可能被限制
2. **包大小**：单个 ZIP 文件大小受服务器内存限制
3. **Vercel 环境**：上传/下载超时可能是 10 分钟

## 后续改进建议

1. **进度显示**：为大文件夹打包添加进度条
2. **部分下载**：支持对文件夹内特定文件的二级选择
3. **缓存**：缓存 ZIP 以加速重复下载
4. **并行优化**：优化多个文件夹打包的并发性能
5. **命名冲突**：处理同名文件/文件夹的打包逻辑

## 安全考虑

- ✅ 所有路径都基于用户权限进行隔离
- ✅ 支持 basePath 限制
- ✅ Token 验证完整
- ✅ 无法访问文件时自动跳过（不暴露错误）
- ⚠️ 建议限制单次下载的最大文件夹数量
