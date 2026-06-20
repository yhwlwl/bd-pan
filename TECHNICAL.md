# STA-PAN 技术文档

本项目技术文档，供接手项目的开发者和 AI 阅读。涵盖完整的技术架构、API 路由、权限系统、下载体系、部署方案和数据库结构。

---

## 目录

- [1. 项目概览](#1-项目概览)
- [2. 技术栈与依赖](#2-技术栈与依赖)
- [3. 项目结构与文件地图](#3-项目结构与文件地图)
- [4. 认证体系](#4-认证体系)
- [5. 权限系统](#5-权限系统)
- [6. API 路由详细说明](#6-api-路由详细说明)
- [7. 下载体系](#7-下载体系)
- [8. 前端架构](#8-前端架构)
- [9. 环境变量](#9-环境变量)
- [10. 数据库](#10-数据库)
- [11. 部署方案](#11-部署方案)
- [12. 已知限制与改进方向](#12-已知限制与改进方向)

---

## 1. 项目概览

**STA-PAN** 是成都七中科协的百度网盘文件共享平台，基于 **Next.js 16 + React 19 + AList + Supabase** 构建。

核心架构：前端通过 Next.js API Route 调用 AList 的 REST API，AList 作为百度网盘的桥接层。管理员通过 Supabase 存储用户和配置，所有文件操作由 AList 代理转发到百度网盘。

### 核心功能

- 📂 文件浏览、搜索（目录树结构）
- ⬇️ 单文件下载（5 种方式）、批量文件夹下载（T1 ZIP / T2 逐个）
- 👁️ 在线预览（图片/视频/PDF/文本/Office/压缩包目录）
- ⬆️ 文件/文件夹上传
- 🔒 三级角色（admin / manager / guest）+ 12 项权限位
- 📋 正则文件级规则（匹配路径名/文件名）
- 📊 操作日志 + IP 访问统计
- 🚫 IP 封禁管理

---

## 2. 技术栈与依赖

| 层 | 技术 | 版本 | 用途 |
|---|---|---|---|
| 框架 | Next.js | 16.1.6 | App Router + API Routes |
| 前端库 | React | 19.2.3 | 单文件 SPA |
| CSS | Tailwind CSS | 4.x | 暗色毛玻璃主题 |
| 数据库 | Supabase (PostgreSQL) | - | 用户、设置、日志 |
| 网盘桥接 | AList | - | 百度网盘 REST API 驱动 |
| ZIP 打包 | archiver | 7.0.1 | 流式 ZIP 生成 |
| 类型 | TypeScript | 5.x | 全项目类型覆盖 |

`package.json` 核心依赖：

```json
{
  "dependencies": {
    "next": "16.1.6",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "@supabase/supabase-js": "^2.98.0",
    "archiver": "^7.0.1",
    "tailwindcss": "^4"
  }
}
```

---

## 3. 项目结构与文件地图

```
baidu-pan-alist/
├── .env.local                           # 环境变量（不提交 Git）
├── next.config.ts                       # Next.js 配置
├── package.json
├── tsconfig.json
├── CLAUDE.md                            # AI 工作指南
├── README.md                            # 用户手册
├── TECHNICAL.md                         # 本文档
│
├── src/
│   ├── app/
│   │   ├── layout.tsx                   # 根布局
│   │   ├── page.tsx                     # ★★★★★ 前端全部逻辑（~3800行）
│   │   └── api/
│   │       ├── _auth.ts                 # Token 签发/验证
│   │       ├── _auth-edge.ts            # Edge 鉴权（未使用）
│   │       ├── login/route.ts           # 登录 / 游客
│   │       ├── users/route.ts           # 用户管理（admin 专属）
│   │       ├── global-settings/route.ts # 公开配置
│   │       ├── admin-stats/route.ts     # 管理统计
│   │       ├── file-permissions/route.ts # 文件权限规则
│   │       ├── alist/route.ts           # ★ AList 代理核心
│   │       ├── alist-download/route.ts  # 单文件下载
│   │       ├── alist-upload/route.ts    # 文件上传
│   │       ├── alist-token/route.ts     # AList 登录
│   │       ├── alist-zip-preview/route.ts # ZIP 预览
│   │       ├── alist-zip-download/route.ts # ★ ZIP 打包
│   │       ├── alist-batch-list/route.ts  # T2 文件清单
│   │       ├── alist-batch-download/route.ts # 归档（备用）
│   │       ├── log-action/route.ts      # 操作日志写入
│   │       └── track/route.ts           # 访问记录写入
│   ├── lib/
│   │   └── users.ts                     # ★★★★★ 核心库
│   ├── data/
│   │   └── changelog.json               # 版本日志
│   └── types/
│       └── archiver.d.ts                # archiver 类型
└── docs/
    └── baidu-pan-alist-tech.md          # 早期文档
```

---

## 4. 认证体系

### 4.1 Token 机制

自研 Token，签名算法 HMAC-SHA256，位置 `src/app/api/_auth.ts`。

**签发 `signToken(username, role, durationHours?)`**：

1. 计算有效期 `ttl = (durationHours || 8) * 3600000`
2. 构造 payload `{ exp: Date.now() + ttl, username, role }`
3. JSON → base64url 编码 → payloadB64
4. `HMAC-SHA256(secret, payloadB64)` → hex 签名
5. 拼接 `{payloadB64}.{hex签名}`

**验证 `verifyToken(authHeader)`**：

1. 从 `Bearer xxx` 分割取出 token
2. 按 `.` 分割为 payloadB64 + sig
3. 重新 HMAC 验签 → 解码 payload JSON
4. 检查 `Date.now() > exp`，过期返回 null
5. 返回 `{ username, role }`

签名密钥来自环境变量 `ADMIN_TOKEN_SECRET`，默认 `'default-secret-change-me'`（务必修改）。

### 4.2 角色

```typescript
type Role = 'admin' | 'manager' | 'guest'
```

### 4.3 登录流程

```
POST /api/login { username, password }
  → findUser() 从 Supabase bdpan_users 验证密码
  → signToken(role="admin"|"manager")
  → 返回 { token, role, username, permissions }

POST /api/login { guest: true }
  → check enableGuestMode
  → signToken(role="guest")
  → 返回 { token, role="guest", username="guest", permissions }
```

IP 封禁检查在登录前：`checkIpBanned(clientIp)`。

---

## 5. 权限系统

### 5.1 全局权限位（`UserPermissions`）

```typescript
interface UserPermissions {
    view: boolean;         // 浏览子目录
    search: boolean;       // 搜索文件
    download: boolean;     // 下载文件
    upload: boolean;       // 上传文件
    delete: boolean;       // 删除文件
    rename: boolean;       // 重命名
    preview: boolean;      // 在线预览
    setting: boolean;      // 自定义 AList 连接
    controlFile?: boolean; // 管理文件权限规则
    basePath?: string;     // 用户根目录映射（虚根）

    // 日志查看权限（4 个独立开关，用于非 admin 查看管理面板）
    viewStats?: boolean;        // 实时数据审计
    viewActionLogs?: boolean;   // 操作日志
    viewIpStats?: boolean;      // IP 统计（只读）
    viewDownloadLogs?: boolean; // 下载明细
}
```

**默认值**：

| 权限位 | admin | manager | guest |
|--------|-------|---------|-------|
| view/search/download | ✅ | ✅ | ✅ |
| upload | ✅ | ✅ | ❌ |
| delete/rename | ✅ | ✅ | ❌ |
| preview | ✅ | ✅ | ✅ |
| setting | ✅ | ❌ | ❌ |
| controlFile | ✅ | ✅ | ❌ |
| viewStats/viewActionLogs/viewIpStats/viewDownloadLogs | ✅（但绕过检查）| ❌ | ❌ |

admin 角色直接返回全部权限，**不经过文件权限规则检查**。manager/guest 的权限由 `getUserPermissions()` 从 Supabase 设置中读取，可在管理面板修改。

### 5.2 文件级权限规则

```typescript
interface FilePermissionRule {
    id: string;
    path: string;                    // 路径或正则表达式
    pathType: 'file' | 'dir' | 'regex';
    regexScope?: 'name' | 'path';   // 仅 regex 模式有效
    groupName?: string;              // 分组标签
    users: string[];                 // 适用用户
    deny: Partial<Record<FilePermissionAction, boolean>>;
}
```

**匹配函数 `ruleMatchesTarget(rule, targetPath)`** （`lib/users.ts:91-109`）：

```
rule.pathType === 'file':
  → 精确匹配: normalizePath(target) === normalizePath(rule.path)

rule.pathType === 'dir':
  → 前缀匹配: target === rulePath || target.startsWith(rulePath + '/')

rule.pathType === 'regex':
  → 正则匹配:
    if regexScope === 'name':
      → 提取 target 的文件名部分（split('/').pop()）做正则测试
    else:
      → 完整路径做正则测试
    new RegExp(rule.path, 'i').test(testTarget)
    （无效正则返回 false）
```

**生效链路**：

```
文件权限规则存储在 Supabase
  → alist/route.ts 列表时逐文件调用 getEffectivePermissionsForPathCached
    → 计算每个 item.perms（download/preview/delete/rename/upload）
    → 附加到文件列表返回给前端
  → alist-download/route.ts 下载前单独检查
  → alist-zip-download/route.ts 打包前预扫描过滤
  → page.tsx 前端 UI 拦截
```

### 5.3 IP 封禁

`lib/users.ts` 读取 `settings.bannedIps`（`Record<string, number>`），key 为 IP 地址，value 为封禁到期时间戳。

`checkIpBanned(ip)` 在所有 API 路由入口调用：

```typescript
async function checkIpBanned(ip: string): Promise<boolean> {
    if (!supabase) return false;
    const settings = await getSettings();
    const now = Date.now();
    const bans = settings.bannedIps || {};
    // 清理过期封禁
    for (const [ipKey, expiry] of Object.entries(bans)) {
        if (expiry <= now) delete bans[ipKey];
    }
    await updateSettings({ bannedIps: bans });
    return bans[ip] && bans[ip] > now;
}
```

---

## 6. API 路由详细说明

所有路由均为 Next.js App Router，路径前缀 `/api`，默认 `force-dynamic`。

### 6.1 AList 代理 — `/api/alist`

**方法**：POST | **鉴权**：Bearer Token

核心路由，封装了与 AList 的大部分通信。

**请求体**：

```json
{ "action": "list|get|search|mkdir|remove|rename|list_archive|archive",
  "path": "/sta/folder",
  "name": "file.txt", "names": ["a.txt", "b.txt"],
  "newName": "newname.txt", "dir_name": "newfolder",
  "parent": "/sta", "keywords": "搜索词", "scope": 0|1 }
```

**各 action 详解**：

| action | AList API | 权限检查 | 附加处理 |
|--------|-----------|----------|----------|
| `list` | POST `/api/fs/list` | view/download/preview | **权限过滤**：逐文件调用 `getEffectivePermissionsForPathCached`，无权限文件移除。**basePath 剥离**：可见路径去掉用户虚根前缀。**附加 `current_perms`**：当前目录的 delete/rename/upload/search 权限 |
| `get` | POST `/api/fs/get` | view/download/preview | 返回文件原始信息 |
| `search` | POST `/api/fs/search` | search | **权限过滤**：搜索结果按 filePermissionRules 过滤 |
| `mkdir` | POST `/api/fs/mkdir` | upload | - |
| `remove` | POST `/api/fs/remove` | delete | 额外检查每个子路径的 delete 权限 |
| `rename` | POST `/api/fs/rename` | rename | - |
| `list_archive` | POST `/api/fs/other` | - | 查看压缩包目录 |
| `archive` | POST `/api/fs/other` | - | **未生效**，调用 alist archive 会报错 |

**自定义配置**：前端可选传 `x-alist-url`、`x-alist-username`、`x-alist-password` 头覆盖全局 AList 连接（⚙️ 设置功能）。同时 `ALIST_CUSTOM_CONFIG` 在 localStorage 中持久化。

### 6.2 单文件下载 — `/api/alist-download`

**方法**：GET | **鉴权**：token 参数或 Bearer header

**参数**：`?path=xxx&token=xxx&preview=1&c=xxx`

| 参数 | 说明 |
|------|------|
| `path` | 文件路径 |
| `token` | 用户 JWT（查询参数） |
| `preview` | 1 表示预览（只返回内容），不设则触发下载 |
| `c` | base64 编码的自定义配置 |

**权限**：
- `preview=1` && `pathPerms.preview === false` → 403 拒绝
- `preview=0` && `pathPerms.download === false` → 403 拒绝

**下载逻辑**：
1. 读取 AList 文件信息（`/api/fs/get`，3 次重试）
2. 若 `raw_url` 包含 `baidupcs` 或 `baidu.com` → 添加 `User-Agent: pan.baidu.com` 从百度 CDN 下载
3. 否则 → 从 AList `/p/` 端点下载（不额外处理 UA）

### 6.3 文件上传 — `/api/alist-upload`

**方法**：PUT | **鉴权**：Bearer Token

**Header**：`File-Path`（URL 编码的目标路径）、`Authorization`、`Content-Type`、`Content-Length`

**权限**：`upload`

**流程**：
1. 获取 AList Token
2. 解析 `File-Path`，校验 basePath 和文件权限
3. 调用 AList `/api/fs/put` 上传

### 6.4 ZIP 打包下载 — `/api/alist-zip-download`

**方法**：GET | **鉴权**：token | **导出**：`maxDuration = 300`（Vercel Pro 需要）

**参数**：`?paths=["/folder1","/folder2"]&token=xxx`

**核心流程**：

```
Phase 1 — 预扫描:
  for each path:
    get（文件或目录判断）
    if 目录:
      递归 list 所有子文件（getAllFilesInDir + sign）
      逐文件过 getEffectivePermissionsForPath
      被禁文件跳过（totalSkipped++）
    if 文件:
      单文件加入列表
    响应头 X-Skipped-Files = totalSkipped

Phase 2 — 流式打包:
  archiver('zip', { level: 0 })  // 不压缩，只打包
  6 个并发下载每个文件（3 层降级）
  ReadableStream → 浏览器
```

**三层降级**：

| 层级 | 策略 | 实现 |
|------|------|------|
| T1： `/p/` 直链 | `fetch(ECS/p/path?sign=sign, {Authorization})` | 最快，AList 本机 |
| T2： 百度 CDN | `get → raw_url → fetch(raw_url, {UA: 'pan.baidu.com'})` | 跨代理降级 |
| T3： 跳过 | 前两者均失败 | 统计入 `totalFailed` |

控制台输出：`[ZIP] 完成 → T1直链:42 T2降级:3 T3保底:2 失败:0`

### 6.5 ZIP 预览 — `/api/alist-zip-preview`

**方法**：GET

返回目录文件计数的轻量 API：

```json
{ "dirs": [{"name": "未来梦", "fileCount": 47}],
  "message": "[ZIP] 开始生成 ZIP 文件..." }
```

前端用于显示 "X 个目录，共 Y 个文件"。

### 6.6 批量文件清单 — `/api/alist-batch-list`

**方法**：GET

T2 逐个下载使用，返回文件直链清单：

```json
{ "files": [
    {"name": "a.pdf", "path": "/sta/a.pdf", "sign": "eyJleH...",
     "size": 1048576, "relativePath": "未来梦/a.pdf"}
  ],
  "totalFiles": 47, "totalSize": 10485760, "skipped": 3 }
```

每个文件已过权限检查（`download === false` 跳过）。

### 6.7 归档（备用）— `/api/alist-batch-download`

**状态**：未生效。原计划调用 AList `${url}/api/fs/other {method:'archive', paths:[...]}` 让 AList 服务器端打包，经测试 AList 此功能不稳定，代码保留备用。

### 6.8 登录 — `/api/login`

**方法**：POST | **无鉴权**（本身即登录）

```json
// 常规登录
{ "username": "admin", "password": "xxx" }
// 游客登录
{ "guest": true }
```

1. 检查 `checkIpBanned` → 封禁 IP 拒绝
2. 读取全局配置 `sessionDurationHours`（默认 8h）
3. 调用 `signToken(role, durationHours)`
4. 返回 `{ token, role, username, permissions }`

### 6.9 用户管理 — `/api/users`

**方法**：GET / POST | **鉴权**：仅 admin

| action | 参数 | 说明 |
|--------|------|------|
| GET | - | 返回 `{ users, settings }` |
| `add` | `{ username, password, role }` | 添加用户 |
| `remove` | `{ username }` | 删除用户 |
| `updateRole` | `{ username, role }` | 修改角色 |
| `updateSettings` | `{ settings }` | 更新全局设置 |
| `changeAdminPassword` | `{ password }` | 修改管理员密码 |
| `updatePermissions` | `{ username, permissions }` | 更新用户权限位 |

### 6.10 全局设置（公开）— `/api/global-settings`

**方法**：GET | **无鉴权**

公开配置接口，返回下载模式、公告等。无敏感信息。

### 6.11 管理统计 — `/api/admin-stats`

**方法**：GET | **鉴权**：admin 或日志查看权限

**鉴权逻辑**：

```typescript
if (user.role !== 'admin') {
    const perms = await getUserPermissions(user.username, user.role);
    if (!perms.viewStats && !perms.viewActionLogs && !perms.viewIpStats && !perms.viewDownloadLogs) {
        return 401;
    }
}
```

**返回内容**：
- `totalPanVisits` — 总访问次数
- `past24hDownloads` / `totalDownloads` — 下载次数
- `channelStats` — `{ ecs: { past24h, total, logs[] }, cf: ..., raw: ..., vercel: ..., direct302: ..., other: ... }`
- `recentActions` — 全量操作日志（非 admin 过滤 admin 操作）
- `topIps` — IP 排行（前 30）
- `viewLogs` / `allDownloadLogs` — 详细记录

### 6.12 文件权限规则 — `/api/file-permissions`

**方法**：GET / POST | **鉴权**：`controlFile` 权限

| 操作 | 说明 |
|------|------|
| GET | 返回 `{ users, rules }`。manager 只能看到自己有权管理 |
| POST `{ action: 'preview', pattern, scopePath, regexScope }` | **正则预览**：遍历目录树，用正则过滤，返回匹配的文件列表 |
| POST `{ rules: [...] }` | **保存规则**：更新/创建/删除权限规则 |

**正则预览**调用 AList `/api/fs/search`（需 alist 已建搜索索引），或降级遍历目录树。

### 6.13 操作日志 — `/api/log-action`

**方法**：POST

**请求体**：`{ username, action_type, action_item }`

**处理**：
1. 提取客户端 IP（`x-forwarded-for`）
2. 通过 `ip-api.com` 查询 IP 定位（国家/省份/城市）
3. 插入 Supabase `bdpan_action_logs`

### 6.14 访问追踪 — `/api/track`

**方法**：POST

**请求体**：`{ username, time, ip, country, region, city, device, source }`

插入 Supabase `view_logs`，来源固定为 `'pan'`。

---

## 7. 下载体系

### 7.1 单文件下载（5 种方式）

百度网盘文件弹出「百度网盘文件下载」对话框，5 个按钮：

| # | 名称 | 按钮色 | 技术路径 | 特点 |
|---|------|--------|----------|------|
| ① | 阿里云 ECS | 粉色 `g-pink` | `/api/alist-download` → Vercel 代理 → UA 注入 | 手机首选，自动处理 UA |
| ② | Cloudflare | 蓝色 `g-blue` | `fetchAlist get` → `cf.ryantan.fun/?url=raw_url` | 海外加速，不耗服务器流量 |
| ③ | 复制直链 | 绿色 `g-emerald` | `fetchAlist get` → clipboard `raw_url` | PC+IDM 极速 |
| ④ | Vercel 中转 | 粉色 `text-pink` | `/api/alist-download`（类似 ①） | 备用 |
| ⑤ | 直链下载 | 青色 `g-cyan` | `window.open(alistBase/p/path?sign=sign)` | 同步 URL，不等待后端，不拦截 |

**前端权限检查**：

```typescript
// openAlistItem() - 点击文件
if (!canDownload) → 拒绝
if (item.perms.download === false) → 拒绝
if (item.perms.preview === false && 是预览) → 拒绝

// 预览弹窗下载按钮
if (previewItemMeta.perms.download === false) → 拒绝, 关闭预览
```

### 7.2 批量下载

选中文件/文件夹 → 点击「批量下载」→ 弹出选择弹窗：

**T1 打包下载（ZIP）**：
1. `GET /api/alist-zip-preview` → 获取文件计数
2. `GET /api/alist-zip-download` → 流式 ZIP

**T2 逐个下载（直链）**：
1. `GET /api/alist-batch-list` → 获取文件清单
2. 前端逐个创建 `<a>` 标签触发下载
3. 桌面间隔 600ms，移动端 2000ms
4. 显示进度条 `⏳ 正在下载 5/47...`

### 7.3 下载日志

`logUserAction` 函数携带 `status` 参数：

| status | action_type 后缀 | 使用场景 |
|--------|-----------------|----------|
| `success` | 无后缀 | 正常触发下载 |
| `blocked` | ` - 被拦截` | 权限拦截 |
| `failed` | ` - 失败` | 接口异常 |

所有下载入口（5 个按钮 + 批量 T1/T2）均在触发前记录日志。

### 7.4 ZIP 安全漏洞修复

**漏洞**：通过打包下载上级目录可绕过子文件权限规则。

**修复**：`alist-zip-download` 的预扫描阶段对每个子文件执行 `getEffectivePermissionsForPath`，被禁文件跳过。控制台日志 `[ZIP] secret: 跳过 3 个被禁止下载的文件`。前端通过 `X-Skipped-Files` 响应头显示 `⚠️ 已触发 X 个文件下载，Y 个因权限策略跳过`。

---

## 8. 前端架构

### 8.1 架构说明

`page.tsx` 是 **单体 SPA 组件**，~3800 行，无 Next.js 页面路由分割。全部 UI 通过 React 条件渲染切换。

### 8.2 状态管理

约 50+ 个 `useState`，分类如下：

| 类别 | 状态数 | 核心状态 |
|------|--------|----------|
| 认证 | 8 | `userToken, userRole, username, userPerms` （均持久化 localStorage） |
| 登录表单 | 3 | `loginUsername, loginPassword, authError` |
| 文件浏览 | 12 | `alistPath, alistFiles, alistLoading, alistSelected` |
| 搜索 | 6 | `alistSearchKeyword, alistSearchScope, alistSearchResults` |
| 上传 | 3 | `alistUploadFiles, alistUploading, uploadProgress` |
| 预览 | 6 | `previewItemMeta, previewFile, previewText, previewLoading` |
| 下载 | 10 | `alistDownloadModal, alistCopyLinkModal, batchModeModal, t2Progress` |
| 管理 | 15+ | `showAdminPanel, adminUsers, adminSettings, adminStats` |
| 权限 | 8+ | `showFilePermPanel, filePermRules, filePermDraft, regexPreview` |
| UI | 6 | `theme, alistMsg, showManual, showChangelog` |

### 8.3 关键函数

| 函数 | 行号 | 作用 |
|------|------|------|
| `fetchAlist(body, headers?)` | 352 | 通用 AList 调用，注入认证+自定义配置 |
| `getAlistBase()` | 356 | 获取当前 AList 地址 |
| `alistListDir(path)` | 574 | 列出目录，重置搜索状态 |
| `alistSearchFast()` | 710 | 多关键词搜索+去重+排序 |
| `openAlistItem(item, path, provider)` | 881 | **文件点击决策中心**：权限检查 → 预览/下载 |
| `alistProxyDownload(path, name)` | 909 | 代理下载（走 `/api/alist-download`）|
| `alistDirectDownload(path, sign)` | 905 | 直链下载（本地 a 标签）|
| `logUserAction(type, item, status, username?)` | 342 | 操作日志上报 |
| `alistBatchDownload()` | 992 | 批量下载入口 |
| `alistBatchDownloadFolders(folders)` | 1047 | T1 ZIP 打包 |
| `alistBatchDownloadT2(folders, files)` | 1030 | T2 逐个下载 |
| `fetchAdminData()` | 1355 | 拉管理面板数据 |
| `submitFilePermissionDraft()` | 1472 | 保存文件权限规则 |

### 8.4 文件操作决策树（`openAlistItem`）

```
点击文件
├── 权限: canDownload === false → 拒绝
├── 权限: item.perms.download === false → 拒绝
├── isBaidu → 弹出 5 选 1 下载对话框
├── isAliyun → 直接代理下载
├── 可预览 → openPreview（下载按钮在预览弹窗内）
└── 其他 → 直接下载
```

### 8.5 组件树

```
<Home>
├── 登录页（未认证时：用户名/密码 + 游客按钮）
└── 主应用（已认证）
    ├── 头部 nav（角色/用户名/主题/管理/日志/权限/设置/说明/退出）
    ├── Toast 消息 ✅❌⚠️（30秒自动关闭 + ✕手动）
    │
    ├── 文件浏览主区域
    │   ├── 路径导航 + 工具栏
    │   │   ├── 搜索框（本地/远程/快速 模式）
    │   │   ├── 新建文件夹 / 上传 / 全选 / 批量下载
    │   │   └── 刷新
    │   ├── 文件列表（图标 + 名称 + 大小 + 时间 + 操作按钮）
    │   └── 拖拽上传浮层
    │
    ├── 5 选 1 下载弹窗
    ├── T1/T2 批量下载选择弹窗
    ├── T2 底部进度条
    ├── 预览弹窗（图片/视频/PDF/文本/Office）
    ├── 管理面板
    │   ├── 数据审计（按渠道下载量统计）
    │   ├── IP 访问统计 + 封禁（admin 专属）
    │   ├── 操作日志（带颜色标签 + 筛选）
    │   ├── 安全设置（admin 专属）
    │   ├── 全局设置（admin 专属）
    │   └── 用户列表（admin 专属）
    ├── 文件权限面板
    │   ├── 规则编辑（路径/正则 + 用户 + 7 项权限）
    │   └── 已有规则列表
    └── 设置 / 更新日志 / 使用手册 弹窗
```

### 8.6 颜色主题

支持暗色/亮色模式，通过 `theme: 'dark' | 'light'` 状态控制，持久化 localStorage。

CSS 变量定义在 `layout.tsx` ??? 实际上在 `page.tsx` 的 `<style>` 标签和 Tailwind CSS 类中。

---

## 9. 环境变量

复制 `.env.example` 到 `.env.local`（不存在，需手动创建）：

```bash
# ====== AList ======
NEXT_PUBLIC_ALIST_URL=https://pan.tantantan.tech:5245
NEXT_PUBLIC_ALIST_URL_FALLBACK=https://frp-gap.com:37492
ALIST_USERNAME=admin
ALIST_PASSWORD=xxx
ALIST_USERNAME_FALLBACK=
ALIST_PASSWORD_FALLBACK=

# ====== Supabase ======
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# ====== Auth ======
ADMIN_TOKEN_SECRET=<random-string-at-least-32-chars>

# ====== Node (ECS only) ======
NODE_OPTIONS=--max-old-space-size=1024
```

---

## 10. 数据库

### 10.1 `bdpan_users` — 用户

| 列 | 类型 | 说明 |
|---|---|---|
| id | int8 (PK) | 自增 |
| username | text | 唯一用户名 |
| password | text | 明文密码 |
| role | text | `admin` / `manager` / `guest` |

初始化需要手动插入 admin 用户。

### 10.2 `bdpan_settings` — 全局设置

| 列 | 类型 | 说明 |
|---|---|---|
| key | text (PK) | 固定 `'global'` |
| value | jsonb | 完整 `GlobalSettings` 对象 |

value 结构示例：

```json
{
  "enableGuestMode": true,
  "permissions": { "username": { "view": true, "download": false } },
  "filePermissionRules": [{
    "id": "rule_1",
    "path": "密码|未来梦",
    "pathType": "regex",
    "regexScope": "path",
    "users": ["guest"],
    "deny": { "download": true, "preview": true }
  }],
  "downloadChannel": "ecs",
  "downloadModes": {
    "ecs": "enabled", "cf": "enabled",
    "raw": "enabled", "vercel": "disabled",
    "direct302": "enabled"
  },
  "bannedIps": { "1.2.3.4": 1781300000000 },
  "hideAlistButton": true,
  "announcement": "公告内容",
  "sessionDurationHours": 8
}
```

### 10.3 `bdpan_action_logs` — 操作日志

| 列 | 类型 | 说明 |
|---|---|---|
| id | int8 (PK) | 自增 |
| username | text | 操作者 |
| action_type | text | 如 `"下载 - ECS - 被拦截"` |
| action_item | text | 操作对象路径 |
| ip | text | 操作者 IP |
| location | text | IP 定位（国家 省份 城市） |
| log_text | text | 完整描述 |
| created_at | timestamptz | 默认 `now()` |

`action_type` 命名：

| 状态 | 格式 | 示例 |
|------|------|------|
| 成功 | `{动作}` | `下载 - ECS` |
| 被权限拦截 | `{动作} - 被拦截` | `下载 - ECS - 被拦截` |
| 操作失败 | `{动作} - 失败` | `删除 - 失败` |

### 10.4 `view_logs` — 访问记录

| 列 | 类型 | 说明 |
|---|---|---|
| id | int8 (PK) | 自增 |
| ip_address | text | 访客 IP |
| username | text | 已登录则记录用户名 |
| user_agent | text | 浏览器 UA |
| country / region / city | text | 通过 ip-api.com 查询 |
| page_source | text | 固定 `'pan'` |
| visit_time | timestamptz | 默认 `now()` |

---

## 11. 外部平台说明

每个平台的本项目配置内容和管理职责。

### 11.1 GitHub

- **仓库地址**：`https://github.com/stacdqz/bd-pan`
- **分支策略**：仅有 `main` 分支，直接推送

**需维护的文件**：
- 代码本身
- `.gitignore`：包括 `.env.local`、`node_modules/`、`.next/`
- 无 Actions CI/CD（部署通过 Vercel 自动触发）

**工作流**：

```bash
git add .
git commit -m "feat: xxx"
git push
# Vercel 自动构建部署到 pan.cdqzsta.tech
```

**注意事项**：
- 国内网络可能无法直接 `git push` 到 GitHub（超时/断连），需使用代理

```bash
# 设置代理
git config --global http.proxy http://127.0.0.1:你的代理端口
git push
# 取消代理
git config --global --unset http.proxy
```

- 或用 SSH 方式（需配置 SSH key）：

```bash
git remote set-url origin git@github.com:stacdqz/bd-pan.git
```

### 11.2 Supabase

- **管理地址**：`https://supabase.com/dashboard/project/xxxxx`
- **用途**：认证无（自研 Token），仅用数据库

**项目配置**：

| 项 | 说明 |
|----|------|
| 数据库密码 | 项目创建时设定 |
| `URL` | `https://xxx.supabase.co` |
| `ANON_KEY` | 设置 → API → Project API keys |
| 区域 | 建议选新加坡（靠近国内，延迟较低） |

**表结构概览**（细节见 [第 10 章](#10-数据库)）：

| 表名 | 用途 | 维护方式 |
|------|------|----------|
| `bdpan_users` | 用户账号 | 管理面板添加/删除，或手动 SQL |
| `bdpan_settings` | 全局设置（单行） | 管理面板修改 |
| `bdpan_action_logs` | 操作日志 | 自动写入，定期清理 |
| `view_logs` | 访问记录 | 自动写入，定期清理 |

**初始化步骤**（新项目）：
1. 创建 Supabase 项目
2. 在 SQL Editor 中执行以下建表语句：

```sql
CREATE TABLE bdpan_users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username text NOT NULL,
    password text NOT NULL,
    role text NOT NULL
);
INSERT INTO bdpan_users (username, password, role)
VALUES ('admin', '你的密码', 'admin');

CREATE TABLE bdpan_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL
);
INSERT INTO bdpan_settings (key, value)
VALUES ('global', '{}');

CREATE TABLE bdpan_action_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username text NOT NULL,
    action_type text NOT NULL,
    action_item text NOT NULL,
    ip text,
    location text,
    log_text text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE view_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ip_address text,
    username text,
    user_agent text,
    country text, region text, city text,
    page_source text,
    visit_time timestamptz DEFAULT now()
);
```

**安全配置**（重要）：
- 在 Supabase Dashboard → Authentication → Policies 中，**必须禁用 RLS**（Row Level Security）或配置允许所有访问的策略（因为代码直接通过 `ANON_KEY` 调用 API，不经过 Supabase Auth）

```
RLS Status: Disabled  ✓
```

- 或在 `SQL Editor` 中执行：

```sql
ALTER TABLE bdpan_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE bdpan_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE bdpan_action_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE view_logs DISABLE ROW LEVEL SECURITY;
```

### 11.3 AList 服务

- **管理地址**：`https://pan.tantantan.tech:5245`
- **部署位置**：成都 ECS，公网 5245 端口
- **用途**：百度网盘 REST API 驱动，为 Next.js 提供文件操作能力

**AList 管理配置**：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 站点 URL | `https://pan.tantantan.tech:5245` | 必须与 `NEXT_PUBLIC_ALIST_URL` 一致 |
| 用户名 | `admin` | 对应环境变量 `ALIST_USERNAME` |
| 密码 | 在宝塔/AList 设置 | 对应环境变量 `ALIST_PASSWORD` |
| 打包下载 | 启用（默认） | 用于 /api/fs/other method=archive |
| 目录 | /sta | 百度网盘驱动的根目录指向 STA 的 `/sta` 路径 |

**存储驱动**：

```yaml
# AList 管理面板 → 存储 → 百度网盘
挂载路径: /sta
驱动: 百度网盘
根文件夹 ID: /     # 或 STA 的百度盘根目录 ID
刷新令牌: xxx      # 通过百度 OAuth 获取
```

**密码管理（宝塔）**：
- AList 部署在 ECS，通过宝塔的 Docker 或直接进程管理
- 密码在 AList admin 后台设置
- 可通过 SSH `cd /path/to/alist && ./alist admin` 重置

**网络配置**：
- `Nginx` 反代 `:5245` → 对外域名 `pan.tantantan.tech:5245`
- SSL 由宝塔自动申请 Let's Encrypt

### 11.4 阿里云 ECS

- **管理地址**：`https://ecs.console.aliyun.com`
- **实例规格**：2C2G（2vCPU, 2GB Memory）
- **区域**：成都
- **操作系统**：Ubuntu / CentOS（已装宝塔面板）
- **用途**：运行 AList + 可选的 Next.js 部署

**宝塔面板**：

| 项 | 说明 |
|----|------|
| 入口 | `https://ECS公网IP:8888` |
| 账户 | 初始安装时设定 |
| 已安装 | Nginx, PM2 Manager, Let's Encrypt SSL |

**端口配置**（安全组/防火墙必须放行）：

| 端口 | 用途 | 对内 | 对外 |
|------|------|------|------|
| 80 | HTTP | ✅ | ✅（自动跳转 HTTPS）|
| 443 | HTTPS | ✅ | ✅ |
| 5245 | AList | ✅ | ✅ |
| 3000 | Next.js | ✅ | ❌（通过 Nginx 反代）|
| 8888 | 宝塔面板 | ✅ | 按需（建议关闭公网）|

**域名解析（DNS）**：

| 域名 | 类型 | 记录值 | TTL |
|------|------|--------|-----|
| `pan.tantantan.tech` | A | ECS 公网 IP | 600 |
| `pan.tantantan.tech` | AAAA | -（IPv6 无需配置）| - |
| `test.cdqzsta.tech` | A | ECS 公网 IP（需备案）| 600 |

**备案状态**：
- `tantantan.tech`：**已备案**（可通过 Let's Encrypt 申请 SSL）
- `cdqzsta.tech`：**未备案**，国内 ECS 部署将无法访问

### 11.5 域名

**域名清单**：

| 域名 | 注册商 | 备案 | 指向 | 用途 |
|------|--------|------|------|------|
| `tantantan.tech` | - | ✅ 已备案 | ECS | AList 服务 |
| `cdqzsta.tech` | - | ❌ 未备案 | Vercel / ECS | 前端 |

**DNS 管理**：
- 在各自的域名注册商控制台管理解析
- 指向 Vercel 时用 CNAME 记录（`cname.vercel-dns.com`）
- 指向 ECS 时用 A 记录（ECS 公网 IP）

### 11.6 Vercel

- **管理地址**：`https://vercel.com/dashboard`
- **项目名**：`bd-pan`（GitHub 仓库同名）
- **框架**：Next.js（自动检测）
- **部署触发**：`git push` 到 GitHub main 分支自动触发

**项目配置**：

| 配置项 | 值 |
|--------|-----|
| Root Directory | `./` |
| Build Command | `npm run build` |
| Output Directory | `.next` |
| Node.js Version | 20.x (Latest) |
| Region | `iad1` (Washington D.C., USA) |

**Environment Variables**：在 Vercel Dashboard → Settings → Environment Variables 设置（`.env.local` 的全部内容）。

**Vercel 免费版限制**：

| 限制 | 值 | 对本项目的影响 |
|------|-----|---------------|
| Serverless 执行时间 | 10s | ZIP 大文件夹会超时 |
| Serverless 响应体 | 4.5MB | 大文件下载/包上传会失败 |
| 边缘节点位置 | 全球（主要海外） | 到国内 ECS 延迟高 |
| 带宽 | 无限制 | 但个人版有月度配额 |
| 团队成员 | 1 人（个人版） | 无法多人协作 |

**升级到 Pro（$20/月）可解除**：

| 限制 | Pro 值 |
|------|--------|
| 执行时间 | 300s（已设置 `maxDuration = 300`）|
| 响应体 | 4.5MB（不变，Vercel 架构限制）|
| 团队 | 可添加成员 |

**部署后检查**：
1. Vercel Dashboard → 选择项目 → Deployments
2. 确认最新部署状态为 `Ready`
3. 访问 `https://bd-pan.vercel.app` 和自定义域名 `https://pan.cdqzsta.tech`

---

## 12. 部署方案

### 11.1 Vercel（当前生产）

1. Fork/Clone 项目到 GitHub
2. Vercel 导入 `stacdqz/bd-pan`
3. 设置环境变量
4. 自动部署

Vercel 配置：

```json
{
  "functions": {
    "src/app/api/alist-zip-download/route.ts": {
      "maxDuration": 300
    }
  }
}
```

**Vercel 免费版限制**（需注意）：
- 最大执行时间 10s（Pro 300s）
- 响应体 4.5MB
- 海外节点到国内 ECS 延迟高

### 11.2 自有 ECS 部署（推荐，解决速度问题）

**前置条件**：
- ECS 2C2G+，宝塔面板
- 已安装 Nginx、PM2 管理器
- 已备案域名（`test.cdqzsta.tech`）

**步骤**：

```bash
# 1. 拉取代码
cd /www/wwwroot
git clone https://github.com/stacdqz/bd-pan.git
cd bd-pan
npm install

# 2. 环境变量
# 创建 /www/wwwroot/bd-pan/.env.local（内容见第 9 章）

# 3. 加速 AList 内网访问（关键）
echo "127.0.0.1 pan.tantantan.tech" >> /etc/hosts

# 4. 构建
npm run build

# 5. PM2 配置
# 宝塔 → PM2 管理器 → 添加项目
#  启动文件: /www/wwwroot/bd-pan/node_modules/.bin/next
#  运行参数: start -p 3000
#  名称: bdpan

# 6. Nginx 反代
server {
    listen 443 ssl;
    server_name test.cdqzsta.tech;
    ssl_certificate /xxx/fullchain.pem;
    ssl_certificate_key /xxx/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

**更新**：

```bash
cd /www/wwwroot/bd-pan
git pull
npm run build       # 需要安装新依赖时才 npm install
pm2 restart bdpan
```

### 11.3 域名方案

| 域名 | 指向 | 用途 |
|------|------|------|
| `pan.cdqzsta.tech` | Vercel | 当前生产，海外 | 
| `pan.tantantan.tech` | ECS:5245 | AList 服务 |
| `test.cdqzsta.tech` | ECS:3000 | Next.js ECS 部署 |

---

## 13. 已知限制与改进方向

| # | 问题 | 影响 | 改进方向 |
|---|------|------|----------|
| 1 | Vercel 免费版 10s 超时 | ZIP 大文件夹打包失败 | 迁移至 ECS |
| 2 | Vercel 4.5MB 载荷限制 | 大文件代理下载失败 | 迁移至 ECS |
| 3 | 海外→国内延迟 | ZIP 速度极慢 | 迁移至 ECS（alist 同机） |
| 5 | alist archive API 无法使用 | 不能服务器端打包 | 代码保留备用 |
| 6 | `page.tsx` 3800 行单体 | 维护困难、diff 冲突 | 拆分为组件 |
| 7 | 无自动化测试 | 人工回归 | 加入 Playwright E2E |
| 8 | 并发限制 6 | 大文件夹 ZIP 慢 | ECS 可调大到 10+ |
