"use client";

import { useState } from "react";
import { useAdmin } from "../lib/admin-context";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://pan.tantantan.tech/wlm-api";

export default function Emergency() {
  const { adminStats, denyDashboard, adminSettings, adminAction, logAdminAction, fetchAllData, canModify, token } = useAdmin();
  const [loading, setLoading] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const showMsg = (text: string) => { setMsg(text); setTimeout(() => setMsg(null), 5000); };

  // 本地维护状态标记，手动设 false 后无需等后台刷新
  const [localMaintenance, setLocalMaintenance] = useState(true);
  const isMaintenance = adminSettings?.maintenanceSnapshot ? true : (localMaintenance && (adminSettings?.maintenanceMode === true));
  const onlineCount = adminStats?.onlineUsers?.length || 0;
  const deny24h = denyDashboard?.summary?.total24h || 0;
  const riskEntities = (denyDashboard?.summary?.warnCount || 0) + (denyDashboard?.summary?.bannedCount || 0);

  // ===== 维护模式 =====
  const handleMaintenance = async () => {
    if (!confirm("确定进入全站维护模式？\n\n将踢出所有用户、关闭访客和下载、发布维护公告、备份全部数据。")) return;
    setLoading("maintenance");

    // Step 1: 备份全部数据
    try {
      await fetch(`${API_BASE}/api/mg-backup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ label: "维护前自动备份" }),
      });
    } catch {}

    // Step 2: 快照 settings
    const snapshot = JSON.parse(JSON.stringify(adminSettings || {}));
    delete snapshot.maintenanceSnapshot;
    delete snapshot.tokenInvalidBefore;
    delete snapshot.maintenanceMode;

    // Step 3: 写入维护模式
    await adminAction("updateSettings", {
      settings: {
        ...adminSettings,
        maintenanceMode: true,
        tokenInvalidBefore: Date.now(),
        enableGuestMode: false,
        maxUploadSizeMB: 0,
        maxBatchDownload: 0,
        downloadModes: { ecs: "disabled", cf: "disabled", raw: "disabled", vercel: "disabled", direct302: "disabled" },
        maintenanceSnapshot: snapshot,
        announcements: [{
          id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
          content: "站点维护中，请稍后再试",
          active: true, targetAudience: "all" as const, displayLocation: "all" as const, scheduledAt: null,
          publishedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }, ...(adminSettings.announcements || [])],
      },
    });

    logAdminAction("应急", "进入全站维护模式");
    showMsg("维护模式已开启");
    setLoading(null);
    fetchAllData();
  };

  // ===== 恢复运行 =====
  const handleRestore = async () => {
    const snapshot = adminSettings?.maintenanceSnapshot;
    if (!snapshot) { showMsg("无维护快照，无法恢复"); return; }
    if (!confirm("确定恢复站点运行？")) return;
    setLoading("restore");

    const announcements = (snapshot.announcements || []).map((a: any) =>
      a.content === "站点维护中，请稍后再试" ? { ...a, active: false } : a
    );

    await adminAction("updateSettings", {
      settings: {
        ...snapshot,
        announcements,
        maintenanceMode: false,
        tokenInvalidBefore: 0,
        maintenanceSnapshot: undefined,
      },
    });

    setLocalMaintenance(false);
    logAdminAction("应急", "恢复站点运行");
    showMsg("站点已恢复正常");
    setLoading(null);
    fetchAllData();
  };

  // ===== 封禁所有在线 IP =====
  const handleBanAllIPs = async () => {
    if (!confirm("确定封禁所有在线非管理员 IP（1h）？")) return;
    setLoading("ban");

    const ips = (adminStats?.topIps || []).slice(0, 50).map((i: any) => i.ip);
    const bannedUntil = Date.now() + 3600000;
    const newBanned = { ...(adminSettings?.bannedIps || {}) };
    ips.forEach((ip: string) => { newBanned[ip] = bannedUntil; });

    await adminAction("updateSettings", { settings: { ...adminSettings, bannedIps: newBanned } });

    logAdminAction("应急", `批量封禁 ${ips.length} 个 IP (1h)`);
    showMsg(`已封禁 ${ips.length} 个在线 IP (1h)`);
    setLoading(null);
    fetchAllData();
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-slate-800">应急</h2>

      {msg && <div className={`px-4 py-2 rounded-lg text-xs font-medium ${msg.includes("已") || msg.includes("恢复") ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}`}>{msg}</div>}

      {/* 信息面板 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">在线用户</div>
          <div className="text-2xl font-bold text-slate-800">{onlineCount}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">24h 拦截</div>
          <div className="text-2xl font-bold text-red-600">{deny24h}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">活跃风险实体</div>
          <div className="text-2xl font-bold text-amber-600">{riskEntities}</div>
        </div>
        <div className={`bg-white rounded-xl border p-4 ${isMaintenance ? "border-red-300" : "border-green-200"}`}>
          <div className="text-xs text-slate-500">站点状态</div>
          <div className={`text-lg font-bold ${isMaintenance ? "text-red-600" : "text-green-600"}`}>{isMaintenance ? "维护中" : "正常"}</div>
        </div>
      </div>

      {/* 操作卡片 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-red-200 p-5">
          <h3 className="text-sm font-bold text-red-700 mb-2">全站维护模式</h3>
          <p className="text-xs text-slate-500 mb-4">踢出所有用户 · 关闭访客和下载 · 禁上传 · 发布维护公告 · 全量备份</p>
          <button onClick={handleMaintenance} disabled={loading !== null || !canModify("emergency.maintenance")} title={!canModify("emergency.maintenance") ? "无修改权限" : undefined} className="w-full bg-red-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-red-700 disabled:opacity-50">
            {loading === "maintenance" ? "执行中..." : "进入维护模式"}
          </button>
        </div>
        <div className="bg-white rounded-xl border border-green-200 p-5">
          <h3 className="text-sm font-bold text-green-700 mb-2">恢复运行</h3>
          <p className="text-xs text-slate-500 mb-4">恢复维护前的全部设置 · 停用维护公告 · 重新开放站点</p>
          <button onClick={handleRestore} disabled={loading !== null || !adminSettings?.maintenanceSnapshot || !canModify("emergency.restore")} title={!canModify("emergency.restore") ? "无修改权限" : undefined} className="w-full bg-green-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {loading === "restore" ? "恢复中..." : "恢复运行"}
          </button>
        </div>
        <div className="bg-white rounded-xl border border-amber-200 p-5">
          <h3 className="text-sm font-bold text-amber-700 mb-2">封禁所有在线 IP</h3>
          <p className="text-xs text-slate-500 mb-4">封禁当前所有在线 IP (1h) · 从活跃 IP 列表提取</p>
          <button onClick={handleBanAllIPs} disabled={loading !== null || !canModify("emergency.banAllIPs")} title={!canModify("emergency.banAllIPs") ? "无修改权限" : undefined} className="w-full bg-amber-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-amber-700 disabled:opacity-50">
            {loading === "ban" ? "封禁中..." : "封禁所有在线 IP (1h)"}
          </button>
        </div>
      </div>
    </div>
  );
}
