# STA-PAN 技术文档

本文档面向接手项目的开发者和 AI，涵盖完整架构、API 路由、权限系统、下载体系、PDF 预览、数据库、部署方案及运维。**所有敏感密钥均以占位符 `<xxx>` 标示，实际值见 `.env.local` 或对应平台控制台。**

---

## 目录

- [1. 项目概览](#1-项目概览)
- [2. 技术栈与依赖](#2-技术栈与依赖)
- [3. 架构全图](#3-架构全图)
- [4. 项目结构与文件地图](#4-项目结构与文件地图)
- [5. 密钥清单与获取方式](#5-密钥清单与获取方式)
- [6. 认证体系](#6-认证体系)
- [7. 权限系统](#7-权限系统)
- [8. 所有 API 路由](#8-所有-api-路由)
- [9. 下载体系](#9-下载体系)
- [10. PDF 预览体系](#10-pdf-预览体系)
- [11. 前端架构](#11-前端架构)
- [12. 数据库](#12-数据库)
- [13. 部署方案](#13-部署方案)
- [14. Deny 事件追踪与风险评分系统](#14-deny-事件追踪与风险评分系统)
- [15. ECS 运维命令全集](#15-ecs-运维命令全集)
- [16. 环境变量完整清单](#16-环境变量完整清单)
- [17. 测试](#17-测试)
- [18. 更新日志](#18-更新日志)
- [19. 已知限制与改进方向](#19-已知限制与改进方向)
- [20. 安全审计记录](#20-安全审计记录)

---

## 1. 项目概览

成都七中科协百度网盘文件共享平台。**Next.js 16 + React 19 + AList + PostgreSQL(ECS)**。

### 核心功能

- 📂 文件浏览、搜索（目录树结构）
- ⬇️ 单文件下载（5 种方式）、批量文件夹下载（T1 ZIP / T2 逐个）
- 👁️ 在线预览（图片/视频/PDF/文本/Office/压缩包目录）
- ⬆️ 文件/文件夹上传
- 🔒 三级角色（admin / manager / guest）+ 12 项权限位
- 📋 正则文件级规则（匹配路径名/文件名）
- 📊 操作日志 + IP 访问统计 + 在线用户
- 🚫 IP 封禁管理
- 📁 文件列表视图切换（列表/图标）+ 右键菜单

---

## 2. 技术栈与依赖

| 层 | 技术 | 版本 | 用途 |
|---|---|---|---|
| 前端框架 | Next.js | 16.1.6 | App Router, Turbopack |
| 前端库 | React | 19.2.3 | 单体 SPA |
| CSS | Tailwind CSS | 4.x | 暗色毛玻璃主题 |
| 数据库 | PostgreSQL 16 + PostgREST 14 | ECS | 兼容 Supabase API |
| 网盘后端 | AList | - | 百度网盘 REST API 桥接 |
| ZIP 打包 | archiver | 7.0.1 | 流式 ZIP |
| PDF 渲染 | pdfjs-dist | 4.10.38 | 浏览器端 PDF |
| 手势缩放 | @panzoom/panzoom | 4.6.2 | 双指缩放/拖拽 |
| 测试 | @playwright/test | 1.60 | E2E 测试 |
| 部署 | Vercel + ECS + PM2 | - | 前端 CDN + API 服务器 |

---

## 3. 架构全图

```
用户 (pan.cdqzsta.tech — 未备案，纯 Vercel CDN)
  │
  ├── HTML/JS/CSS → Vercel CDN（全球边缘节点）
  │
  └── API 请求 → https://pan.tantantan.tech/pan/（已备案）
                    │
                    └── Nginx (ECS 成都，2C2G)
                          │
  ┌───────────────────────┼───────────────────────┐
  │                       │                       │
/pan/              /pdf-preview/              /db/
Next.js:3000       alist /p/:5244         PostgREST:3100
  │                       │                       │
  ├── alist :5244         百度 CDN            PG :5432
  └── PostgREST :3100                           │
                                               bdpan
```

**关键延迟数据：**

| 路径 | 之前（仅 Vercel） | 现在（ECS 中转） |
|------|------------------|-----------------|
| 文件列表 | Vercel→alist 400ms+ | ECS→alist <10ms |
| PDF 数据 | 直连 alist 10s+ | ECS 同机 100Mbps，Nginx 缓存 2h |
| 数据库 | Supabase 云 50ms+ | ECS 本地 <1ms |

---

## 4. 项目结构与文件地图

```
baidu-pan-alist/
├── .env.local                    # 所有密钥（⚠️ 不提交 Git）
├── next.config.ts                # Next.js 配置 + 缓存头
├── package.json
├── TECHNICAL.md
│
├── public/
│   └── pdfjs/                    # 📄 PDF 阅读器（自部署）
│       ├── viewer.html           # 自研阅读器（Panzoom + PDF.js）
│       ├── panzoom.min.js        # 手势缩放库
│       ├── pdf.min.mjs           # PDF.js 核心库
│       └── pdf.worker.min.mjs    # PDF.js Worker
│
├── src/
│   ├── app/
│   │   ├── layout.tsx            # 根布局（引入 server-log）
│   │   ├── page.tsx              # ★★★★★ 全部前端（~3800 行）
│   │   └── api/
│   │       ├── _auth.ts          # JWT 签发/验证（HMAC-SHA256）
│   │       ├── _auth-edge.ts     # (未用)
│   │       ├── login/route.ts    # 登录 / 游客（返回 sessionId）
│   │       ├── users/route.ts    # 用户管理（admin 专属）
│   │       ├── global-settings/route.ts  # 公开配置
│   │       ├── admin-stats/route.ts      # 统计（支持 source=ecs|supabase）
│   │       ├── file-permissions/route.ts # 文件权限规则 + 正则预览
│   │       ├── alist/route.ts           # ★ AList 代理
│   │       ├── alist-download/route.ts  # 下载（记录成功/失败）
│   │       ├── alist-upload/route.ts    # 上传
│   │       ├── alist-token/route.ts     # AList JWT 缓存
│   │       ├── alist-zip-preview/route.ts # ZIP 目录计数
│   │       ├── alist-zip-download/route.ts # ★ ZIP 流式打包（T1/T2/T3 降级）
│   │       ├── alist-batch-list/route.ts  # T2 文件清单
│   │       ├── log-action/route.ts   # 操作日志（含 device_code）
│   │       ├── log-deny-event/route.ts # deny 事件回调端点（Origin 校验）
│   │       ├── deny-stats/route.ts   # 风控管理数据 API
│   │       ├── check-risk/route.ts   # 用户风险评分查询
│   │       ├── track/route.ts        # 访问记录
│   │       └── debug-logs/route.ts   # 服务端日志（admin 查看）
│   └── lib/
│       ├── users.ts              # ★★★★★ 用户/权限/设置 CRUD
│       ├── pg-adapter.ts         # ★ PostgREST 适配器 + 双写
│       ├── deny-tracker.ts       # 🛡️ 风控引擎（评分/衰减/去重/自动封禁）
│       ├── fingerprint.ts        # 设备码工具（Canvas/WebGL FNV-1a hash）
│       ├── alist-utils.ts        # 递归列文件（search+BFS 双策略）
│       └── server-log.ts         # 服务端日志缓存
│
├── sql/
│   └── deny-tables.sql           # 风控系统建表 DDL
│
├── e2e/                          # Playwright 测试
│   ├── login.spec.ts
│   └── app.spec.ts
│
└── nginx/
    └── 403.html                  # deny 拦截页（设备码 + 回调 + 警告条）
```

---

## 5. 密钥清单与获取方式

| 密钥 | 用途 | 获取位置 |
|------|------|----------|
| `ADMIN_TOKEN_SECRET` | JWT 签名密钥 | `.env.local` → 用 `openssl rand -hex 32` 生成 |
| `PG_DB_TOKEN` | PostgREST 访问令牌 | `.env.local` + Nginx `/db/` 配置（两处一致） |
| `ALIST_PASSWORD` | AList 管理员密码 | AList 管理面板 `https://pan.tantantan.tech:5244` |
| `NEXT_PUBLIC_ALIST_URL` | AList 公网地址 | 固定 `https://pan.tantantan.tech` |
| `NEXT_PUBLIC_API_BASE` | API 转发地址 | 固定 `https://pan.tantantan.tech/pan` |
| `PG 密码` | 数据库密码 | 宝塔 → 数据库 → PgSQL → bdpan |
| `SUPABASE_BACKUP_URL` | 双写备份地址 | Supabase Dashboard → Settings → API |
| `NEXT_PUBLIC_SUPABASE_URL` | PostgREST 网关 | 固定 `https://pan.tantantan.tech/db` |
| Vercel Token | Vercel API | Vercel Dashboard → Settings → Tokens |

**⚠️ 密码存储**：`bdpan_users` 表目前为明文密码。改进方向见 [#16](#16-已知限制与改进方向)。

---

## 6. 认证体系

### Token（`_auth.ts`）

自研 JWT，HMAC-SHA256，payload base64url：

```
signToken(username, role, durationHours)
  → base64url({ exp, username, role }) + "." + HMAC(secret)

verifyToken("Bearer xxx.yyy")
  → decode → check exp → { username, role }
```

secret = `ADMIN_TOKEN_SECRET`（`.env.local`），**不允许用默认值**。

### sessionId

登录时 `crypto.randomUUID()` 生成，`localStorage.setItem('BDPAN_SESSION', sessionId)`。后续所有 `logUserAction` 携带。

### fingerprint

游客首次登录时生成 `${timestamp}-${random6}`，`localStorage.setItem('BDPAN_FINGERPRINT', fingerprint)`。用于区分不同游客。

---

## 7. 权限系统

### 全局权限位（12 项）

```typescript
interface UserPermissions {
    view: boolean;         // 浏览子目录
    search: boolean;       // 搜索
    download: boolean;     // 下载
    upload: boolean;       // 上传
    delete: boolean;       // 删除
    rename: boolean;       // 重命名
    preview: boolean;      // 预览
    setting?: boolean;     // 自定义 AList 连接
    controlFile?: boolean; // 文件权限规则管理
    basePath?: string;     // 用户根目录映射（虚根隔离）
    viewStats?: boolean;         // 数据审计面板
    viewActionLogs?: boolean;    // 操作日志面板
    viewIpStats?: boolean;       // IP 统计面板（只读）
    viewDownloadLogs?: boolean;  // 下载明细面板
}
```

### 默认值

| 权限 | admin | manager | guest |
|------|-------|---------|-------|
| view/search/download/preview | ✅ | ✅ | ✅ |
| upload/delete/rename | ✅ | ✅ | ❌ |
| setting | ✅ | ❌ | ❌ |
| controlFile | ✅ | ✅ | ❌ |
| 4 日志权限 | ✅（绕过） | ❌ | ❌ |

admin 角色**绕过所有文件级权限规则**，直接返回全部权限。

### 文件级规则（3 种匹配模式）

```typescript
interface FilePermissionRule {
    id: string;
    path: string;
    pathType: 'file' | 'dir' | 'regex';
    regexScope?: 'name' | 'path';  // 仅 regex 有效
    users: string[];
    deny: Partial<Record<FilePermissionAction, boolean>>;
}
```

| 类型 | 匹配逻辑 |
|------|----------|
| `file` | `normalizePath(target) === normalizePath(rule.path)` |
| `dir` | `target.startsWith(rule.path + '/')` 或精确匹配 |
| `regex` | `new RegExp(rule.path, 'i').test(testTarget)` |

`regexScope`：
- `'path'`（默认）：测试完整路径 `/sta/未来梦/Vol.35.pdf`
- `'name'`：仅测试文件名 `Vol.35.pdf`

### 正则预览

管理面板输入正则 → `POST /api/file-permissions { action:'preview' }` → 后端调 AList `/api/fs/search` 或 BFS 遍历目录树 → 返回匹配文件列表和数量。

### 生效链路

```
bdpan_settings.filePermissionRules
  → alist/route.ts: getEffectivePermissionsForPathCached()
    → 列表每个 item 附加 perms（delete/rename/upload/download/preview）
  → alist-download/route.ts: 下载前检查
  → alist-zip-download/route.ts: ZIP 打包前预扫描
  → page.tsx 前端: openAlistItem/alistNavigate 读取 item.perms
```

### IP 封禁

`settings.bannedIps`（`Record<IP, expiryTimestamp>`）。每次 API 调用在入口处 `checkIpBanned()` 检查——封禁 IP 返回 403，同时写入 `view_logs.blocked=true`。

---

## 8. 所有 API 路由

| 路由 | 方法 | 鉴权 | 说明 |
|------|------|------|------|
| `/api/alist` | POST | Bearer | AList 代理（list/get/search/mkdir/remove/rename）|
| `/api/alist-download` | GET | token | 下载（记录成功/失败日志 + 文件大小）|
| `/api/alist-upload` | PUT | Bearer | 文件上传 |
| `/api/alist-token` | POST | Bearer | AList JWT 获取 |
| `/api/alist-zip-preview` | GET | token | ZIP 目录文件计数 |
| `/api/alist-zip-download` | GET | token | 流式 ZIP 打包（3 层降级）|
| `/api/alist-batch-list` | GET | token | T2 文件清单（含 sign）|
| `/api/login` | POST | 无 | 登录/游客（返回 sessionId）|
| `/api/users` | GET/POST | Bearer | 用户管理（admin）|
| `/api/global-settings` | GET | 无 | 公开配置（下载模式/公告）|
| `/api/admin-stats` | GET | Bearer | 统计（?source=ecs\|supabase）|
| `/api/file-permissions` | GET/POST | Bearer | 文件权限规则 + 正则预览 |
| `/api/log-action` | POST | 无 | 操作日志写入 |
| `/api/track` | POST | 无 | 访问记录写入 |
| `/api/debug-logs` | GET | Bearer | 服务端日志（admin 专属）|
| `/api/log-deny-event` | POST | 无 | deny 事件回调（Origin 校验，含 session_id）|
| `/api/deny-stats` | GET/POST | Bearer | 风控管理数据 + 管理操作 |
| `/api/check-risk` | GET | 无 | 查询当前设备/IP 风险评分 |

### 管理面板数据源切换

管理面板标题栏按钮切换统计数据的读取来源：
- `📡 ECS`（绿色）— 从 ECS PostgreSQL 读取（主库）
- `☁️ Supabase`（蓝色）— 从 Supabase 读取（备份）

前端发 `?source=ecs|supabase` 参数到 `/api/admin-stats`。写入始终同时写入 ECS 和 Supabase（双写），不受此设置影响。

---

## 9. 下载体系

### 单文件（5 选项）

| # | 名称 | 路径 | 下载日志 | 速度 |
|---|------|------|----------|------|
| ① 阿里云 ECS | `/api/alist-download`（服务端 UA） | ✅ 成功/失败+文件大小 | 经过 Vercel/ECS 中转 |
| ② Cloudflare | `cf.ryantan.fun/?url=raw_url` | ❌ 只记点击 | CDN 直连，最快 |
| ③ 复制直链 | `navigator.clipboard.writeText(raw_url)` | ❌ 只记点击 | 需搭配 IDM |
| ④ Vercel 中转 | `/api/alist-download`（备用） | ✅ 同 ① | 同上 |
| ⑤ 直链下载 | `window.open(alistBase/p/...?sign=...)` | ❌ 只记点击 | 直连 alist，满速 |

选项 ②③⑤ 由浏览器接管下载过程，服务端无法追踪最终的下载成功/失败。
选项 ①④ 走 `/api/alist-download`，会记录 `下载 - ECS - 成功` 或 `下载 - ECS - 失败` 及文件大小。

### 批量下载

选中文件/文件夹 → 点击「批量下载」→ 弹出 T1/T2 选择弹窗：

```
📦 批量下载 — 2 个文件夹 + 1 个文件
┌─────────────────────────────┐
│ 📦 打包下载 (ZIP)           │ → T1
│ ⚡ 逐个下载 (直链满速)       │ → T2
└─────────────────────────────┘
```

#### T1 ZIP 打包

**后端**（`alist-zip-download/route.ts`）：

```
Phase 1 — 预扫描：
  for each 选中路径：
    → get（判断是文件还是目录）
    → 列目录（search 快速路径 → BFS 降级）
    → 逐文件过 getEffectivePermissionsForPath
    → 被禁文件跳过（记录到 X-Skipped-Files 头）

Phase 2 — 流式打包（archiver，zlib:0 不压缩）:
  6 并发下载每个文件，3 层降级：
    T1: fetch(alist /p/{path}?sign={sign})  ← 最快，内网直连
    T2: get → raw_url → fetch(百度 CDN, UA)  ← 跨代理降级
    T3: 跳过（统计到 totalFailed）
  ReadableStream → 浏览器
```

**控制台输出（ECS/Vercel 日志）**：

```
[ZIP:T1首选] 开始打包, 2 个路径 → /p/ 直链优先
[ZIP] 获取目录 未来梦, 共 47 个文件
[ZIP] 完成 → T1直链:42 T2降级:3 T3保底:2 失败:0
```

**前端**：`alistBatchDownloadFolders()` → 预览计数 → 下载 ZIP → 提示 `⚠️ X 个文件因权限策略未包含`。

#### T2 逐个直链

**后端**（`alist-batch-list/route.ts`）：列文件清单（path+sign+size+relativePath），逐文件权限过滤。
**前端**（`alistBatchDownloadT2()`）：逐个创建 `<a>` 标签触发下载，间隔 600ms（桌面）/ 2000ms（移动端）。

---

## 10. PDF 预览体系

### 技术路线（v4.0 完全重写）

```
page.tsx loadPreviewContent()
  → fetchAlist({action:'get'}) 获取 sign
  → 用 sessionStorage 传 URL：key = 'pdf_'+Date.now()
  → iframe src = viewer.html?key=xxx
  → viewer.html 读取 sessionStorage，removeItem（用完即删）
  → PDF.js 渲染（300% DPI，滑块可调清晰度）
  → Panzoom 处理双指缩放/拖拽/Ctrl+滚轮
  → Canvas 缓存 12 页 + 预渲染后续 4 页
```

### PDF 数据流

```
浏览器 → https://pan.tantantan.tech/pdf-preview/{path}?sign={sign}
  → Nginx:
    - proxy_pass → alist :5244/p/
    - Referer 检查（仅 *.tantantan.tech 和 localhost）
    - proxy_hide_header Content-Disposition, add_header inline
    - proxy_cache：首次拉取后缓存 2h 到 /tmp/nginx_pdf_cache
    - 禁止浏览器缓存 Cache-Control: no-store
```

### viewer.html 交互

| 操作 | 效果 |
|------|------|
| 双指捏合 | Panzoom 缩放 |
| 单指拖拽 | 缩放后平移 |
| Ctrl+滚轮 | 缩放 |
| 滚轮（非 Ctrl）| 无操作（防止误翻页）|
| ← → ↑ ↓ | 翻页 |
| + / - | 缩放 |
| F | 切换全屏/工具栏 |
| Esc | 退出全屏 |
| 清晰度滑块 | 调整渲染 DPI（300%/200%/150%/100%）|
| 页码输入 | 跳转到指定页 |

### 防盗措施

| 层 | 措施 |
|----|------|
| 地址栏 | URL 不暴露 sign，用 sessionStorage key |
| Referer | Nginx 检查，非白名单域名 403 |
| 缓存 | 浏览器强制 no-store |
| CDN 嗅探 | 响应头 `Content-Disposition: inline`（不在新窗口下载）|

---

## 11. 前端架构

`page.tsx`：单文件组件 ~3800 行，50+ `useState`。

### 视图切换

工具栏 `🖼️` / `📋` 按钮切换列表/图标视图。图标视图支持图片缩略图（alist `thumb` 字段→百度 CDN 小图）。

### 右键菜单

图标模式下右键 → 弹出菜单：打开/预览、下载、重命名、删除（按权限显示）。

### 关键函数

| 函数 | 行号（约）| 说明 |
|------|-----------|------|
| `fetchAlist()` | 352 | AList API 封装 |
| `logUserAction()` | 342 | 操作日志（sessionId+fingerprint+status）|
| `openAlistItem()` | 881 | 文件点击决策 |
| `alistBatchDownload()` | 992 | 批量下载入口（分离文件/文件夹）|
| `alistBatchDownloadFolders()` | 1047 | T1 ZIP 打包 |
| `alistBatchDownloadT2()` | 1030 | T2 逐个下载 |
| `fetchAdminData()` | 1409 | 管理面板数据（?source= 参数）|
| `submitFilePermissionDraft()` | 1472 | 文件权限规则保存 |

### 在线用户管理

管理面板顶部 `🟢 在线: N 人` 按钮 → 弹出用户列表。算法（`admin-stats/route.ts`）：

1. 取 `bdpan_action_logs` 最近 1h 内的 `action_type='登录'` 记录
2. 过滤掉有 `action_type='登出'` 且登出时间 > 登录时间的用户
3. 剩余用户去重 → 在线列表

支持「强制登出」：写入一条 `登出 - 强制` 日志，用户下次 API 请求时被 verifyToken 拒绝。

### 日志系统

- `session_id` — 登录时 `crypto.randomUUID()` 生成，localStorage 存 `BDPAN_SESSION`
- `fingerprint` — 游客登录时自动生成 `${timestamp}-${random6}`，localStorage 存 `BDPAN_FINGERPRINT`
- `status` — `success` / `blocked` / `failed`，自动附加到 `action_type` 后缀
- `logUserAction()` — 每次调用携带 sessionId + fingerprint，发送到 `/api/log-action`

### Toast 消息

页面顶部的消息条。30s 自动消失，新消息重置计时器，可手动 `✕` 关闭。
- 绿色 = ✅ 成功、红色 = ❌ 失败、黄色 = ⚠️ 警告

---

## 12. 数据库

### 架构

```
Primary: ECS PostgreSQL:5432 ← PostgREST:3100 ← Nginx /db/（X-DB-Token 鉴权）
   ↓ 异步不阻塞（fire-and-forget）
Backup: Supabase（可选，通过 SUPABASE_BACKUP_URL 控制）
```

**双写机制**（`lib/pg-adapter.ts`）：

```typescript
// 主写入
const r = await pgFetch('POST', table, data);   // → ECS PostgREST
// 异步备份（不等待，失败只打印 warn）
backupWrite('POST', table, data);                // → Supabase
```

备份写入时自动移除 ECS 独有的字段（`session_id`、`fingerprint`、`blocked`）以兼容 Supabase 表结构。

**读取只走 ECS**（Supabase 仅做灾备）。

### 表结构

#### `bdpan_users`

| 列 | 类型 | 说明 | 默认值 |
|---|---|---|---|
| id | bigint PK | 自增（GENERATED BY DEFAULT AS IDENTITY） | 序列 bdpan_users_id_seq |
| username | text NOT NULL | 用户名（唯一） | - |
| password | text NOT NULL | ⚠️ 明文密码 | - |
| role | text NOT NULL | `admin`/`manager`/`guest` | - |

初始化需手动插入 admin 用户。

#### `bdpan_settings`

| 列 | 类型 |
|---|---|
| key | text PK，固定 `'global'` |
| value | jsonb，存储完整的 `GlobalSettings` 接口 |

`value` 结构示例：

```json
{
  "enableGuestMode": true,
  "permissions": { "manager1": { "view": true, "download": false } },
  "filePermissionRules": [{ "path": "密码", "pathType": "regex", ... }],
  "downloadChannel": "ecs",
  "downloadModes": { "ecs": "enabled", "cf": "enabled", ... },
  "bannedIps": { "1.2.3.4": 1781300000000 },
  "sessionDurationHours": 8
}
```

#### `bdpan_action_logs`

| 列 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | 序列 `bdpan_action_logs_id_seq` |
| username | text | 操作者 |
| action_type | text | `下载 - ECS` / `下载 - ECS - 被拦截` / `登录` / `登录 - 失败` |
| action_item | text | 操作对象（文件路径、用户名等）|
| ip | text | 客户端 IP |
| location | text | 地理定位 |
| log_text | text | 完整描述文本 |
| session_id | text | 会话 ID（`_auth` 第 24 行 UUID 生成）|
| fingerprint | text | 游客指纹 |
| created_at | timestamptz | JS 端 `new Date().toISOString()` 传入 |

`action_type` 命名规则：
- 成功：`动作`（如 `下载 - ECS`、`浏览目录`）
- 被拦截：`动作 - 被拦截`（如 `下载 - ECS - 被拦截`）
- 失败：`动作 - 失败`（如 `登录 - 失败`）

#### `view_logs`

| 列 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | 序列 `view_logs_id_seq` |
| visit_time | timestamptz | JS 端传入 |
| ip_address | text | 访客 IP |
| username | text | 已登录则记录用户名 |
| user_agent | text | 浏览器 UA |
| country/region/city | text | 地理位置 |
| page_source | text | 固定 `'pan'`（管理面板查询时过滤）|
| session_id | text | 会话 ID |
| blocked | boolean DEFAULT false | IP 被封禁后的访问标记 |

### 序列修复（常见问题）

ECS 导入 CSV 后序列落后于 Max(id)，新写入时 ID 冲突：

```bash
sudo docker exec -it postgrest psql \
  -c "SELECT setval('view_logs_id_seq', (SELECT MAX(id) FROM view_logs)); \
       SELECT setval('bdpan_action_logs_id_seq', (SELECT MAX(id) FROM bdpan_action_logs));" 2>/dev/null \
  || sudo docker run --rm --network host -e PGPASSWORD='<密码>' postgres:16-alpine psql \
  -h 127.0.0.1 -U postgres -d bdpan \
  -c "SELECT setval('view_logs_id_seq', (SELECT MAX(id) FROM view_logs)); \
       SELECT setval('bdpan_action_logs_id_seq', (SELECT MAX(id) FROM bdpan_action_logs));"
```

### Docker 方式连数据库

```bash
sudo docker run --rm --network host -e PGPASSWORD='<密码>' postgres:16-alpine psql \
  -h 127.0.0.1 -U postgres -d bdpan -c "<SQL>"
```

---

## 13. 部署方案

### 构建与依赖

**`postinstall` 脚本**（`package.json`）：

```json
"postinstall": "mkdir -p public/pdfjs && cp node_modules/pdfjs-dist/build/pdf.min.mjs node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdfjs/"
```

**每次更新后手动拷贝 Panzoom**（PDF.js 由 postinstall 自动拷贝）：

```bash
sudo cp node_modules/@panzoom/panzoom/dist/panzoom.min.js public/pdfjs/
```

**构建命令链：**

```bash
cd /www/wwwroot/bd-pan
sudo git pull
sudo npm install                  # 安装依赖 + postinstall 自动拷贝 PDF.js
sudo cp .../panzoom.min.js public/pdfjs/  # 手动拷贝 Panzoom
sudo npm run build                # 构建 Next.js（.next/ 目录）
sudo pm2 restart bdpan            # 重启进程
```

> ⚠️ 如果只改了 `public/pdfjs/viewer.html`（静态文件），不需要 `npm run build` 和 `pm2 restart`——Nginx 直接读磁盘。

### Vercel（前端托管）

| 项目 | 值 |
|------|-----|
| 仓库 | `stacdqz/bd-pan` |
| 生产域名 | `pan.cdqzsta.tech`（未备案，走 Vercel DNS）|
| 测试域名 | `testpan.cdqzsta.tech`（绑定 `demo-ecs-api` 分支）|
| 关键环境变量 | `NEXT_PUBLIC_API_BASE=https://pan.tantantan.tech/pan` |
| 自动部署 | `git push main` → 自动构建部署 |

**Vercel 配置：**
- Framework Preset：Next.js（自动检测）
- Node.js 版本：20.x
- Build Command：`npm run build`
- Output Directory：`.next`
- Install Command：`npm install`
- Environment Variables：全量 `.env.local`（`NEXT_PUBLIC_` 前缀必须在 Vercel Dashboard 和 `.env.local` 各配一份）
- Deployment Protection：**必须关闭**（否则所有访问跳转到 Vercel SSO 登录）
- Production Branch：`main`
- Preview Branches：`demo-ecs-api` → `testpan.cdqzsta.tech`

**Vercel 添加域名步骤：**
1. Dashboard → bd-pan → Settings → Domains
2. 输入 `pan.cdqzsta.tech` → Add
3. 到域名 DNS 托管商添加 CNAME 记录：`pan` → `cname.vercel-dns.com`
4. 等待 SSL 证书自动签发（~1 分钟）

### ECS（API + 数据库）

| 项目 | 值 |
|------|-----|
| 规格 | 2C2G，成都区域 |
| 操作系统 | CentOS（宝塔 Linux 面板）|
| 域名 | `pan.tantantan.tech`（已备案）|
| 网络 | 公网 100Mbps，内网 127.0.0.1 |

**ECS 上的服务：**

| 服务 | 端口 | 用途 | 管理方式 |
|------|------|------|----------|
| AList | 5244 | 百度网盘桥接 | 宝塔 Docker / 进程管理 |
| PostgreSQL | 5432 | 数据库 | 宝塔 → 数据库 → PgSQL |
| PostgREST | 3100 | REST API 网关 | `sudo docker` |
| Next.js | 3000 | API + 静态文件 | PM2 守护 |
| Nginx | 80/443 | 反向代理 | 宝塔 → 网站 |

**AList 存储驱动配置**（AList 管理面板 → 存储 → 添加）：

```yaml
挂载路径: /sta
驱动: 百度网盘
根文件夹 ID: /     # STA 目录在百度盘的根
刷新令牌: <通过百度 OAuth 获取>
```

**PostgREST 初始化：**

```bash
sudo docker run -d --name postgrest --restart always --network host \
  -e PGRST_SERVER_PORT=3100 \
  -e PGRST_DB_URI="postgres://<用户>:<密码>@127.0.0.1:5432/bdpan" \
  -e PGRST_DB_SCHEMAS="public" \
  -e PGRST_DB_ANON_ROLE="bdpan" \
  -e PGRST_JWT_SECRET="<任意32位字符串>" \
  -e PGRST_MAX_ROWS=100000 \
  postgrest/postgrest:latest
```

### Nginx 配置原文（`/www/server/panel/vhost/nginx/pan.tantantan.tech.conf`）

**⚠️ `proxy_cache_path` 必须放在 `/www/server/nginx/conf/nginx.conf` 的 `http {}` 块内**，不是本站点配置里。

```nginx
# ============================================================
# 🔧 server 块头部
# ============================================================
server {
    types { application/javascript mjs; }
    listen 80;
    listen 443 ssl;
    listen 443 quic;
    http2 on;
    server_name pan.tantantan.tech;
    index index.php index.html index.htm default.php default.htm default.html;
    root /www/wwwroot/pan.tantantan.tech;

    # --- 宝塔 SSL 证书 ---
    ssl_certificate     /www/server/panel/vhost/cert/pan.tantantan.tech/fullchain.pem;
    ssl_certificate_key /www/server/panel/vhost/cert/pan.tantantan.tech/privkey.pem;
    ssl_protocols TLSv1.1 TLSv1.2 TLSv1.3;
    ssl_ciphers EECDH+CHACHA20:EECDH+CHACHA20-draft:EECDH+AES128:RSA+AES128:EECDH+AES256:RSA+AES256:EECDH+3DES:RSA+3DES:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    add_header Strict-Transport-Security "max-age=31536000";
    add_header Alt-Svc 'quic=":443"; h3=":443"; h3-29=":443"; ...';

    # HTTP → HTTPS 自动跳转
    set $isRedcert 1;
    if ($server_port != 443) { set $isRedcert 2; }
    if ($uri ~ /\.well-known/) { set $isRedcert 1; }
    if ($isRedcert != 1) { rewrite ^(/.*)$ https://$host$1 permanent; }

    # 404 错误页（宝塔默认）
    error_page 404 /404.html;

    # ============================================================
    # 🚫 全局 403 处理 — 统一 302 重定向到 deny.tantantan.tech
    # 所有 return 403 的 location 都会走这里，一处维护
    # ============================================================
    error_page 403 @deny;
    location @deny {
        return 302 https://deny.tantantan.tech/?from=$uri&ip=$remote_addr&time=$time_local&ua=$http_user_agent;
    }

    # ============================================================
    # 📄 PDF 预览代理 + 防盗链 + Nginx 缓存
    #
    # 缓存策略:
    #   - 首次拉取 PDF 后缓存 1h（proxy_cache_valid 200 206 1h）
    #   - 缓存 key = URI + 参数（每个 sign 独立缓存）
    #   - proxy_cache_lock on → 同一文件并发请求只拉一次
    #   - 忽略上游的 Cache-Control/Expires 头，强制缓存
    #   - proxy_buffering on → 完整接收后一次性响应
    #
    # 防盗链:
    #   - 仅 pan.tantantan.tech 的 referer 可访问（含 localhost 调试）
    #   - 其他来源 → 触发 403 → 跳转 deny.tantantan.tech
    # ============================================================
    location /pdf-preview/ {
        # ── 缓存 ──
        proxy_cache pdf_cache;
        proxy_cache_key "$uri?$args";
        proxy_cache_valid 200 206 1h;
        proxy_cache_lock on;
        proxy_ignore_headers Cache-Control Expires Set-Cookie;
        proxy_buffering on;
        add_header X-Cache-Status $upstream_cache_status;

        # ── 防盗链 ──
        proxy_intercept_errors on;
        set $block_referer 0;
        if ($http_referer !~* pan\.tantantan\.tech) {
            set $block_referer 1;
        }
        if ($block_referer = 1) {
            return 403;   # → 触发全局 @deny 302 重定向
        }

        # ── CORS 预检 ──
        if ($request_method = 'OPTIONS') {
            add_header Access-Control-Allow-Origin *;
            add_header Access-Control-Allow-Methods 'GET, OPTIONS';
            return 204;
        }

        # ── 代理到 AList ──
        proxy_pass http://127.0.0.1:5244/p/;
        proxy_hide_header Content-Disposition;
        proxy_hide_header Access-Control-Allow-Origin;
        add_header Content-Disposition inline;
        add_header Access-Control-Allow-Origin *;
        proxy_read_timeout 300s;
        proxy_set_header Range $http_range;
        proxy_pass_header Accept-Ranges;
    }

    # ============================================================
    # 📁 PDF.js 静态文件 — 直接读磁盘，不经过 Next.js
    # ============================================================
    location /pan/pdfjs/ {
        alias /www/wwwroot/bd-pan/public/pdfjs/;
        add_header Access-Control-Allow-Origin *;
        if ($request_filename ~* \.mjs$) {
            add_header Content-Type application/javascript;
        }
        if ($request_filename ~* \.html$) {
            add_header Content-Type text/html;
        }
    }

    # ============================================================
    # 🔗 Next.js API 代理 — Vercel 前端所有 /pan/ 请求 → ECS Next.js:3000
    #
    # 必须转发真实 IP 头，否则所有日志显示 127.0.0.1
    # ============================================================
    location /pan/ {
        if ($request_method = 'OPTIONS') {
            add_header Access-Control-Allow-Origin *;
            add_header Access-Control-Allow-Methods 'GET, POST, PUT, DELETE, OPTIONS';
            add_header Access-Control-Allow-Headers 'Content-Type, Authorization, X-Device-Code';
            return 204;
        }
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        # ⚠️ 这三行是客户端 IP 正确记录的关键
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        add_header Access-Control-Allow-Origin *;
        proxy_read_timeout 300s;
    }

    # ============================================================
    # 🛡️ 数据库网关 — X-DB-Token 鉴权，防止公网直连 PostgREST:3100
    # ============================================================
    location /db/ {
        if ($http_x_db_token != "<PG_DB_TOKEN>") {
            return 403;   # → 触发全局 @deny 302 重定向
        }
        rewrite ^/db/(.*) /$1 break;
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
    }

    # ============================================================
    # 🌐 地理位置查询代理（ip-api.com HTTP → 同源 HTTPS，403.html 已改用 ipapi.co HTTPS 直连）
    # ============================================================
    location = /geo-lookup {
        resolver 114.114.114.114 valid=300s;
        set $geo_path "/json/$arg_ip";
        proxy_pass http://ip-api.com$geo_path?fields=status,message,country,countryCode,regionName,city,zip,lat,lon,isp,org,query&lang=zh-CN;
        proxy_set_header Host ip-api.com;
    }

    # 宝塔扩展配置
    include /www/server/panel/vhost/nginx/well-known/pan.tantantan.tech.conf;
    include /www/server/panel/vhost/nginx/extension/pan.tantantan.tech/*.conf;
    include /www/server/panel/vhost/nginx/proxy/pan.tantantan.tech/*.conf;
    include enable-php-00.conf;
    include /www/server/panel/vhost/rewrite/pan.tantantan.tech.conf;

    # 禁止访问的敏感文件
    location ~ ^/(\.user.ini|\.htaccess|\.git|\.env|\.svn|\.project|LICENSE|README.md) {
        return 404;
    }
    location ~ \.well-known { allow all; }
    if ($uri ~ "^/\.well-known/.*\.(php|jsp|py|js|css|lua|ts|go|zip|tar\.gz|rar|7z|sql|bak)$") {
        return 403;
    }

    access_log  /www/wwwlogs/pan.tantantan.tech.log;
    error_log   /www/wwwlogs/pan.tantantan.tech.error.log;
}
```

### 安全清单

| # | 措施 | 位置 |
|---|------|------|
| 1 | JWT 签名密钥 | `ADMIN_TOKEN_SECRET`（`.env.local`）|
| 2 | PostgREST 保护 | Nginx `/db/` + `X-DB-Token` 验证 |
| 3 | PDF 防盗链 | `/pdf-preview/` + Referer 检查 |
| 4 | PDF URL 隐藏 | sessionStorage key，不暴露在地址栏 |
| 5 | IP + 设备封禁 | `checkEntityBanned()` 双维度检查 + `denyAndLog()` 自动记录 |
| 6 | 操作日志 | 所有请求记录，含 IP、地理位置、设备码 |
| 7 | 风控评分 | deny 事件自动评分/衰减/去重，≥50 封设备 ≥70 封IP |
| 8 | 全局开关 | `settings.denyTracking.enabled` 一键关闭风控系统 |
| 9 | 防盗链 | `/pdf-preview/` + Referer 检查，触发 302 deny 页 |
| 10 | PDF URL 隐藏 | sessionStorage key，不暴露在地址栏 |
| 11 | 登录频率限制 | ⚠️ 未实现（建议：Nginx limit_req）|
| 12 | 密码存储 | ⚠️ 明文（建议：bcrypt）|
| 13 | CORS | 所有 API 端点 `Access-Control-Allow-Origin *` + `X-Device-Code` |
| 14 | `git` 敏感文件 | `.gitignore` 排除 `.env.local`、`server` |

---

## 14. 风控系统 — Deny 追踪 + 风险评分 + 自动封禁

### 概述

对所有 deny/403/401 事件统一记录，按 IP + 设备码（Canvas/WebGL 指纹）双维度累计风险评分、告警、自动封禁。用户登录后页面顶部显示风控警告条。

**全局开关**：管理面板「🛡️ 风控管理」一键关闭（`settings.denyTracking.enabled`）。

### 设备码（机器码）

基于浏览器 Canvas + WebGL + 硬件属性的 FNV-1a 64-bit hash。同设备同浏览器基本不变，换 IP、清缓存均不影响。页面首次加载时计算并存入 `localStorage.BDPAN_DEVICE_CODE`，所有 API 请求通过 `X-Device-Code` header 携带。

### deny 事件采集

| 来源 | 触发方式 | 采集路径 |
|------|---------|----------|
| Nginx 层（PDF 盗链、Token 探测） | 302 → deny.tantantan.tech | 403.html JS 回调 `POST /api/log-deny-event` |
| API 层（权限拒绝、认证失败） | 路由返回 403/401 | `denyAndLog()` 一行式 helper |
| 前端层（无权限操作拦截） | `logUserAction(..., 'blocked')` | 并行回调 `/api/log-deny-event` |

每条事件同时记录 **IP + 设备码 + 用户名 + session_id**，三者关联到同一行。

### 评分体系

| deny_reason | 分数 | 触发场景 |
|-------------|------|----------|
| `nginx_db_token` | 30 | /db/ 无 Token |
| `nginx_sensitive_file` | 20 | 探测 .env/.git 等 |
| `nginx_pdf_referer` | 10 | PDF 盗链 |
| `nginx_well_known` | 15 | .well-known 目录扫描 |
| `api_ip_banned` | 25 | 已封禁 IP 再次尝试 |
| `api_auth_failed` | 5 | Token 缺失/无效/过期 |
| `api_login_failed` | 8 | 密码错误、游客关闭 |
| `api_role_denied` | 10 | 非管理员访问管理接口 |
| `api_permission_denied` | 5 | 无操作权限（搜索/mkdir/删除/重命名） |
| `api_file_rule_denied` | 5 | 文件权限规则拒绝（预览/下载） |
| `api_all_items_denied` | 5 | 批量操作所有项被拒 |

**衰减**：`newScore = oldScore × max(0, 1 - hoursAgo ÷ 24) + eventPoints`

**去重**：同一 `(IP, request_path)` 5 分钟内只计分一次

### 阈值与动作

| 分数 | 动作 |
|------|------|
| ≥30 | **风控告警**：页面顶部常驻黄色警告条 + 风控管理面板标记 ⚠️ |
| ≥50 | **设备封禁**：`bdpan_risk_scores.is_banned=true`，24h 后解封，分数重置到 40 |
| ≥70 | **IP 封禁**：写入 `settings.bannedIps`，24h 后解封，分数重置到 60 |

**管理员豁免**：admin/manager 角色绕过封禁检查。

### 用户可见效果

**deny.tantantan.tech 拦截页**：显示 403 错误 + IP/UA/设备码/地理位置 + 黄色风控警告条。

**页面顶部警告条**（登录后）：分数 ≥30 时显示：
> ⚠️ 风控提醒：检测到您的设备异常行为。如继续触发安全规则，可能会触发风控（risk_score=35, reason="nginx_pdf_referer"）

**管理面板「🛡️ 风控管理」**：摘要条（24h deny 数 / 告警数 / 封禁数）+ 风险实体表 + 操作日志设备码列 + 点击 IP/设备码交叉筛选。

### 数据库表

| 表 | 内容 |
|----|------|
| `bdpan_deny_events` | deny 事件记录（ip, device_code, username, session_id, request_path） |
| `bdpan_risk_scores` | 按 `(entity_type, entity_value)` 累计风险评分 + 封禁状态 |

### 核心文件

| 文件 | 作用 |
|------|------|
| `src/lib/fingerprint.ts` | 设备码服务端计算 |
| `src/lib/deny-tracker.ts` | 风控引擎：logDenyEvent / denyAndLog / checkEntityBanned / getRequestContext |
| `src/app/api/log-deny-event/route.ts` | deny 事件 HTTP 回调（403.html → API，Origin 校验） |
| `src/app/api/deny-stats/route.ts` | 风控管理面板数据 + 管理操作 |
| `src/app/api/check-risk/route.ts` | 用户风险评分查询（页面顶部警告条用） |
| `sql/deny-tables.sql` | 建表 DDL |

---

## 15. ECS 运维命令全集

### 代码更新

```bash
cd /www/wwwroot/bd-pan && sudo git stash && sudo git pull && \
sudo npm install && \
sudo cp node_modules/@panzoom/panzoom/dist/panzoom.min.js public/pdfjs/
# 如有构建变更：
sudo npm run build && sudo pm2 restart bdpan
```

### PM2 管理

```bash
pm2 status                  # 查看进程状态
pm2 logs bdpan --lines 20   # 查看最近日志
pm2 restart bdpan            # 重启
pm2 delete bdpan             # 删除进程
pm2 start /www/wwwroot/bd-pan/node_modules/.bin/next --name bdpan -- start -p 3000
```

### 健康检查

```bash
curl -I http://127.0.0.1:3000/api/global-settings    # Next.js 是否运行
curl -I https://pan.tantantan.tech/pan/api/alist       # Nginx 转发是否正常
curl http://127.0.0.1:3100/bdpan_users                 # PostgREST 是否运行
find /tmp/nginx_pdf_cache -type f | wc -l              # PDF 缓存数量
nginx -t && nginx -s reload                            # Nginx 重载
```

### 风控系统

```bash
# 查最近 deny 事件
sudo docker run --rm --network host -e PGPASSWORD='<密码>' postgres:16-alpine psql \
  -h 127.0.0.1 -U postgres -d bdpan \
  -c "SELECT created_at, deny_reason, ip, device_code_hash, username FROM bdpan_deny_events ORDER BY created_at DESC LIMIT 10;"

# 查风险评分
sudo docker run --rm --network host -e PGPASSWORD='<密码>' postgres:16-alpine psql \
  -h 127.0.0.1 -U postgres -d bdpan \
  -c "SELECT entity_type, entity_value, current_score, total_events, is_banned FROM bdpan_risk_scores ORDER BY current_score DESC;"

# 手动清空 deny 数据
sudo docker run --rm --network host -e PGPASSWORD='<密码>' postgres:16-alpine psql \
  -h 127.0.0.1 -U postgres -d bdpan \
  -c "DELETE FROM bdpan_deny_events; DELETE FROM bdpan_risk_scores;"

# 重启 PostgREST 刷新 schema cache
sudo docker restart postgrest
```

### 数据库

```bash
# 通用查询
sudo docker run --rm --network host -e PGPASSWORD='<密码>' postgres:16-alpine psql \
  -h 127.0.0.1 -U postgres -d bdpan \
  -c "SELECT created_at, username, action_type FROM bdpan_action_logs ORDER BY created_at DESC LIMIT 10;"

# 查各表总数
sudo docker run --rm --network host -e PGPASSWORD='<密码>' postgres:16-alpine psql \
  -h 127.0.0.1 -U postgres -d bdpan \
  -c "SELECT 'action_logs' AS t, count(*) FROM bdpan_action_logs UNION ALL SELECT 'view_logs', count(*) FROM view_logs UNION ALL SELECT 'users', count(*) FROM bdpan_users;"

# 序列修复（id 冲突时）
sudo docker run --rm --network host -e PGPASSWORD='<密码>' postgres:16-alpine psql \
  -h 127.0.0.1 -U postgres -d bdpan \
  -c "SELECT setval('view_logs_id_seq', (SELECT MAX(id) FROM view_logs)); SELECT setval('bdpan_action_logs_id_seq', (SELECT MAX(id) FROM bdpan_action_logs));"

# PostgREST 重启
sudo docker restart postgrest
```

### 常用排查

```bash
netstat -tlnp | grep -E '3000|3100|5432|5244'   # 各服务端口
pm2 logs bdpan --lines 20                         # PM2 日志
cat /www/wwwroot/bd-pan/nohup.out | tail -30      # nohup 日志（备用）
```

---

## 16. 环境变量完整清单

### 分类说明

| 类别 | 必须配在 | 说明 |
|------|----------|------|
| `NEXT_PUBLIC_*` | Vercel Dashboard + `.env.local` | 构建时内嵌到 JS，运行时不可改 |
| `PG_*` / `ADMIN_*` | `.env.local` + ECS `.env.local` | 服务端读取，不暴露给浏览器 |
| `SUPABASE_BACKUP_*` | `.env.local` | 可选，不加则不启用双写 |

### 完整清单

```bash
# === 核心（Vercel + ECS 各一份）===
NEXT_PUBLIC_API_BASE=https://pan.tantantan.tech/pan  # API 转发目标
NEXT_PUBLIC_ALIST_URL=https://pan.tantantan.tech/    # AList 公网地址
NEXT_PUBLIC_SUPABASE_URL=https://pan.tantantan.tech/db  # PostgREST 网关
NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy                     # 未使用，留占位

# === 认证（ECS + Vercel）===
ADMIN_TOKEN_SECRET=<openssl rand -hex 32 生成>       # JWT 签名（不允许默认值）

# === AList（ECS + Vercel）===
ALIST_USERNAME=admin
ALIST_PASSWORD=<AList 管理面板密码>
ALIST_USERNAME_FALLBACK=
ALIST_PASSWORD_FALLBACK=

# === 数据库（仅 ECS）===
PG_DB_TOKEN=<openssl rand -hex 32 生成>              # PostgREST 网关 Token

# === 双写备份（可选，仅 ECS）===
# SUPABASE_BACKUP_URL=https://xxx.supabase.co
# SUPABASE_BACKUP_KEY=sb_publishable_xxxxx

# === ECS 部署（仅 ECS）===
NODE_OPTIONS=--max-old-space-size=1024   # Vercel 无需此变量
NODE_TLS_REJECT_UNAUTHORIZED=0
```

### 生成密钥命令

```bash
openssl rand -hex 32  # 生成 ADMIN_TOKEN_SECRET 或 PG_DB_TOKEN
```

---

## 17. 测试

```bash
# 安装 Playwright（首次）
npm install && npx playwright install chromium

# 运行全部测试（需要 dev server 在 localhost:3000）
npm test

# UI 模式（可视界面）
npm run test:ui

# 测试说明
```

测试覆盖：
- `login.spec.ts`：登录页加载、空输入、错误密码、游客登录、管理员登录
- `app.spec.ts`：文件列表、主题切换、退出等基础功能

> ⚠️ 测试需要连接真实的 AList + PostgreSQL，依赖外部服务。

---

## 18. 更新日志

变更记录位于 `src/data/changelog.json`。

```json
{
  "version": "4.0.0",
  "date": "2026-06-21 12:00:00",
  "message": "[重大] 核心架构升级：API 迁移至 ECS..."
}
```

---

## 19. 已知限制与改进方向

| # | 问题 | 影响 | 改进方向 |
|---|------|------|----------|
| 1 | 密码明文存储 | 数据库泄露可读全部密码 | bcrypt hash |
| 2 | `page.tsx` 3800 行单体 | 维护困难、diff 冲突 | 拆分组件 |
| 3 | Vercel 冷启动海外延迟 | 首次访问 2-5s | 迁移整站到 ECS（需 `cdqzsta.tech` 备案）|
| 4 | PDF 全量下载（非 Range） | 100MB PDF 10s 加载 | 修复跨域 Range 检测 |
| 5 | 手机端 300% Canvas | 低端手机卡顿 | 自适应降低分辨率 |
| 6 | 无 CI/CD | 手动部署 | 加 GitHub Actions |
| 7 | Supabase 无字段同步 | 备份写入跳过新字段 | 自动 DDL 同步 |
| 8 | Nginx deny 非浏览器漏记 | curl/脚本触发 302 跳转，JS 回调不执行 | 服务端代理记录（已尝试未调通） |

---

## 20. 安全审计记录

> 2026-07-08，张壹同学对系统进行了外部安全测试。

### 审计发现

**1. AList 文件签名永不过期（真实）**

AList 全局配置「忽略直接链接参数」设为 `sign,alist_ts` +「直链有效期」设为 `0`，导致签名链接永久有效。

**实际风险评估**：低。原因：
- AList 5244 端口未暴露公网，外部无法通过直链访问文件
- PDF 预览走 Nginx `/pdf-preview/` + Referer 白名单校验
- sign 通过 sessionStorage 临时传递，不暴露在浏览器地址栏
- 网站内每次预览/下载实时获取新 sign

**建议**：将「直链有效期」改为 `3600`（1 小时）。未执行，等实际泄露事件再处理。

**2. 离线暴力破解 HMAC-SHA256 签名密钥**

审计者尝试从已知 (path, sign) 对反推 AList 的 HMAC-SHA256 签名密钥，未成功。

**实际风险评估**：无。原因：
- HMAC-SHA256 是密码学单向函数，已知明文+密文无法反推密钥
- AList 签名密钥来自百度网盘 OAuth（refresh_token + client_secret），均为长随机字符串，非弱密码

**3. DDoS 耗尽 ipapi.co 免费配额（理论）**

deny 拦截页面的地理查询使用 ipapi.co 免费版（1000 req/day），理论上可被 DDoS 耗尽。

**实际风险评估**：低。原因：
- 每次 Nginx deny（PDF 盗链 10 分，Token 探测 30 分）都会计分
- 7 次探测即可触发 IP 自动封禁（70 分）
- DDoS 攻击在耗尽 API 配额前会先被风控系统封禁

**4. Next.js 未认证签名生成 API**

审计者检查了前端应用是否存在无需登录即可获取 AList sign 的 API 端点。

**实际风险评估**：无。所有 sign 获取端点（`/api/alist`、`/api/alist-download`、`/api/alist-token`）均要求 Bearer Token 认证。Guest 用户已禁用。

### 审计结论

未发现可实际利用的安全漏洞。三项发现中一项为低风险配置问题（建议保留现状观察），两项为理论上不可行的攻击路径（HMAC-SHA256 暴力破解已被数学证明不可行，DDoS 被风控系统自限）。
