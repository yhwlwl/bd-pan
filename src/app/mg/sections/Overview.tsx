"use client";

import { useState } from "react";
import { useAdmin } from "../lib/admin-context";

export default function Overview() {
  const { adminStats, denyDashboard, isAdmin, adminDataSource, adminPageSource, setAdminDataSource, setAdminPageSource, lastFetchTime, canModify, loading } = useAdmin();
  const [showOnlineUsers, setShowOnlineUsers] = useState(false);
  const [showLogModal, setShowLogModal] = useState<{ title: string; logs: any[] } | null>(null);

  if (loading || !adminStats) {
    return <div className="text-slate-500 text-sm py-12 text-center">⏳ 加载数据中...</div>;
  }

  const stats = adminStats;
  const deny = denyDashboard;

  // 最近 10 条操作日志
  const recentActions = (stats.recentActions || []).slice(0, 10);
  // 最近 10 条拦截事件
  const recentDeny = (deny?.recentEvents || []).slice(0, 10);

  const actionColor = (action: string) => {
    if (action.includes("被拦截") || action.includes("blocked")) return "text-red-600 bg-red-50";
    if (action.includes("失败")) return "text-orange-600 bg-orange-50";
    if (action.includes("删除")) return "text-red-600 bg-red-50";
    if (action.includes("下载")) return "text-green-600 bg-green-50";
    if (action.includes("上传")) return "text-amber-600 bg-amber-50";
    if (action.includes("登录")) return "text-blue-600 bg-blue-50";
    return "text-slate-600 bg-slate-50";
  };

  const denySourceLabel: Record<string, string> = {
    nginx: "Nginx", api: "API", frontend: "前端",
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-slate-800">总览</h2>

      {/* ─── 4 张指标卡 ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 在线用户 */}
        <button
          onClick={() => setShowOnlineUsers(true)}
          className="bg-white rounded-xl border border-slate-200 p-5 text-left hover:shadow-md transition-shadow"
        >
          <div className="text-xs font-medium text-slate-500 mb-2">在线用户</div>
          <div className="text-3xl font-bold text-emerald-600">{stats.onlineUsers?.length || 0}</div>
          <div className="text-xs text-slate-400 mt-1">当前活跃会话</div>
        </button>

        {/* 今日下载 */}
        <button onClick={() => {
          const dlLogs = (stats.recentActions || []).filter((l: any) => (l.action || "").startsWith("下载"));
          setShowLogModal({ title: "今日下载记录", logs: dlLogs.filter((l: any) => new Date(l.time).getTime() >= Date.now() - 86400000) });
        }} className="bg-white rounded-xl border border-slate-200 p-5 text-left hover:shadow-md transition-shadow">
          <div className="text-xs font-medium text-slate-500 mb-2">今日下载</div>
          <div className="text-3xl font-bold text-blue-600">{stats.past24hDownloads || 0}</div>
          <div className="text-xs text-slate-400 mt-1">过去 24 小时</div>
        </button>

        {/* 总访问量 */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs font-medium text-slate-500 mb-2">总访问量</div>
          <div className="text-3xl font-bold text-slate-800">{stats.totalPanVisits || 0}</div>
          <div className="text-xs text-slate-400 mt-1">历史累计</div>
        </div>

        {/* 风控状态 */}
        <div className={`bg-white rounded-xl border p-5 ${deny?.summary?.bannedCount > 0 ? "border-red-200" : deny?.summary?.warnCount > 0 ? "border-amber-200" : "border-green-200"}`}>
          <div className="text-xs font-medium text-slate-500 mb-2">风控状态</div>
          <div className="flex items-center gap-2">
            {deny?.summary?.bannedCount > 0 ? (
              <span className="text-sm font-bold text-red-600">{deny.summary.bannedCount} 封禁</span>
            ) : deny?.summary?.warnCount > 0 ? (
              <span className="text-sm font-bold text-amber-600">{deny.summary.warnCount} 警告</span>
            ) : (
              <span className="text-sm font-bold text-green-600">正常</span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-1">风控状态 · 24h: {deny?.summary?.total24h || 0} 事件</div>
        </div>
      </div>

      {/* ─── 预览统计 ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button onClick={() => {
          const pvLogs = (stats.recentActions || []).filter((l: any) => l.action === "预览");
          setShowLogModal({ title: "今日预览记录", logs: pvLogs.filter((l: any) => new Date(l.time).getTime() >= Date.now() - 86400000) });
        }} className="bg-white rounded-xl border border-slate-200 p-5 text-left hover:shadow-md transition-shadow">
          <div className="text-xs font-medium text-slate-500 mb-2">今日预览</div>
          <div className="text-3xl font-bold text-purple-600">{adminStats?.past24hPreviews || 0}</div>
          <div className="text-xs text-slate-400 mt-1">过去 24 小时</div>
        </button>
        <button onClick={() => {
          const pvLogs = (stats.recentActions || []).filter((l: any) => l.action === "预览");
          setShowLogModal({ title: "累计预览记录", logs: pvLogs });
        }} className="bg-white rounded-xl border border-slate-200 p-5 text-left hover:shadow-md transition-shadow">
          <div className="text-xs font-medium text-slate-500 mb-2">累计预览</div>
          <div className="text-3xl font-bold text-slate-800">{adminStats?.totalPreviews || 0}</div>
          <div className="text-xs text-slate-400 mt-1">历史累计</div>
        </button>
      </div>

      {/* ─── 实时动态（双区） ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 最近操作 */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700">最近操作</h3>
            <a href="/mg?tab=action-logs" className="text-xs text-blue-600 hover:underline">查看全部 →</a>
          </div>
          <div className="divide-y divide-slate-50">
            {recentActions.length === 0 ? (
              <div className="px-5 py-6 text-center text-xs text-slate-400">暂无操作记录</div>
            ) : (
              recentActions.map((log: any, i: number) => (
                <div key={i} className="px-5 py-2.5 flex items-center gap-2 text-xs">
                  <span className="text-slate-400 font-mono shrink-0 w-14">
                    {new Date(log.time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${actionColor(log.action)}`}>
                    {log.action?.length > 4 ? log.action.slice(0, 4) + "…" : log.action || "—"}
                  </span>
                  <span className="text-slate-600 font-medium shrink-0">{log.username}</span>
                  <span className="text-slate-400 truncate max-w-[120px]" title={log.item}>{log.item}</span>
                  <span className="text-slate-400 font-mono text-[10px] shrink-0 hidden sm:inline" title={log.ip}>{log.ip}</span>
                  <span className="text-slate-400 font-mono text-[10px] shrink-0 hidden lg:inline" title={log.device_code}>{(log.device_code || "").slice(0, 10) || "—"}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 最近拦截 */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700">最近拦截</h3>
            <a href="/mg?tab=risk-control" className="text-xs text-blue-600 hover:underline">查看全部 →</a>
          </div>
          <div className="divide-y divide-slate-50">
            {recentDeny.length === 0 ? (
              <div className="px-5 py-6 text-center text-xs text-slate-400">暂无拦截事件</div>
            ) : (
              recentDeny.map((ev: any, i: number) => (
                <div key={i} className="px-5 py-2.5 flex items-center gap-3 text-xs">
                  <span className="text-slate-400 font-mono shrink-0 w-14">
                    {new Date(ev.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="text-slate-500 shrink-0">{denySourceLabel[ev.deny_source] || ev.deny_source}</span>
                  <span className="text-red-600 font-medium truncate">{ev.deny_reason}</span>
                  <span className="text-slate-400 font-mono shrink-0">{ev.ip || "—"}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ─── 底部状态栏 ─── */}
      {/* 操作/预览详情弹窗 */}
      {showLogModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setShowLogModal(null)}>
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-3xl max-h-[70vh] overflow-auto mx-4" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">{showLogModal.title} ({showLogModal.logs.length})</h3>
              <button onClick={() => setShowLogModal(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="divide-y divide-slate-50">
              {showLogModal.logs.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-slate-400">暂无记录</div>
              ) : (
                showLogModal.logs.slice(0, 100).map((log: any, i: number) => (
                  <div key={i} className="px-5 py-2.5 flex items-center gap-3 text-xs">
                    <span className="text-slate-400 font-mono shrink-0 w-14">{new Date(log.time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="text-slate-700 shrink-0">{log.username}</span>
                    <span className="text-slate-500 truncate" title={log.item}>{log.item}</span>
                    <span className="text-slate-400 font-mono text-[10px] shrink-0" title={log.ip}>{(log.ip || "").slice(0, 15)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 px-5 py-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
        {isAdmin && (
          <>
            <span>数据源: <b className="text-slate-700">{adminDataSource === "ecs" ? "ECS" : "Supabase"}</b></span>
            <span>站来源: <b className="text-slate-700">{adminPageSource === "weilaimeng" ? "未来梦" : adminPageSource === "pan" ? "主站" : "全部"}</b></span>
          </>
        )}
        {lastFetchTime && (
          <span>上次刷新: <b className="text-slate-700">{new Date(lastFetchTime).toLocaleTimeString("zh-CN")}</b></span>
        )}
        <span>总下载: <b className="text-slate-700">{stats.totalDownloads || 0}</b></span>
      </div>

      {/* 在线用户弹窗 */}
      {showOnlineUsers && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setShowOnlineUsers(false)}>
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md max-h-[70vh] overflow-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-800">在线用户 ({stats.onlineUsers?.length || 0})</h3>
              <button onClick={() => setShowOnlineUsers(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="space-y-2">
              {(stats.onlineUsers || []).map((u: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 text-xs">
                  <span className="font-medium text-slate-700">{u.username}</span>
                  <span className="text-slate-400">{new Date(u.lastActive).toLocaleTimeString("zh-CN")}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
