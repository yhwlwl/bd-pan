# 设备码 UUID 化 + 多存储持久化 方案

> 日期：2026-07-11
> 状态：待实施

---

## 问题

当前设备码基于 Canvas + WebGL 浏览器指纹 FNV-1a hash，三个问题：

| 问题 | 原因 |
|------|------|
| 跨浏览器不同 | 同一手机 Chrome/Safari/微信 → Canvas/WebGL 渲染结果不同 |
| 浏览器更新变 | Canvas 渲染引擎变化 → 设备码也变 |
| 清 localStorage 丢 | 唯一的存储位置，清了就重新算 |

## 目标

改为随机 UUID + 4 层客户端存储 + 1 层服务端 cookie，同一浏览器内设备码永不丢失。

跨浏览器问题纯前端无解（Cookie/localStorage 不跨浏览器共享），但 deny 系统已有的"IP ↔ device 关联查看"功能可辅助人工判断。

---

## 改动清单

两个项目都要改（baidu-pan-alist 和 pan-vlm，代码完全对称），共 **8 个文件**。

### 1. `src/app/page.tsx` — 核心改动

**删除** `computeDeviceCode()` 函数（~40 行 Canvas/WebGL 指纹逻辑）

**新增** `getOrCreateDeviceCode()` 函数：
```
恢复优先级：localStorage → IndexedDB → Cache Storage → 生成新 UUID
读到后立即同步回所有缺失的存储位置
```

**新增** `syncDeviceCodeToAllStores(uuid)` 函数，四层写入：

| 层 | 存储 | Key | 说明 |
|:--|------|-----|------|
| 1 | `localStorage` | `BDPAN_DEVICE_CODE` | 最常用，最容易被清 |
| 2 | `IndexedDB` | db: `bdpan`, store: `device`, key: `code` | 较少被清 |
| 3 | `Cache Storage` | cache: `bdpan-v1`, url: `/__device_id__` | 仅手动清缓存才丢 |
| 4 | `document.cookie` | `BDPAN_DEVICE_ID` (非 HttpOnly) | 客户端也可读 |

**修改** `useEffect` 挂载逻辑：
```diff
- if (!localStorage.getItem('BDPAN_DEVICE_CODE')) {
-   try { localStorage.setItem('BDPAN_DEVICE_CODE', computeDeviceCode()); } catch {}
- }
+ getOrCreateDeviceCode().then(code => { /* 已持久化到所有层 */ }).catch(() => {});
```

**保留** `fetchAlist()` 和 `logUserAction()` 中的读取逻辑不变（继续从 `localStorage` 读）。

### 2. `nginx/403.html` — 同步替换

**删除** `computeDeviceCode()` 函数副本（~35 行）

**改为** 从 localStorage 读取 `BDPAN_DEVICE_CODE`；没有则发送空字符串（服务端会 `computeServerFallback(IP+UA)` 兜底）

### 3. `src/app/api/login/route.ts` — 服务端 HttpOnly cookie（第 5 层兜底）

登录成功时设置 HttpOnly cookie：
```typescript
// 比客户端 4 层更持久——清浏览器数据不会清 HttpOnly cookie（除非专门清 cookie）
response.headers.append('Set-Cookie',
  `BDPAN_DEVICE_ID=${encodeURIComponent(deviceCode)}; Max-Age=315360000; Path=/; HttpOnly; SameSite=Lax`);
```

### 4. `src/lib/deny-tracker.ts` — getRequestContext 加 cookie 回退

在 `getRequestContext()` 函数中，如果 `X-Device-Code` header 没有值，从 cookie 解析：
```typescript
// 兜底：客户端清空 localStorage 后，从服务端 cookie 恢复
const cookieHeader = request.headers.get('cookie') || '';
const deviceIdMatch = cookieHeader.match(/BDPAN_DEVICE_ID=([^;]+)/);
const deviceCode = request.headers.get('x-device-code') 
  || (deviceIdMatch ? decodeURIComponent(deviceIdMatch[1]) : undefined);
```

### 5. `src/lib/fingerprint.ts` — 无改动

`hashDeviceCode()` 对 UUID 输入同样有效（SHA256 → 16 hex chars）。保留 `computeServerFallback()` 作为无 JS 客户端的兜底。

---

## 不改什么

| 不改 | 原因 |
|------|------|
| `deny-tracker.ts` 其他函数 | logDenyEvent/checkEntityBanned 不依赖设备码格式 |
| 所有 API route | 只传递设备码值，不关心格式 |
| 数据库表结构 | device_code 列存原值，device_code_hash 列存 hash，UUID 无需新列 |
| deny 实体关联查看 | 已按 device_code_hash 关联，UUID/hash 无区别 |

---

## 兼容性

- **存量数据**：旧 Canvas 指纹的设备码仍合法，新 UUID 设备码也合法，同表共存
- **403.html**：localStorage 被清且在 Nginx deny 时 → 发送空值 → 服务端 fallback 兜底
- **首次访问**：生成新 UUID → 登录后 cookie 被设置 → 后续即使清 localStorage 也能恢复

---

## 验证步骤

1. `npm run dev` 启动，打开浏览器
2. 检查 `localStorage.BDPAN_DEVICE_CODE` → 应为 UUID 格式（`550e8400-e29b-41d4-a716-446655440000`）
3. 检查 IndexedDB: `bdpan` → `device` → `code` → 同上值
4. 检查 Cache Storage: `bdpan-v1` → `/__device_id__` → 同上值
5. 检查 `document.cookie`: `BDPAN_DEVICE_ID` → 同上值
6. **测试恢复**：清空 localStorage → 刷新 → `BDPAN_DEVICE_CODE` 应从 IndexedDB/Cache 恢复回原值
7. **测试 cookie**：登录后检查 Network 响应头 `Set-Cookie: BDPAN_DEVICE_ID=...`
8. **终极测试**：清空所有客户端存储 → 刷新 → API 请求带 cookie → getRequestContext 从 cookie 恢复设备码
