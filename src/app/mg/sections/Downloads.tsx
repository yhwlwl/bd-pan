"use client";

import { useState, useEffect } from "react";
import { useAdmin } from "../lib/admin-context";

const CHANNELS = [
  { key: "ecs", name: "阿里云 ECS", color: "pink" },
  { key: "cf", name: "Cloudflare", color: "blue" },
  { key: "raw", name: "真实直链", color: "emerald" },
  { key: "vercel", name: "Vercel 中转", color: "orange" },
  { key: "direct302", name: "302 跳转", color: "slate" },
] as const;

const colorMap: Record<string, { bg: string; text: string; border: string }> = {
  pink: { bg: "bg-pink-50", text: "text-pink-600", border: "border-pink-200" },
  blue: { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200" },
  emerald: { bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-200" },
  orange: { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-200" },
  slate: { bg: "bg-slate-50", text: "text-slate-600", border: "border-slate-200" },
};

export default function Downloads() {
  const { adminStats, adminSettings, adminAction, fetchAllData, canModify, loading } = useAdmin();
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [modes, setModes] = useState<Record<string, string>>({});

  // 从 settings 同步下载通道模式
  useEffect(() => {
    if (adminSettings?.downloadModes) setModes({ ...adminSettings.downloadModes });
  }, [adminSettings]);

  const saveModes = async () => {
    await adminAction("updateSettings", { settings: { ...adminSettings, downloadModes: modes } });
    fetchAllData();
  };

  if (loading || !adminStats) {
    return <div className="text-slate-500 text-sm py-12 text-center">⏳ 加载数据中...</div>;
  }

  const channelStats = adminStats.channelStats || {};
  const toggleChannel = (key: string) => {
    setExpandedChannel(prev => (prev === key ? null : key));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">下载明细</h2>
        <button
          onClick={() => setShowAllHistory(true)}
          className="text-xs text-blue-600 hover:underline font-medium"
        >
          全部历史下载 →
        </button>
      </div>

      {/* 5 张通道卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {CHANNELS.map((ch) => {
          const data = channelStats[ch.key] || { past24h: 0, total: 0, logs: [] };
          const c = colorMap[ch.color];
          const isActive = expandedChannel === ch.key;
          return (
            <button
              key={ch.key}
              onClick={() => toggleChannel(ch.key)}
              className={`bg-white rounded-xl border p-4 text-left transition-all hover:shadow-md ${isActive ? `${c.border} ring-2 ring-offset-1 ${c.border}` : "border-slate-200"}`}
            >
              <div className={`text-xs font-medium ${c.text} mb-2`}>{ch.name}</div>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-bold ${c.text}`}>{data.past24h}</span>
                <span className="text-xs text-slate-400">/ {data.total}</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-1">24h / 总计</div>
            </button>
          );
        })}
      </div>

      {/* 展开的通道详情 */}
      {expandedChannel && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700">
              {CHANNELS.find((c) => c.key === expandedChannel)?.name} 下载记录
            </h3>
            <span className="text-xs text-slate-400">
              {channelStats[expandedChannel]?.logs?.length || 0} 条
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="text-left px-5 py-2 font-medium">时间</th>
                  <th className="text-left px-5 py-2 font-medium">用户</th>
                  <th className="text-left px-5 py-2 font-medium">IP</th>
                  <th className="text-left px-5 py-2 font-medium">文件</th>
                </tr>
              </thead>
              <tbody>
                {(channelStats[expandedChannel]?.logs || []).slice(0, 50).map((log: any, i: number) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-2 text-slate-500 font-mono">{new Date(log.time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-5 py-2 font-medium text-slate-700">{log.username}</td>
                    <td className="px-5 py-2 text-slate-500 font-mono">{log.ip}</td>
                    <td className="px-5 py-2 text-slate-600 truncate max-w-[300px]" title={log.item}>{log.item}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 下载通道控制 */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-700">通道控制</h3>
          <button onClick={saveModes} disabled={!canModify("settings.global")} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-30">保存</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { key: "ecs", label: "ECS 极速下载" },
            { key: "cf", label: "Cloudflare 边缘加速" },
            { key: "raw", label: "复制直链 (迅雷/IDM)" },
            { key: "vercel", label: "Vercel 中转下载" },
            { key: "direct302", label: "302 直链跳转" },
          ].map(ch => (
            <div key={ch.key} className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-600 truncate">{ch.label}</span>
              <select
                value={modes[ch.key] || "enabled"}
                onChange={e => setModes({ ...modes, [ch.key]: e.target.value })}
                className="border border-slate-200 rounded px-2 py-1 text-[10px] bg-white"
              >
                <option value="enabled">可用</option>
                <option value="disabled">禁用</option>
                <option value="hidden">隐藏</option>
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* 全部历史下载弹窗 */}
      {showAllHistory && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setShowAllHistory(false)}>
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-4xl max-h-[80vh] overflow-auto mx-4" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">全部历史下载记录</h3>
              <button onClick={() => setShowAllHistory(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500">
                    <th className="text-left px-5 py-2 font-medium">时间</th>
                    <th className="text-left px-5 py-2 font-medium">用户</th>
                    <th className="text-left px-5 py-2 font-medium">IP/定位</th>
                    <th className="text-left px-5 py-2 font-medium">文件</th>
                  </tr>
                </thead>
                <tbody>
                  {(adminStats.allDownloadLogs || []).map((log: any, i: number) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-5 py-2 text-slate-500 font-mono">{new Date(log.time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="px-5 py-2 font-medium text-slate-700">{log.username}</td>
                      <td className="px-5 py-2 text-slate-500">
                        <div className="font-mono">{log.ip}</div>
                        <div className="text-[10px] text-slate-400">{log.location}</div>
                      </td>
                      <td className="px-5 py-2 text-slate-600 truncate max-w-[300px]" title={log.item}>{log.item}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
