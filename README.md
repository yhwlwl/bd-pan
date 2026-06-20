# 🚀 STA-PAN 用户手册 ProMax v5

> [!IMPORTANT]
> **全逻辑深度优化**：本站点的核心改进旨在**彻底解决百度网盘对大文件（≥20MB）的下载阻断**。通过阿里云国内 BGP 节点与 Cloudflare 边缘加速技术，实现手机端零配置、全速直下。

---

## 一、基本信息

- **官方网址**：[https://pan.cdqzsta.tech](https://pan.cdqzsta.tech)
- **站点特性**：基于 AList 协议的高级增强方案，独家支持大文件 UA 云端补全、多节点智能选路。

---

## 二、登录指南

- **游客登录**：小登们点击页面中心的 **"以游客身份登录"** 按钮即可直接进入浏览。
- **账号登录**：老登或"尸体"若拥有专属账号，请填入对应的用户名与密钥登录。
- **登录有效期**：Token 有效期为 **8 小时**，过期后需重新点击登录按钮获取新 Token。

> [!WARNING]
> **由于 Vercel 云端函数冷启动以及 AList Token 首次握手，第一次点击登录或进入目录时，加载时间可能长达 10s 以上，甚至可能出现短暂的 5xx 错误。这属于正常现象，请刷新页面重试即可。**

- **个性化皮肤**：点击页面右下角的 **月亮/太阳图标** 🌙/☀️ 即可切换模式。

---

## 三、下载逻辑详解（核心）

受百度网盘策略限制，**≥20MB** 的文件必须在请求中携带特定的 `User-Agent: pan.baidu.com` 标识。

> [!TIP]
> **重要提示**：点击下载后，系统需在云端进行 1-2 秒的链路解析，请耐心等待，切勿频繁刷新导致节点限流。

### 小文件（< 20MB）

直接点击文件，触发服务端 UA 注入后走浏览器原生下载，无需任何配置。

### 大文件（≥ 20MB）—— 弹窗四选一

| 方案 | 原理 | 推荐场景 |
| :--- | :--- | :--- |
| 🚀 **ECS 阿里云极速** | 阿里云成都 BGP 节点中转，云端自动补齐 UA | **手机首选，最快最稳** |
| ☁️ **Cloudflare 边缘加速** | 海外 CF Workers 节点中转，不计本站流量 | 线路拥堵时的备选 |
| ⚡ **复制直链** | 把 `raw_url` 存入剪贴板，由 IDM/NDM 负责带 UA 下载 | **PC 端极致满速** |
| 🔥 **服务器中转** | Vercel Serverless 函数代理下载流 | 紧急兜底（有月度配额） |

---

## 四、上传说明

- **权限**：上传功能仅对拥有 `upload` 权限的账号开放。
- **路线选择**：系统根据管理员设置的 `downloadChannel`（`ecs` / `frp`）自动选路。
- **单文件上传即可**，进入目标目录后点击顶部 **"↑ 上传"** 按钮并确认。

---

## 五、线路说明

- **🚀 ECS 线路（主）**：阿里云成都节点，承担 90% 以上的数据分发任务。
- **📡 FRP 线路（备）**：家中 NAS 直连，用于访问私有资源或突发备用。

---

## 六、常见问题（FAQ）

### Q1：第一次登录很慢，甚至出现 500 错误？

**A**：属于正常现象。Vercel Serverless 函数存在"冷启动"延迟，同时后端首次需要与 AList 握手获取 Token（缓存 47 小时）。**等待 10 秒或刷新页面即可**，不用担心账号或数据有问题。

---

### Q2：游客能看到根目录，但一进子目录就提示无权限？

**A**：这是权限系统的设计逻辑。代码中，访问根目录 `/` 总是被放行，只有进入子目录时才会检查 `view` 权限位。有以下三种情况：

1. 管理员没有给当前账号（或游客）开启 `view` 权限。
2. 管理员在后台覆写了该用户的 `permissions.view = false`。
3. 游客模式下，管理员可能故意限制了子目录访问。

**解决**：联系管理员在用户面板中检查并开启对应账号的 `view` 权限。

---

### Q3：手机浏览器下载大文件显示 403，但 IDM 可以下载？

**A**：这是百度网盘的 `User-Agent` 校验机制。手机浏览器无法修改 UA，直接请求裸直链会被百度拦截（403）。**选择弹窗中的 ECS 或 Cloudflare 方案**，由服务端/边缘节点自动补齐 `User-Agent: pan.baidu.com`。IDM 可以下是因为你在下载器里配置了正确的 UA。

---

### Q4：复制直链后，用 IDM / NDM 下载显示 403？

**A**：`raw_url` 本身依赖正确的 `User-Agent` 才能通过百度的校验。必须在 IDM/NDM 的请求头设置中手动添加：

```
User-Agent: pan.baidu.com
```

未添加该 UA 时，外部工具直接请求直链百度会返回 `403 Forbidden`。

---

### Q5：预览失败，但下载是好的？

**A**：预览和下载走不同的链路。预览需要浏览器用 JavaScript 跨域读取资源（需要绕过 CORS），而下载只是触发浏览器的文件下载，不涉及跨域读取。常见原因：

- 文件由 CF 代理预览时网络不稳。
- 文本文件超过 **2MB**，代码直接拒绝在线加载以防浏览器假死。
- 浏览器插件（如广告拦截）拦截了跨域请求。

**解决**：对于 >2MB 文本文件，请下载后用本地编辑器打开；其他情况尝试换用 Chrome 并关闭插件。

---

### Q6：登录后过一会儿突然需要重新登录？

**A**：Token 有效期为 **8 小时**（代码硬编码 `8 * 60 * 60 * 1000 ms`）。Token 过期后，所有 API 请求都会返回 `请先登录` 并跳回登录界面。这是正常的安全机制，重新点击登录按钮即可。

---

### Q7：上传文件时速度很慢，或上传了一半卡住了？

**A**：上传走 `PUT /api/alist-upload`，文件流经过 Vercel/服务端节点中转后再发给 AList。影响上传速度的因素：

1. **当前线路**：管理员如果设置了 `downloadChannel = frp`，则走 FRP 家宽节点，上行带宽有限。
2. **文件大小**：中转上传没有硬性大小限制，但连接时长受平台限制，超大文件（>500MB）可能中途断开。
3. **网络环境**：本地网络到 Vercel 节点的链路质量。

**解决**：联系管理员确认当前线路是否为 ECS（阿里云高速直连）。

---

### Q8：在线预览压缩包内的文件列表失败？

**A**：代码中对部分大型压缩包类型禁用了在线浏览目录功能（出于性能考虑）。请下载压缩包到本地后解压查看。

---

### Q9：搜索功能没有结果，或搜索出来的路径点进去是错的？

**A**：搜索依赖 AList 后端的 `fs/search` 接口，且每次最多返回 5000 条结果。可能的原因：

1. AList 的索引未建立或未刷新（需管理员在 AList 后台操作）。
2. 当前账号没有 `search` 权限（见用户权限面板）。
3. 搜索结果路径包含 `basePath` 前缀，系统会自动去除，若显示异常请刷新重试。

---

### Q10：管理员面板打开空白或报错？

**A**：管理面板（`/api/users`）严格限制仅 `admin` 角色可访问。若以 `manager` 或 `guest` 登录后尝试访问，会直接返回 401 并提示"权限不足，无法访问核心组件"。请确认你的账号角色为 `admin`。

---

## 七、报错信息速查表

以下错误信息均直接来源于代码，对号入座即可定位原因。

---

### 🔐 权限与身份类

| 报错消息 | 原因 | 该怎么办 |
| :--- | :--- | :--- |
| `您的 IP 环境异常，已被防火墙阻断访问` | 当前 IP 被安全策略封禁 | 切换网络（4G/其他 Wi-Fi）重试，或联系管理员解封 |
| `系统已关闭游客访问` | 游客模式已被管理员关闭 | 使用正式账号登录，或联系管理员 |
| `用户名或密码错误` | 账号或密码输入有误 | 仔细核对，注意大小写和多余空格 |
| `请填写用户名和密码` | 有输入框未填写 | 补全用户名和密码后再提交 |
| `服务端配置异常` | 站点配置出现问题 | 联系管理员 |
| `请先登录` | 登录状态已过期（8 小时有效期） | 刷新页面，重新点击登录按钮 |
| `权限不足，无法访问核心组件` | 当前账号没有管理员权限 | 使用管理员账号登录 |
| `权限不足，申请被拦截` | 当前账号没有管理员权限 | 使用管理员账号登录 |

---

### 📁 文件与目录操作类

| 报错消息 | 原因 | 该怎么办 |
| :--- | :--- | :--- |
| `无权浏览子目录` | 当前账号没有浏览子目录的权限 | 联系管理员开放访问权限 |
| `无权搜索文件` | 当前账号没有搜索权限 | 联系管理员开放搜索权限 |
| `无权创建文件夹（需要上传权限）` | 当前账号没有上传/新建权限 | 联系管理员开放上传权限 |
| `无权删除文件` | 当前账号没有删除权限 | 联系管理员开放删除权限 |
| `无权修改文件/文件夹名` | 当前账号没有重命名权限 | 联系管理员开放重命名权限 |
| `缺少 action 参数` / `未知操作` | 页面脚本加载不完整 | 强制刷新浏览器（`Ctrl+F5`），若仍出现请截图联系管理员 |
| `权限不足，无权下载文件` | 当前账号没有下载权限 | 联系管理员开放下载权限 |
| `缺少 path 参数` / `缺少 File-Path 请求头` | 页面脚本加载不完整 | 强制刷新浏览器（`Ctrl+F5`） |
| `权限不足，无权上传文件` | 当前账号没有上传权限 | 联系管理员开放上传权限 |

---

### 🔗 后端服务与下载代理类

| 报错消息 | 原因 | 该怎么办 |
| :--- | :--- | :--- |
| `AList 登录失败` / `AList Token 获取失败` | 站点后端无法连接到存储服务 | 刷新后重试；若持续报错，联系管理员 |
| `AList 网关返回了非 JSON 响应` / `AList 上传接口返回了非 JSON 响应` | 后端服务异常（如服务暂时挂掉） | 稍等片刻后重试；若持续报错，联系管理员 |
| `AList 代理出错` / `下载代理出错` | 后端代理过程中出现临时性异常 | 刷新页面重试；若持续报错，截图联系管理员 |
| `获取文件信息失败` | 文件路径不存在，或后端存储服务暂时不可用 | 刷新目录确认文件还在；如文件存在但仍报错，联系管理员 |
| `下载失败 (403)` | 百度直链已过期，或 UA 校验失败 | 刷新页面后重新点击下载，让系统获取新的直链 |
| `下载失败 (503)` / `下载失败 (502)` | CDN 或中转节点临时不可用 | 稍等 1-2 分钟后重试，或换用其他下载方式 |
| `登录接口异常` / `接口异常` | 服务端临时异常 | 刷新页面重试；若持续报错，联系管理员 |
| `不允许创建额外的 admin 账号` | 系统只允许一个 admin 账号 | 改用 manager 角色创建新账号 |
| `用户名已存在` | 创建用户时用户名重复 | 换一个用户名 |

---

### 🌐 页面打不开 / 所有功能都挂了

遇到页面空白、所有按钮均无响应、或浏览器控制台出现大量 `500`、`fetch failed` 等报错时，通常是**站点后端或存储服务出现了问题**，用户端无法自行解决：

1. **先刷新 1-2 次**——Vercel Serverless 函数冷启动有时需要 10 秒以上，刷新后可能自动恢复。
2. **等待几分钟后重试**——后端服务可能正在重启或自动恢复。
3. **仍无法访问，联系管理员**——告知管理员出现了什么报错或现象即可，附上截图更好。

---

## 八、文件预览支持格式

本站内置预览引擎，支持以下格式直接在浏览器中查看：

- **图片**：`jpg`、`jpeg`、`png`、`gif`、`webp`、`svg`、`bmp`
- **视频**：`mp4`、`webm`、`ogg`
- **文档**：`pdf`（浏览器原生）、`doc/docx/xls/xlsx/ppt/pptx`（微软 Office 在线渲染）
- **代码/文本**：`txt`、`md`、`js`、`ts`、`py`、`json`、`html`、`css`、`yml`等（≤2MB）
- **压缩包**：仅支持列出文件目录（部分类型），不支持在线解压

> [!TIP]
> Office 文档预览使用微软云端接口，需要文件能被公网访问。若预览失败，可尝试下载后在本地打开。

---

*© 2026 成都七中科学技术协会 (STA). All Rights Reserved.*

---

---

# 技术文档（开发者 & AI 阅读）

本文档面向接手项目的开发者和 AI，涵盖完整的技术架构、API 路由、权限系统、下载体系、部署方案和数据库结构。

---

## 目录

- [1. 项目概览（开发者视角）](#1-项目概览开发者视角)
- [2. 技术栈与依赖](#2-技术栈与依赖)
- [3. 项目结构与文件地图](#3-项目结构与文件地图)
- [4. 所有 API 路由速查](#4-所有-api-路由速查)
- [5. 认证体系](#5-认证体系)
- [6. 权限系统](#6-权限系统)
- [7. 下载体系完整说明](#7-下载体系完整说明)
- [8. 前端架构](#8-前端架构)
- [9. 环境变量完整列表](#9-环境变量完整列表)
- [10. 数据库](#10-数据库)
- [11. 部署方案](#11-部署方案)
- [12. 已知问题与待办](#12-已知问题与待办)

---

## 1. 项目概览（开发者视角）

**STA-PAN** 是成都七中科协的百度网盘文件共享平台。技术架构为 **Next.js 16 + AList + Supabase**。

核心理念：前端和后端均通过 Vercel Serverless / ECS Node.js 调用 AList 的 REST API，AList 作为百度网盘的桥接层。

- **前端**：React 19 单文件组件（`page.tsx`），共 ~3800 行
- **后端**：15 个 API Route，通过 AList REST API 操作百度网盘
- **数据**：Supabase PostgreSQL 存储用户、设置、日志
- **认证**：自研 HMAC-SHA256 Token，有效期可配置（默认 8h）
- **权限**：三级角色 + 12 项权限位 + 正则文件级规则

---

## 2. 技术栈与依赖

| 层 | 技术 | 用途 |
|---|---|---|
| 框架 | Next.js 16.1 (Turbopack) | App Router, API Routes |
| UI | React 19.2 + Tailwind CSS 4 | 单文件组件，暗色毛玻璃主题 |
| 数据库 | Supabase (PostgreSQL) | 用户、设置、操作日志、访问记录 |
| 网盘后端 | AList | 百度网盘驱动，REST API 桥接 |
| ZIP 打包 | archiver 7.0 | 流式 ZIP 生成 |
| 流 | Web ReadableStream | Vercel 兼容的流式响应 |
| 类型检查 | TypeScript 5 | 全项目类型覆盖 |

**`package.json` 核心依赖**：

```json
{
  "next": "16.1.6",
  "react": "19.2.3",
  "react-dom": "19.2.3",
  "@supabase/supabase-js": "^2.98.0",
  "archiver": "^7.0.1",
  "tailwindcss": "^4"
}
```

---

## 3. 项目结构与文件地图

```
baidu-pan-alist/
├── .env.local                         # 环境变量（不应提交 Git）
├── next.config.ts                     # Next.js 配置
├── package.json
├── tsconfig.json
├── README.md                          # 用户手册 + 本文档
│
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # 根布局（HTML head 等）
│   │   ├── page.tsx                   # ★★★★★ 全部前端逻辑（~3800行）
│   │   │                              # 包含：登录、文件浏览、预览、下载、
│   │   │                              # 上传、管理面板、权限面板、操作日志
│   │   │
│   │   └── api/
│   │       ├── _auth.ts               # Token 签发/验证（HMAC-SHA256）
│   │       ├── _auth-edge.ts          # Edge Runtime 鉴权（未使用）
│   │       │
│   │       │  ┌── 核心 AList 代理 ──┐
│   │       ├── alist/route.ts         # ★ AList 代理：list/get/search/
│   │       │                          #   mkdir/remove/rename/archive
│   │       ├── alist-download/route.ts   # 单文件下载（UA 处理 + 流代理）
│   │       ├── alist-upload/route.ts     # 文件上传（直连 + Vercel 降级）
│   │       ├── alist-token/route.ts      # 获取 AList JWT（缓存 47h）
│   │       │
│   │       │  ┌── ZIP 打包 ──┐
│   │       ├── alist-zip-preview/route.ts   # 目录文件计数
│   │       ├── alist-zip-download/route.ts  # ★ 流式 ZIP（T1/T2/T3 降级）
│   │       ├── alist-batch-list/route.ts    # 文件清单（T2 逐个下载用）
│   │       ├── alist-batch-download/route.ts # alist 归档（未生效，备用）
│   │       │
│   │       │  ┌── 认证与管理 ──┐
│   │       ├── login/route.ts            # 登录/游客
│   │       ├── users/route.ts            # 用户管理（仅 admin）
│   │       ├── global-settings/route.ts  # 公开配置
│   │       ├── admin-stats/route.ts      # 统计数据（支持日志查看权限）
│   │       ├── file-permissions/route.ts # 文件权限规则 + 正则预览
│   │       │
│   │       │  ┌── 日志 ──┐
│   │       ├── log-action/route.ts   # 操作日志入库
│   │       └── track/route.ts        # 访问记录入库
│   │
│   ├── lib/
│   │   └── users.ts                  # ★★★★★ 核心库
│   │                                 # 接口：UserPermissions, FilePermissionRule,
│   │                                 #       GlobalSettings
│   │                                 # 函数：getSettings, updateSettings,
│   │                                 #       getUserPermissions, getUsers,
│   │                                 #       addUser, removeUser, findUser,
│   │                                 #       getEffectivePermissionsForPath,
│   │                                 #       ruleMatchesTarget, normalizePath,
│   │                                 #       canManageFilePermissions 等
│   │
│   ├── data/
│   │   └── changelog.json            # 版本更新日志
│   │
│   └── types/
│       └── archiver.d.ts             # archiver 类型声明
│
└── docs/
    └── baidu-pan-alist-tech.md       # 早期技术文档
```

---

## 4. 所有 API 路由速查

所有路由为 Next.js App Router，统一前缀 `/api`。

### 4.1 AList 代理 — `/api/alist`

**方法**：POST  
**鉴权**：Bearer Token（用户自己的 JWT）  
**请求体**：`{ action, path?, name?, names?, newName?, dir_name?, parent?, keywords?, scope? }`

| action | AList API | 权限检查 | 说明 |
|--------|-----------|----------|------|
| `list` | `/api/fs/list` | view/download/preview | 列出目录，过滤无权限文件，附加 `current_perms` |
| `get` | `/api/fs/get` | view/download/preview | 获取文件详情（raw_url, sign） |
| `search` | `/api/fs/search` | search | 搜索，支持 scope: 0(当前) / 1(递归) |
| `mkdir` | `/api/fs/mkdir` | upload | 创建文件夹 |
| `remove` | `/api/fs/remove` | delete | 删除文件/文件夹 |
| `rename` | `/api/fs/rename` | rename | 重命名 |
| `list_archive` | `/api/fs/other` | - | 查看压缩包内容 |
| `archive` | `/api/fs/other` | - | AList 归档打包（未生效） |

**渠道选择**：读取 `settings.downloadChannel` 决定用 ECS（主）或 FRP（备）。

**basePath 处理**：用户有虚根（basePath）时，路径自动拼接前缀。

**自定义配置**：前端可选传 `x-alist-url/user/pass` 头，覆盖全局 AList 地址（⚙️ 设置功能）。

### 4.2 单文件下载 — `/api/alist-download`

**方法**：GET  
**参数**：`?path=xxx&token=xxx&preview=1`  
**鉴权**：token 或 Authorization header  
**权限**：`download`（下载）/ `preview`（预览）

**处理逻辑**：
1. 获取 AList 文件信息 (`/api/fs/get`)
2. 如果 `raw_url` 指向百度 (`baidupcs.com` / `baidu.com`)，下载时加 `User-Agent: pan.baidu.com`
3. 否则通过 AList 代理 `/p/` 端点下载

### 4.3 文件上传 — `/api/alist-upload`

**方法**：PUT  
**Header**：`File-Path`（URL 编码的目标路径）、`Authorization`  
**权限**：`upload`  
**流程**：优先直连 ECS（跨域可能失败），降级 Vercel 代理

### 4.4 ZIP 打包下载 — `/api/alist-zip-download`

**方法**：GET  
**参数**：`?paths=["/a/b","/c/d"]&token=xxx`  
**导出**：`maxDuration = 300`（Vercel Pro）

**三层降级**：

| 层级 | 策略 | 实现 |
|------|------|------|
| T1 首选 | AList `/p/` 直链 | `fetch(url/p/path?sign=sign, {Authorization})` |
| T2 降级 | 百度 CDN | `fetch(raw_url, {UA: 'pan.baidu.com'})` |
| T3 保底 | 跳过 | 以上均失败，`totalFailed++` |

**流程**：
1. 预扫描：列文件 → 逐文件权限检查 → 统计跳过数
2. 响应头设 `X-Skipped-Files`
3. 流式生成 ZIP（`archiver` + `ReadableStream`）
4. 6 并发下载文件

### 4.5 ZIP 预览 — `/api/alist-zip-preview`

**方法**：GET  
**返回**：`{ dirs: [{name, fileCount}] }`  
**鉴权**：同 download

### 4.6 批量文件清单 — `/api/alist-batch-list`

**方法**：GET  
**参数**：`?paths=["..."]&token=xxx`  
**返回**：`{ files: [{name, path, sign, size, relativePath}], totalFiles, totalSize, skipped }`  
**鉴权**：逐文件 `download` 权限  
**用途**：T2 逐个下载时获取直链清单

### 4.7 批量下载（alist 归档）— `/api/alist-batch-download`

**方法**：GET  
**状态**：未生效，保留备用。原计划调 alist `/api/fs/other {method:'archive'}`

### 4.8 登录 — `/api/login`

**方法**：POST  
**请求体**：`{ username, password }` 或 `{ guest: true }`  
**返回**：`{ token, role, username, permissions }`  
**游客限制**：需 `settings.enableGuestMode === true`  
**Token 有效期**：`settings.sessionDurationHours`，默认 8h  
**IP 检查**：封禁 IP 拒绝登录

### 4.9 用户管理 — `/api/users`

**方法**：GET / POST  
**鉴权**：仅 admin

| action | 说明 |
|--------|------|
| GET | 返回用户列表 + 全局设置 |
| `add` | 添加用户 |
| `remove` | 删除用户 |
| `updateRole` | 修改角色 |
| `updateSettings` | 更新全局设置 |
| `changeAdminPassword` | 修改管理员密码 |
| `updatePermissions` | 修改用户权限位 |
| `updateFilePermissionRules` | 保存文件权限规则 |

### 4.10 全局设置 — `/api/global-settings`

**方法**：GET（公开）  
**返回**：`{ enableGuestMode, downloadChannel, downloadModes, hideAlistButton, announcement }`

### 4.11 管理统计 — `/api/admin-stats`

**方法**：GET  
**鉴权**：admin 或持有任一 `viewStats/viewActionLogs/viewIpStats/viewDownloadLogs` 权限

**返回内容**：
- `channelStats` — 按渠道（ecs/cf/raw/vercel/direct302）统计下载量
- `recentActions` — 最近所有操作（非 admin 不显示 admin 操作）
- `topIps` — IP 访问排行
- `viewLogs` — 详细访问记录
- `allDownloadLogs` — 全量下载记录

### 4.12 文件权限规则 — `/api/file-permissions`

**方法**：GET / POST  
**鉴权**：`controlFile` 权限或 admin

| 操作 | 说明 |
|------|------|
| GET | 返回规则列表 + 可管理用户 |
| POST `{action:'preview'}` | 正则预览：递归列目录 → regex 过滤 → 返回匹配文件列表 |
| POST `{rules:[...]}` | 保存规则 |

### 4.13 日志 — `/api/log-action` & `/api/track`

| 路由 | 方法 | 写入表 | 字段 |
|------|------|--------|------|
| `/api/log-action` | POST | `bdpan_action_logs` | username, action_type, action_item, ip, location |
| `/api/track` | POST | `view_logs` | username, ip, country, region, city, user_agent, page_source |

---

## 5. 认证体系

### 5.1 Token 签发（`_auth.ts`）

```typescript
signToken(username, role, durationHours?) → "{payload}.{sig}"
```

- `payload = base64url(JSON.stringify({ exp: now+ttl, username, role }))`
- `sig = HMAC-SHA256(ADMIN_TOKEN_SECRET, payload) → hex`
- secret 来自环境变量，默认 `'default-secret-change-me'`
- 默认 8 小时，可通过全局设置 `sessionDurationHours` 配置

### 5.2 Token 验证

```typescript
verifyToken(authHeader) → { username, role } | null
```

- 从 `Bearer xxx` 取出 token
- 分割 `.` 得到 payload + sig
- 重新 HMAC 验签 → 解析 payload → 检查 `Date.now() > exp`
- 过期返回 null

### 5.3 角色

```typescript
type Role = 'admin' | 'manager' | 'guest'
```

---

## 6. 权限系统

### 6.1 全局权限位（每个用户）

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
    // 日志查看权限（4 个独立开关）
    viewStats?: boolean;
    viewActionLogs?: boolean;
    viewIpStats?: boolean;
    viewDownloadLogs?: boolean;
}
```

**默认值**：

| 角色 | view | search | download | upload | delete | rename | preview | setting | controlFile | basePath |
|------|------|--------|----------|--------|--------|--------|---------|---------|-------------|----------|
| admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `/` |
| manager | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | `/` |
| guest | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | `/` |

日志 4 权限全部角色默认 **false**（admin 除外——admin 绕过权限检查）。

### 6.2 文件级权限规则

```typescript
interface FilePermissionRule {
    id: string;
    path: string;
    pathType: 'file' | 'dir' | 'regex';
    regexScope?: 'name' | 'path';  // 仅 regex
    groupName?: string;             // 分组名（用于 UI）
    users: string[];                // 适用用户
    deny: {
        view?: boolean;
        search?: boolean;
        download?: boolean;
        upload?: boolean;
        delete?: boolean;
        rename?: boolean;
        preview?: boolean;
    };
    createdAt?: number;
    updatedAt?: number;
}
```

**匹配逻辑** (`ruleMatchesTarget` in `lib/users.ts`):

```
file:  targetPath === rulePath              // 精确文件匹配
dir:   targetPath.startsWith(rulePath + '/')  // 目录前缀匹配
regex: new RegExp(rule.path, 'i').test(
         regexScope === 'name'
           ? targetPath.split('/').pop()    // 仅文件名
           : targetPath                      // 完整路径
       )
```

**存储**：序列化在 `bdpan_settings.value.filePermissionRules[]`。

**生效位置**：
- `alist/route.ts`: list/get 操作逐文件调用 `getEffectivePermissionsForPathCached`
- `alist-download/route.ts`: 下载前调用 `getEffectivePermissionsForPath`
- `alist-upload/route.ts`: 上传前检查
- `alist-zip-download/route.ts`: 打包前预扫描
- `page.tsx` 前端: `item.perms` 已包含规则计算结果

---

## 7. 下载体系完整说明

### 7.1 单文件下载（5 选项）

在 `alistDownloadModal` 中展示：

| # | 名称 | 实现 | 权限检查 | 适用 |
|---|------|------|----------|------|
| ① | 阿里云 ECS | `/api/alist-download`（服务端 UA） | 后端 | 手机首选 |
| ② | Cloudflare | `cf.ryantan.fun/?url=raw_url` | 无（通过 get 取 raw_url） | 海外加速 |
| ③ | 复制直链 | `navigator.clipboard.writeText(raw_url)` | 无（通过 get 取 raw_url） | PC+IDM |
| ④ | Vercel 中转 | `/api/alist-download` | 后端 | 备用 |
| ⑤ | 直链下载 | `window.open(alistBase/p/path?sign=sign)` | 前端 `item.perms.download` | 满速 |

选项 ②③ 复用 `fetchAlist({action:'get'})` 获取文件信息，不经过 `/api/alist-download`。

### 7.2 批量下载

| 模式 | 触发 | 流程 |
|------|------|------|
| T1 ZIP | 选中文件/文件夹 → 批量下载 → "打包下载" | `zip-preview` → `zip-download`（三层降级）|
| T2 逐个 | 选中文件/文件夹 → 批量下载 → "逐个下载" | `batch-list` → 前端逐个 `<a>` 触发 |

### 7.3 权限与下载的关系

**前端拦截**（在 `openAlistItem` / `alistNavigate` / 预览弹窗下载按钮）：
- `item.perms.download === false` → 拒绝下载，显示错误
- `item.perms.preview === false` → 拒绝预览

**后端拦截**：
- 每个 API 路由独立检查 `getEffectivePermissionsForPath`
- ZIP 打包前预扫描过滤被禁文件

---

## 8. 前端架构

### 8.1 文件说明

`page.tsx` 是单体组件（~3800 行），包含全部 UI 和交互逻辑。无路由拆分——整个应用在一个页面内通过状态切换不同视图。

### 8.2 核心状态（约 50+ 个 useState）

| 类别 | 状态 | 说明 |
|------|------|------|
| 认证 | `userToken, userRole, username, userPerms` | 存储 localStorage |
| 登录表单 | `loginUsername, loginPassword, authError, authLoading` | - |
| 文件浏览 | `alistPath, alistFiles, alistLoading, alistError, alistProvider` | - |
| 文件选择 | `alistSelected` (Set) | 批量操作 |
| 搜索 | `alistSearchKeyword, alistSearchScope, alistSearchResults` | - |
| 上传 | `alistUploadFiles, alistUploading, uploadProgress` | - |
| 预览 | `previewFile, previewItemMeta, previewText, previewLoading` | - |
| 下载 | `alistDownloadModal, alistCopyLinkModal, batchModeModal, t2Progress` | - |
| 管理 | `showAdminPanel, adminUsers, adminSettings, adminStats` | - |
| 权限 | `showFilePermPanel, filePermRules, filePermDraft, regexPreview` | - |
| UI | `theme, alistMsg, showManual, showChangelog` | - |

### 8.3 关键函数

| 函数 | 行数 | 说明 |
|------|------|------|
| `fetchAlist()` | 352 | 通用 AList API 调用（带自定义配置头） |
| `alistListDir()` | 574 | 列出目录 |
| `alistSearchFast()` | 710 | 搜索（多关键词合并） |
| `openAlistItem()` | 881 | 点击文件 → 预览/下载决策 |
| `alistProxyDownload()` | 909 | 代理下载（经 `/api/alist-download`） |
| `alistBatchDownload()` | 992 | 批量下载入口 |
| `alistBatchDownloadFolders()` | 1047 | T1 ZIP 打包 |
| `alistBatchDownloadT2()` | 1030 | T2 逐个下载 |
| `logUserAction()` | 342 | 操作日志上报 |
| `fetchAdminData()` | 1355 | 拉管理面板数据 |
| `submitFilePermissionDraft()` | 1472 | 保存文件权限规则 |

### 8.4 组件树结构

```
<Home>
├── 登录页（未认证时）
└── 主应用（已认证）
    ├── 头部状态栏（角色/用户名/主题/管理/日志/设置/退出）
    ├── 消息提示（Toast）
    ├── 文件列表面板
    │   ├── 工具栏（新建/上传/搜索/刷新/选中/批量下载）
    │   ├── 文件行（图标/名称/大小/时间/预览/下载/删除/重命名 按钮）
    │   └── 拖拽上传区域
    ├── 下载弹窗（5 选 1）
    ├── 批量下载选择弹窗（T1/T2）
    ├── 预览弹窗（图片/视频/PDF/文本/Office）
    ├── 管理面板（数据统计/操作日志/IP统计/用户管理/全局设置）
    ├── 文件权限面板（规则编辑/预览/已有规则）
    ├── 设置面板
    ├── 更新日志弹窗
    └── 使用手册弹窗
```

---

## 9. 环境变量完整列表

```bash
# ====== AList ======
NEXT_PUBLIC_ALIST_URL=https://pan.tantantan.tech:5245
# AList 主地址（用户浏览器也直连下载用）

NEXT_PUBLIC_ALIST_URL_FALLBACK=https://frp-gap.com:37492
# AList 备地址（FRP）

ALIST_USERNAME=admin
ALIST_PASSWORD=你的密码

ALIST_USERNAME_FALLBACK=
ALIST_PASSWORD_FALLBACK=

# ====== Supabase ======
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...

# ====== Auth ======
ADMIN_TOKEN_SECRET=<32位以上随机字符串>
# 用于 JWT HMAC 签名。务必修改默认值

# ====== Node（仅 ECS 部署需要）=======
NODE_OPTIONS=--max-old-space-size=1024
```

---

## 10. 数据库

所有表在 Supabase PostgreSQL 的 `public` schema 中。

### 10.1 `bdpan_users` — 用户账号

| 列 | 类型 | 说明 |
|---|---|---|
| id | int8 | 主键 |
| username | text | 用户名（含 admin/guest） |
| password | text | 明文密码 |
| role | text | admin / manager / guest |

### 10.2 `bdpan_settings` — 全局设置（单行）

| 列 | 类型 | 说明 |
|---|---|---|
| key | text | 始终 `'global'` |
| value | jsonb | 所有全局配置 |

`value` 结构（即 `GlobalSettings` 类型）：

```json
{
  "enableGuestMode": true,
  "permissions": {
    "manager1": { "view": true, "download": false, "viewStats": true }
  },
  "filePermissionRules": [
    {
      "id": "rule_1718000000000",
      "path": "密码|密钥",
      "pathType": "regex",
      "regexScope": "path",
      "users": ["guest"],
      "deny": { "download": true, "preview": true, "delete": true }
    }
  ],
  "downloadChannel": "ecs",
  "downloadModes": {
    "ecs": "enabled",
    "cf": "enabled",
    "raw": "enabled",
    "vercel": "disabled",
    "direct302": "enabled"
  },
  "bannedIps": { "1.2.3.4": 1781300000000 },
  "hideAlistButton": true,
  "announcement": "",
  "sessionDurationHours": 8
}
```

### 10.3 `bdpan_action_logs` — 操作日志

| 列 | 类型 | 说明 |
|---|---|---|
| id | int8 | 主键 |
| username | text | 操作者 |
| action_type | text | 如 `"下载 - ECS - 被拦截"` |
| action_item | text | 如 `"/sta/密码.txt"` |
| ip | text | IP 地址 |
| location | text | 通过 ip-api.com 查询 |
| log_text | text | 完整描述 |
| created_at | timestamptz | 自动 |

`action_type` 命名规范：
- 成功：`下载 - {渠道名}`
- 被拦截：`下载 - {渠道名} - 被拦截`
- 失败：`下载 - {渠道名} - 失败`

### 10.4 `view_logs` — 访问记录

| 列 | 类型 | 说明 |
|---|---|---|
| id | int8 | 主键 |
| ip_address | text | 访问者 IP |
| username | text | 已登录则记录用户名，访客为 `null` |
| user_agent | text | 浏览器信息 |
| country / region / city | text | IP 定位 |
| page_source | text | 固定 `'pan'` |
| visit_time | timestamptz | 自动 |

---

## 11. 部署方案

### 11.1 Vercel（当前生产）

1. GitHub 关联 `stacdqz/bd-pan`
2. 设置所有环境变量
3. 自动构建部署

**限制**：
- 免费版最大执行时间 10s
- 响应体限制 4.5MB
- 海外边缘节点 → 国内 ECS 延迟高（ZIP 下载慢）

### 11.2 自有 ECS（推荐）

**前提**：2C2G+、宝塔面板、Nginx + PM2、已备案域名

```bash
# 1. 拉代码
cd /www/wwwroot && git clone https://github.com/stacdqz/bd-pan.git
cd bd-pan && npm install

# 2. 创建 .env.local（内容同上）

# 3. 加速：本地解析到 AList
echo "127.0.0.1 pan.tantantan.tech" >> /etc/hosts

# 4. 构建
npm run build

# 5. PM2 启动
# 宝塔 → PM2 管理器 → 添加项目
# 启动文件: /www/wwwroot/bd-pan/node_modules/.bin/next
# 运行参数: start -p 3000
# 名称: bdpan

# 6. Nginx 反代
# 宝塔 → 网站 → 添加站点 → 配置 SSL
# location / { proxy_pass http://127.0.0.1:3000; proxy_read_timeout 300s; }
```

**更新**：
```bash
cd /www/wwwroot/bd-pan && git pull && npm run build && pm2 restart bdpan
```

### 11.3 域名方案

| 域名 | 指向 | 用途 |
|------|------|------|
| `pan.cdqzsta.tech` | Vercel | 前端（已部署） |
| `pan.tantantan.tech` | ECS:5245 | AList 服务 |
| `test.cdqzsta.tech` | ECS:3000 (Nginx) | Next.js ECS 部署 |

---

## 12. 已知问题与待办

| # | 问题 | 影响 | 方案 |
|---|------|------|------|
| 1 | Vercel 超时/载荷限制 | ZIP 大文件夹失败 | 部署到 ECS |
| 2 | 移动端 T2 逐个下载 | iOS 只允许单下载 | 加大间隔（2000ms），用户手动确认 |
| 3 | alist archive API 未生效 | 无 alist 服务器端打包 | `/api/alist-batch-download` 代码保留备用 |
| 4 | `page.tsx` 单体 3800 行 | 维护困难 | 拆分为组件 |
| 5 | 无自动化测试 | 回归依赖人工 | 加 `playwright` 或 `testing-library` |
| 6 | 文件权限规则预览依赖 alist search 索引 | 搜索不到文件（需管理员建索引） | 提示用户检查 AList 搜索索引 |
| 7 | 并发下载限制 6 | 大文件夹打包慢 | ECS 上可调大到 10+ |

