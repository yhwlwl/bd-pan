"use client";

import { useState } from "react";
import { useAdmin } from "../lib/admin-context";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://pan.tantantan.tech/wlm-api";

export default function Visits() {
  const { adminStats, adminSettings, isAdmin, adminAction, fetchAllData, canModify, loading, token } = useAdmin();
  const [ipSort, setIpSort] = useState<"count" | "time" | "flow">("count");
  const [ipLimit, setIpLimit] = useState(5);
  const [banInput, setBanInput] = useState<{ ip: string; show: boolean }>({ ip: "", show: false });

  if (loading || !adminStats) {
    return <div className="text-slate-500 text-sm py-12 text-center">⏳ 加载数据中...</div>;
  }

  const topIps = adminStats.topIps || [];
  const viewLogs = adminStats.viewLogs || [];
  const bannedIps = adminSettings?.bannedIps || {};

  // 排序
  const sorted = [...topIps].sort((a: any, b: any) => {
    if (ipSort === "time") return new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime();
    return b.count - a.count;
  });
  const displayed = sorted.slice(0, ipLimit >= 99999 ? sorted.length : ipLimit);

  const handleBan = async (ip: string, hours: number) => {
    const banUntil = Date.now() + hours * 3600 * 1000;
    const newBanned = { ...bannedIps, [ip]: banUntil };
    await adminAction("updateSettings", { settings: { bannedIps: newBanned } });
    // 同步标记 risk_scores
    try {
      await fetch(`${API_BASE}/api/deny-stats`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "ban_ip", entity_type: "ip", entity_value: ip, ban_hours: hours }),
      });
    } catch {}
    fetchAllData();
    setBanInput({ ip: "", show: false });
  };

  const handleUnban = async (ip: string) => {
    const newBanned = { ...bannedIps };
    delete newBanned[ip];
    await adminAction("updateSettings", { settings: { bannedIps: newBanned } });
    // 同步清除 risk_scores 的封禁状态
    try {
      await fetch(`${API_BASE}/api/deny-stats`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "unban", entity_type: "ip", entity_value: ip }),
      });
    } catch {}
    fetchAllData();
  };

  const isBanned = (ip: string): { banned: boolean; expiry?: string } => {
    const expiry = bannedIps[ip];
    if (!expiry) return { banned: false };
    if (Date.now() > expiry) return { banned: false };
    return { banned: true, expiry: new Date(expiry).toLocaleString("zh-CN") };
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-slate-800">访问日志</h2>

      {/* 排序 + 行数控制 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-white rounded-lg border border-slate-200 overflow-hidden">
          {(["count", "time", "flow"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setIpSort(mode)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${ipSort === mode ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {mode === "count" ? "按次数" : mode === "time" ? "按活跃" : "Flow"}
            </button>
          ))}
        </div>
        <select
          value={ipLimit}
          onChange={(e) => setIpLimit(Number(e.target.value))}
          className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-600"
        >
          <option value={5}>5 条</option>
          <option value={10}>10 条</option>
          <option value={50}>50 条</option>
          <option value={99999}>全部</option>
        </select>
      </div>

      {/* IP 表 / Flow 视图 */}
      {ipSort === "flow" ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="text-left px-5 py-2 font-medium">时间</th>
                  <th className="text-left px-5 py-2 font-medium">访问源</th>
                  <th className="text-left px-5 py-2 font-medium">账号</th>
                </tr>
              </thead>
              <tbody>
                {(viewLogs.slice(0, ipLimit >= 99999 ? viewLogs.length : ipLimit)).map((log: any, i: number) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-2 text-slate-500 font-mono">{new Date(log.visit_time).toLocaleString("zh-CN")}</td>
                    <td className="px-5 py-2">
                      <div className="font-mono text-slate-600">{log.ip_address}</div>
                      <div className="text-[10px] text-slate-400">{[log.country, log.region, log.city].filter(Boolean).join(" ") || "未知定位"}</div>
                    </td>
                    <td className="px-5 py-2 text-slate-600">{log.username || "访客"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="text-left px-5 py-2 font-medium">IP / 定位</th>
                  <th className="text-left px-5 py-2 font-medium">{ipSort === "time" ? "最近活跃" : "访问次数"}</th>
                  <th className="text-left px-5 py-2 font-medium">最近用户</th>
                  {isAdmin && <th className="text-right px-5 py-2 font-medium">操作</th>}
                </tr>
              </thead>
              <tbody>
                {displayed.map((ipData: any, i: number) => {
                  const ban = isBanned(ipData.ip);
                  return (
                    <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 ${ban.banned ? "bg-red-50/50" : ""}`}>
                      <td className="px-5 py-2.5">
                        <div className="font-mono text-slate-700">{ipData.ip}</div>
                        <div className="text-[10px] text-slate-400">{ipData.location || "未知定位"}</div>
                        {ban.banned && <span className="text-[10px] text-red-600 font-medium">封禁至 {ban.expiry}</span>}
                      </td>
                      <td className="px-5 py-2.5">
                        {ipSort === "time" ? (
                          <span className="text-slate-500">{new Date(ipData.lastActive).toLocaleString("zh-CN")}</span>
                        ) : (
                          <span className="font-bold text-slate-700">{ipData.count}</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-slate-600">{ipData.lastUser || "—"}</td>
                      {isAdmin && (
                        <td className="px-5 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {ban.banned ? (
                              <button
                                onClick={() => handleUnban(ipData.ip)} disabled={!canModify("visits.unban")} title={!canModify("visits.unban") ? "无修改权限" : undefined}
                                className="text-[10px] px-2 py-1 rounded bg-green-50 text-green-600 hover:bg-green-100 font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                              >解封</button>
                            ) : (
                              <>
                                <button onClick={() => handleBan(ipData.ip, 1)} disabled={!canModify("visits.banShort")} title={!canModify("visits.banShort") ? "无修改权限" : undefined} className="text-[10px] px-1.5 py-1 rounded bg-slate-50 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">1h</button>
                                <button onClick={() => handleBan(ipData.ip, 24)} disabled={!canModify("visits.banShort")} title={!canModify("visits.banShort") ? "无修改权限" : undefined} className="text-[10px] px-1.5 py-1 rounded bg-amber-50 text-amber-600 hover:bg-amber-100 disabled:opacity-30 disabled:cursor-not-allowed">24h</button>
                                <button onClick={() => setBanInput({ ip: ipData.ip, show: true })} disabled={!canModify("visits.banCustom")} title={!canModify("visits.banCustom") ? "无修改权限" : undefined} className="text-[10px] px-1.5 py-1 rounded bg-slate-50 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">自定义</button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 自定义封禁弹窗 */}
      {banInput.show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setBanInput({ ip: "", show: false })}>
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-5 w-80" onClick={e => e.stopPropagation()}>
            <h4 className="text-sm font-bold text-slate-800 mb-3">封禁 IP: {banInput.ip}</h4>
            <input
              type="number"
              defaultValue={24}
              min={0}
              id="banHours"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-3"
              placeholder="封禁小时数（0=永久）"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const h = parseInt((document.getElementById("banHours") as HTMLInputElement)?.value || "24", 10);
                  handleBan(banInput.ip, h || 87600);
                }}
                className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700"
              >
                确认封禁
              </button>
              <button
                onClick={() => setBanInput({ ip: "", show: false })}
                className="flex-1 bg-slate-100 text-slate-600 rounded-lg py-2 text-sm font-medium hover:bg-slate-200"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
