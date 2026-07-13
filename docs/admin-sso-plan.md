# 管理后台 SSO 认证方案

## 安全目标

| # | 需求 | 手段 |
|:-|------|------|
| 1 | mg token 泄露不影响主站 | 两套密钥分开签名 |
| 2 | 授权码被截获也无法在其他地方使用 | 绑定 IP |
| 3 | URL 不留任何凭证痕迹 | postMessage 传参 |
| 4 | 无有效凭证直接访问 → deny | 302 deny.tantantan.tech |

---

## 架构

```
主站已登录
  │
  ├─ POST /api/mg-sso { Authorization: Bearer <主站token> }
  │   服务端:
  │     1. verifyToken(主站token) → 验证身份
  │     2. 记录请求者 IP → code.ip = 来源IP
  │     3. 生成 8 位随机授权码 → code = 'mg_' + nanoid(8)
  │     4. 存入内存Map{ [code]: { username, role, ip, expireAt: +5min, used: false } }
  │     5. 返回 { code }
  │
  ├─ const win = window.open('/mg', '_blank')
  ├─ win.postMessage({ type: 'mg-auth', code }, '*')
  │
  /mg (layout.tsx)
  │
  ├─ 监听 message 事件
  │   ├─ 收到 { type: 'mg-auth', code }
  │   ├─ POST /api/mg-auth { code }
  │   │   服务端:
  │   │     1. code 不存在 → deny
  │   │     2. code.used === true → deny
  │   │     3. code.expireAt < now → deny
  │   │     4. 请求者 IP !== code.ip → deny + 记 deny 事件
  │   │     5. code.used = true (一次性)
  │   │     6. 用 MG_TOKEN_SECRET 签发 mgToken { scope: 'mg', username, role, exp: 30min }
  │   │     7. 返回 { mgToken }
  │   ├─ mgToken → 存 React state → 渲染管理后台
  │
  ├─ message 事件没收到（手动访问 /mg）
  │   └─ 显示"请从主站获取授权码"引导页
  │
  ├─ token 过期 / 刷新页面
  │   └─ React state 清空 → 回到引导页
  │
  └─ 无效 code / mgToken
       └─ 302 deny.tantantan.tech
```

---

## 新增内容

### 1. 环境变量

```
MG_TOKEN_SECRET=<随机字符串，与 ADMIN_TOKEN_SECRET 不同>
```

### 2. 新文件

| 文件 | 作用 |
|------|------|
| `src/app/api/mg-sso/route.ts` | POST：接收主站token，签发一次性code（绑定IP，5分钟过期） |
| `src/app/api/mg-auth/route.ts` | POST：兑换code，验证IP+未使用+未过期，签发mgToken |
| `src/lib/mg-auth-store.ts` | 内存 Map 管理授权码（codeMap），支持定时清理过期code |
| `src/app/mg/lib/auth-utils.ts` | 客户端工具函数：mgToken 验证、剩余时间计算 |

### 3. 改 layout.tsx

```
当前 layout.tsx:
  ├─ 登录表单（用户名+密码）
  ↓
改后 layout.tsx:
  ├─ message 监听（接收来自主站的授权码）
  ├─ 有 code → POST /api/mg-auth → 进面板
  ├─ 无 code → 显示引导页（"请从主站获取授权码"）
  └─ 引导页包含备用 code 输入框（用户手动粘贴）
```

### 4. 改 page.tsx（主站管理按钮）

```typescript
// 旧: window.open('/mg', '_blank')
// 新:
const handleGoMg = async () => {
  const res = await fetch(`${API_BASE}/api/mg-sso`, {
    headers: { Authorization: `Bearer ${userToken}` },
  })
  const { code } = await res.json()
  const win = window.open('/mg', '_blank')
  setTimeout(() => win?.postMessage({ type: 'mg-auth', code }, '*'), 500)
}
```

---

## 数据流对照

```
发码 (mg-sso)         存码 (mg-auth-store)         收码 (mg-auth)
主站 → POST /api/mg-sso  → Map{code→{username, role, ip, expireAt, used}}
  ↓                        ↓                          ↓
返回 code               code 绑定 IP               POST /api/mg-auth { code }
  ↓                                                    ↓
postMessage → /mg                                    检查: code存在? used=false? IP一致? 未过期?
                                                       ↓ 全部通过
                                                      code.used = true
                                                      签发 mgToken { scope:'mg', role, exp:+30min }
                                                      返回 mgToken
                                                       ↓
                                                    React state → 管理后台
```

## 验证

1. 主站登录 → 点"管理" → 自动打开新标签页 /mg → 直接进入后台
2. 直接访问 `/mg?tab=overview` → 显示引导页"请从主站获取授权码"
3. 引导页手动输入过期/已使用的 code → 提示无效
4. 在不同 IP 尝试兑换 code → 被拒绝 + 记 deny
5. 刷新管理后台 → 回到引导页（token 仅存内存）
6. 30 分钟后 mgToken 过期 → 下次调 API 401 → 引导页
