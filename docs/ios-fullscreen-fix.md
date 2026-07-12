# iOS PDF 全屏修复 & 工具栏优化

> 日期：2026-07-12
> 状态：已编码，待测试，待部署

---

## 问题

| # | 现象 | 根因 |
|---|------|------|
| 1 | iPhone 点全屏按钮没反应 | iOS 16.4+ Safari 的 `document.fullscreenEnabled` 返回 `true`（它只支持 `<video>` 全屏），但 `requestFullscreen()` 对普通元素**静默无反应**——不报错也不进 `.catch()`，导致 postMessage 回退不会执行 |
| 2 | iPad 原生全屏工具栏挡住 PDF 顶部（日期等） | 工具栏 `position:fixed; top:0` 覆盖了页面内容 |
| 3 | 本地改 viewer.html 后 iPhone 测试无效 | iframe 的 viewer.html 是从 `API_BASE`（`https://pan.tantantan.tech/wlm-api/pdfjs/viewer.html`）加载的，即生产环境旧文件，本地改动没被用到 |

---

## 已完成的改动

两个项目（baidu-pan-alist 和 pan-vlm）均已完成，**共 6 个文件**。

### 1. `public/pdfjs/viewer.html` — iOS 全屏逻辑 + 工具栏移到底部

**全屏按钮逻辑**：UA 检测 `iPhone|iPad|iPod` → iOS 全系走 postMessage 通知父页面 CSS 全屏，非 iOS 走原生 Fullscreen API。

```
点击全屏 → 检测 navigator.userAgent
  ├─ iOS (iPhone/iPad) → window.parent.postMessage({ type: 'toggle-pdf-fullscreen' }, '*')
  └─ 非 iOS            → document.documentElement.requestFullscreen()
```

F 键同理。

**工具栏 CSS**：`position:fixed; bottom:0` 统一移到底部（原来是 `top:0`），不再遮挡 PDF 顶部。`viewerContainer` 改为 `top:0; bottom:28px`。

### 2. `src/app/page.tsx` — CSS 全屏模式 + iframe 路径修复

**新增**：
- `previewFullscreen` 状态（boolean）
- `previewFullscreenRef`（useRef，供 ESC 闭包读取最新值）
- postMessage 监听 useEffect：接收 `toggle-pdf-fullscreen` 消息 → 切换全屏
- ESC 按键监听：退出 CSS 全屏
- ref 同步 useEffect：保持闭包内 ref 为最新值

**CSS 全屏模式**：
- 外层 div：`fixed inset-0 z-[9999]`, 背景纯黑，不可点击背景关闭
- 内层 div：`w-full h-full`（去掉 `max-w-5xl max-h-[92vh] rounded-3xl`）
- PDF iframe：`h-full`（去掉 `h-[78vh] rounded-lg`）
- 退出全屏按钮：全屏模式下工具栏右侧显示"⛶ 退出全屏"
- 关闭按钮 ✕ 同时重置全屏状态

**iframe 路径修复**（关键）：
```diff
- const pdfJsUrl = `${API_BASE}/pdfjs/viewer.html?file=${encodeURIComponent(previewUrl)}`;
+ const pdfJsUrl = `/pdfjs/viewer.html?file=${encodeURIComponent(previewUrl)}`;
```
改为相对路径后，iframe 从**当前页面同源**加载 viewer.html：
- 本地开发：`http://192.168.1.43:3000/pdfjs/viewer.html` ✅ 加载本地修改版
- 生产 Vercel：`https://wlm.cdqzsta.tech/pdfjs/viewer.html` ✅ 加载部署版

---

## 架构：全屏模式下的组件层级

```
page.tsx 预览弹窗 (fixed inset-0 z-[9999])
├── 顶部栏 (page.tsx)
│   ├── 文件名 + 文件大小
│   ├── 下载按钮
│   ├── ✕ 关闭（同时退出全屏）
│   └── ⛶ 退出全屏（仅全屏时显示）
│
└── 内容区 (flex-1)
    └── <iframe src="/pdfjs/viewer.html">
        ├── PDF 渲染区 (Panzoom)
        └── 工具栏 (bottom:0, position:fixed)
            ├── ◀ 上一页 | 页码 | ▶ 下一页
            ├── 缩放
            └── ⛶ 全屏（退出时通知父页面）
```

---

## 未完成 / 待确认

### 🔴 必须测试

1. **iPhone 全屏**：Safari 打开 PDF → 点全屏按钮 → 应看到 CSS 全屏（预览撑满屏幕 + 顶部有"退出全屏"按钮）
2. **iPad 全屏**：同上，确认工具栏在底部不挡内容
3. **桌面 Chrome 全屏**：应走原生 Fullscreen API，工具栏在底部
4. **ESC 退出全屏**：全屏状态下按 ESC 应退出 CSS 全屏

### 🟡 待优化

5. iOS CSS 全屏无法隐藏 Safari 地址栏（系统限制，无解），但 PDF 会铺满整个视口
6. CSS 全屏模式下有两层工具栏：page.tsx 的头部栏（文件信息 + 按钮）+ viewer.html 的底部工具栏（页码 + 缩放），可考虑在全屏模式下隐藏 viewer.html 的工具栏，把页码/缩放控件上移到 page.tsx 头部栏

### 🟢 其他

7. [device-id-uuid-plan.md](device-id-uuid-plan.md) — 设备码 UUID 化方案，已完成设计但未实施
8. 两端代码改完后均 **未 push 未部署**，仍在本地
