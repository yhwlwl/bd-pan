"use client";

import { useState, useEffect } from "react";
import { useAdmin } from "../lib/admin-context";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://pan.tantantan.tech/wlm-api";

const SCORE_LABELS: Record<string, string> = {
  nginx_db_token: "Nginx Token 探测",
  nginx_sensitive_file: "Nginx 敏感文件访问",
  nginx_pdf_referer: "Nginx PDF 盗链",
  nginx_well_known: "Nginx 漏洞扫描",
  nginx_unknown: "Nginx 其他拦截",
  api_ip_banned: "已封禁 IP 尝试访问",
  api_auth_failed: "API 认证失败",
  api_login_failed: "API 登录失败",
  api_role_denied: "API 越权访问",
  api_permission_denied: "API 权限拒绝",
  api_file_rule_denied: "API 文件规则拒绝",
  api_all_items_denied: "API 批量操作全拒",
};

const DEFAULT_SCORES: Record<string, number> = {
  nginx_db_token: 30, nginx_sensitive_file: 20, nginx_pdf_referer: 10,
  nginx_well_known: 15, nginx_unknown: 10, api_ip_banned: 25,
  api_auth_failed: 5, api_login_failed: 8, api_role_denied: 10,
  api_permission_denied: 5, api_file_rule_denied: 5, api_all_items_denied: 5,
};

export default function Settings() {
  const { adminSettings, adminAction, fetchAllData, canModify, token } = useAdmin();
  const [msg, setMsg] = useState<string | null>(null);
  const [s, setS] = useState<any>({});
  // 安全设置
  const [adminPw, setAdminPw] = useState("");
  const [newAdminPw, setNewAdminPw] = useState("");
  // 风控阈值
  const [dt, setDt] = useState<any>({});
  // 评分
  const [scores, setScores] = useState<Record<string, number>>({ ...DEFAULT_SCORES });

  useEffect(() => {
    if (adminSettings) {
      setS({ ...adminSettings });
      setDt({ ...(adminSettings.denyTracking || {}) });
      if (adminSettings.denyTracking?.scoreMap) {
        setScores({ ...DEFAULT_SCORES, ...adminSettings.denyTracking.scoreMap });
      }
    }
  }, [adminSettings]);

  const showMsg = (text: string) => { setMsg(text); setTimeout(() => setMsg(null), 3000); };

  const save = async () => {
    const ok = await adminAction("updateSettings", { settings: s });
    if (ok) { showMsg("设置已保存"); fetchAllData(); }
  };

  const saveDt = async () => {
    const merged = { ...s, denyTracking: { ...dt, scoreMap: scores } };
    const ok = await adminAction("updateSettings", { settings: merged });
    if (ok) { showMsg("风控配置已保存"); fetchAllData(); }
  };

  const chPw = async () => {
    if (!adminPw) { showMsg("请输入当前密码"); return; }
    const ok = await adminAction("changeAdminPassword", { password: newAdminPw });
    if (ok) { setAdminPw(""); setNewAdminPw(""); showMsg("密码已修改"); }
  };

  return (
    <div className="space-y-6 pb-12">
      <h2 className="text-lg font-bold text-slate-800">设置</h2>

      {msg && <div className={`px-4 py-2 rounded-lg text-xs font-medium ${msg.includes("已") || msg.includes("成功") ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}`}>{msg}</div>}

      {/* ===== 卡片 1: 安全设置 ===== */}
      <Card title="安全设置">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="当前密码"><input type="password" value={adminPw} onChange={e => setAdminPw(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-36" /></Field>
          <Field label="新密码"><input type="password" value={newAdminPw} onChange={e => setNewAdminPw(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-36" /></Field>
          <button onClick={chPw} disabled={!canModify("settings.changePassword")} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-30">修改密码</button>
        </div>
      </Card>

      {/* ===== 卡片 2: 全局设置 ===== */}
      <Card title="全局设置">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Toggle label="访客模式" checked={s.enableGuestMode !== false} onChange={v => setS({ ...s, enableGuestMode: v })} />
          <Toggle label="隐藏 AList 按钮" checked={s.hideAlistButton === true} onChange={v => setS({ ...s, hideAlistButton: v })} />
          <NumField label="会话时长 (小时)" value={s.sessionDurationHours ?? 8} min={1} max={720} onChange={v => setS({ ...s, sessionDurationHours: v })} />
          <NumField label="后台刷新间隔 (秒)" value={s.refreshInterval ?? 60} min={10} max={3600} onChange={v => setS({ ...s, refreshInterval: v })} />
        </div>

        <button onClick={save} disabled={!canModify("settings.global")} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-30 mt-4">保存设置</button>
      </Card>

      {/* ===== 卡片 3: 站点外观 ===== */}
      <Card title="站点外观">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="站点标题 (header)"><input value={s.siteTitle || ""} onChange={e => setS({ ...s, siteTitle: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full" placeholder="默认: 成都七中STA·科协网盘" /></Field>
          <Field label="登录副标题"><input value={s.siteSubtitle || ""} onChange={e => setS({ ...s, siteSubtitle: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full" placeholder="默认: 未来梦在线阅读平台" /></Field>
          <Field label="页脚文字"><input value={s.siteFooter || ""} onChange={e => setS({ ...s, siteFooter: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full" placeholder="默认: 成都七中科学技术协会 (STA)" /></Field>
          <Field label="默认视图模式">
            <select value={s.defaultViewMode || "grid"} onChange={e => setS({ ...s, defaultViewMode: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <option value="grid">缩略图</option>
              <option value="list">列表</option>
            </select>
          </Field>
          <NumField label="文本预览上限 (MB)" value={s.textPreviewMaxMB ?? 2} min={1} max={50} onChange={v => setS({ ...s, textPreviewMaxMB: v })} />
        </div>
        <button onClick={save} disabled={!canModify("settings.appearance")} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-30 mt-4">保存设置</button>
      </Card>

      {/* ===== 卡片 4: 风控阈值 ===== */}
      <Card title="风控阈值">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <Toggle label="风控总开关" checked={dt.enabled !== false} onChange={v => setDt({ ...dt, enabled: v })} />
          <NumField label="警告阈值" value={dt.warnThreshold ?? 30} min={1} max={200} onChange={v => setDt({ ...dt, warnThreshold: v })} />
          <NumField label="设备封禁阈值" value={dt.deviceBanThreshold ?? 50} min={1} max={200} onChange={v => setDt({ ...dt, deviceBanThreshold: v })} />
          <NumField label="IP 封禁阈值" value={dt.ipBanThreshold ?? 70} min={1} max={200} onChange={v => setDt({ ...dt, ipBanThreshold: v })} />
          <NumField label="IP 解封后重置分" value={dt.ipPostBanScore ?? 60} min={0} max={200} onChange={v => setDt({ ...dt, ipPostBanScore: v })} />
          <NumField label="设备解封后重置分" value={dt.devicePostBanScore ?? 40} min={0} max={200} onChange={v => setDt({ ...dt, devicePostBanScore: v })} />
        </div>
        <button onClick={saveDt} disabled={!canModify("settings.denyConfig")} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-30">保存风控阈值</button>
      </Card>

      {/* ===== 卡片 5: 风控评分规则 ===== */}
      <Card title="风控评分规则">
        <p className="text-xs text-slate-400 mb-3">每种触发行为的基础加分值</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
          {Object.entries(SCORE_LABELS).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-2">
              <span className="text-xs text-slate-600 truncate" title={label}>{label}</span>
              <input type="number" min={0} max={100} value={scores[key] ?? DEFAULT_SCORES[key] ?? 5}
                onChange={e => setScores({ ...scores, [key]: parseInt(e.target.value) || 0 })}
                className="w-14 text-xs text-center border border-slate-200 rounded px-1.5 py-1 bg-white" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <NumField label="衰减窗口 (小时)" value={dt.decayWindowHours ?? 24} min={1} max={720} onChange={v => setDt({ ...dt, decayWindowHours: v })} />
          <NumField label="去重窗口 (分钟)" value={dt.dedupWindowMinutes ?? 5} min={1} max={60} onChange={v => setDt({ ...dt, dedupWindowMinutes: v })} />
        </div>
        <button onClick={saveDt} disabled={!canModify("settings.denyConfig")} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-30 mt-4">保存评分规则</button>
      </Card>

      {/* ===== 卡片 6: 阶梯封禁规则 ===== */}
      <Card title="阶梯封禁规则">
        <p className="text-xs text-slate-400 mb-3">触發封禁后逐级加重</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <NumField label="首次封禁 (分钟)" value={dt.firstBanMinutes ?? 10} min={1} max={1440} onChange={v => setDt({ ...dt, firstBanMinutes: v })} />
          <NumField label="二次封禁 (小时)" value={dt.secondBanHours ?? 1} min={1} max={720} onChange={v => setDt({ ...dt, secondBanHours: v })} />
          <NumField label="三次及以上 (小时)" value={dt.thirdBanHours ?? 24} min={1} max={720} onChange={v => setDt({ ...dt, thirdBanHours: v })} />
          <NumField label="升级事件数阈值" value={dt.banEscalationThreshold ?? 15} min={1} max={1000} onChange={v => setDt({ ...dt, banEscalationThreshold: v })} />
        </div>
        <button onClick={saveDt} disabled={!canModify("settings.denyConfig")} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-30 mt-4">保存封禁规则</button>
      </Card>

      {/* ===== 卡片 7: 登录与频率限制 ===== */}
      <Card title="登录与频率限制">
        <p className="text-xs text-slate-400 mb-3">0 = 不限制</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <NumField label="最大失败登录次数" value={s.maxFailedLogins ?? 0} min={0} max={100} onChange={v => setS({ ...s, maxFailedLogins: v })} />
          <NumField label="失败计数窗口 (分钟)" value={s.failedLoginWindowMinutes ?? 15} min={1} max={1440} onChange={v => setS({ ...s, failedLoginWindowMinutes: v })} />
          <NumField label="同IP最大并发会话" value={s.maxConcurrentSessions ?? 0} min={0} max={100} onChange={v => setS({ ...s, maxConcurrentSessions: v })} />
        </div>
        <button onClick={save} disabled={!canModify("settings.loginLimits")} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-30 mt-4">保存限制</button>
      </Card>

      {/* ===== 卡片 8: 文件操作限制 ===== */}
      <Card title="文件操作限制">
        <p className="text-xs text-slate-400 mb-3">0 = 不限制</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumField label="单次批量下载上限 (个)" value={s.maxBatchDownload ?? 0} min={0} max={500} onChange={v => setS({ ...s, maxBatchDownload: v })} />
          <NumField label="上传文件大小上限 (MB)" value={s.maxUploadSizeMB ?? 0} min={0} max={10000} onChange={v => setS({ ...s, maxUploadSizeMB: v })} />
        </div>
        <button onClick={save} disabled={!canModify("settings.fileLimits")} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-30 mt-4">保存限制</button>
      </Card>

      {/* ===== 卡片 9: 数据保留 ===== */}
      <Card title="数据保留">
        <p className="text-xs text-slate-400 mb-3">超过天数的日志自动清理。0 = 永久保留</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <NumField label="操作日志保留 (天)" value={s.actionLogRetentionDays ?? 0} min={0} max={3650} onChange={v => setS({ ...s, actionLogRetentionDays: v })} />
          <NumField label="Deny 事件保留 (天)" value={s.denyEventRetentionDays ?? 0} min={0} max={3650} onChange={v => setS({ ...s, denyEventRetentionDays: v })} />
          <NumField label="访问日志保留 (天)" value={s.visitLogRetentionDays ?? 0} min={0} max={3650} onChange={v => setS({ ...s, visitLogRetentionDays: v })} />
        </div>
        <button onClick={save} disabled={!canModify("settings.dataRetention")} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-30 mt-4">保存保留策略</button>
      </Card>

      {/* ===== 卡片 10: 系统 ===== */}
      <Card title="系统">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <a href={`${API_BASE}/api/debug-logs?limit=100`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">服务端日志 &rarr;</a>
          <span className="text-slate-400 text-xs">API: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">{API_BASE}</code></span>
          <span className="text-slate-400 text-xs ml-auto">WLM-PAN v1.0</span>
        </div>
      </Card>
    </div>
  );
}

// ===== 子组件 =====

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-bold text-slate-700 mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] text-slate-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-slate-600">{label}</span>
      <button onClick={() => onChange(!checked)}
        className={`w-10 h-5 rounded-full transition-colors ${checked ? "bg-blue-600" : "bg-slate-300"}`}>
        <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

function NumField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <Field label={label}>
      <input type="number" min={min} max={max} value={value}
        onChange={e => onChange(parseInt(e.target.value) || min)}
        className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-24" />
    </Field>
  );
}
