"use client";

import { useState } from "react";
import { useAdmin } from "../lib/admin-context";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://pan.tantantan.tech/wlm-api";

export default function RiskControl() {
  const { denyDashboard, denyDetailEntity, setDenyDetailEntity, denyReasonLabel, fetchAllData, token, logAdminAction, canModify, loading } = useAdmin();
  const [showDenyEvents, setShowDenyEvents] = useState(false);

  if (loading || !denyDashboard) {
    return <div className="text-slate-500 text-sm py-12 text-center">⏳ 加载数据中...</div>;
  }

  const { summary, riskEntities, recentEvents } = denyDashboard;
  const entities = (riskEntities || []).slice(0, 50);

  const postDenyAction = async (body: any) => {
    await fetch(`${API_BASE}/api/deny-stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const actionLabel =
      body.action === "adjust_score" ? `调整分数 ${body.delta > 0 ? "+" : ""}${body.delta}` :
      body.action === "unban" ? "解封实体" :
      body.action === "clear_score" ? "清空分数" : body.action;
    logAdminAction("风控操作", `${actionLabel}: ${body.entity_type}=${body.entity_value}`);
    fetchAllData();
  };

  const scoreColor = (score: number) =>
    score >= 50 ? "text-red-600" : score >= 30 ? "text-amber-600" : "text-green-600";

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-slate-800">风控管理</h2>

      {/* 摘要条 */}
      <div className="flex flex-wrap gap-4">
        <div className="bg-white rounded-xl border border-slate-200 px-5 py-3">
          <span className="text-xs text-slate-500">24h Deny</span>
          <span className="text-xl font-bold text-slate-800 ml-3">{summary?.total24h || 0}</span>
        </div>
        <div className="bg-white rounded-xl border border-amber-200 px-5 py-3">
          <span className="text-xs text-slate-500">警告</span>
          <span className="text-xl font-bold text-amber-600 ml-3">{summary?.warnCount || 0}</span>
        </div>
        <div className="bg-white rounded-xl border border-red-200 px-5 py-3">
          <span className="text-xs text-slate-500">封禁</span>
          <span className="text-xl font-bold text-red-600 ml-3">{summary?.bannedCount || 0}</span>
        </div>
      </div>

      {/* 风险实体表 */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-700">风险实体 ({entities.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="text-left px-4 py-2 font-medium">实体</th>
                <th className="text-left px-4 py-2 font-medium">类型</th>
                <th className="text-left px-4 py-2 font-medium">风险分</th>
                <th className="text-left px-4 py-2 font-medium">事件</th>
                <th className="text-left px-4 py-2 font-medium">最近触发</th>
                <th className="text-left px-4 py-2 font-medium">状态</th>
                <th className="text-right px-4 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {entities.map((e: any, i: number) => (
                <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 ${e.is_banned ? "bg-red-50/30" : ""}`}>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => setDenyDetailEntity({ entity_type: e.entity_type, entity_value: e.entity_value })}
                      className="font-mono text-slate-700 hover:text-blue-600 hover:underline cursor-pointer text-left"
                      title={e.entity_value}
                    >
                      {e.entity_type === "ip" ? e.entity_value : (e.entity_value || "").slice(0, 16) + "…"}
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${e.entity_type === "ip" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
                      {e.entity_type === "ip" ? "IP" : "设备"}
                    </span>
                  </td>
                  <td className={`px-4 py-2 font-bold ${scoreColor(e.current_score)}`}>{Math.round(e.current_score)}</td>
                  <td className="px-4 py-2 text-slate-600">{e.total_events}</td>
                  <td className="px-4 py-2 text-slate-500 max-w-[120px] truncate" title={e.last_offense_reason}>
                    {denyReasonLabel[e.last_offense_reason] || e.last_offense_reason || "—"}
                  </td>
                  <td className="px-4 py-2">
                    {e.is_banned ? (
                      <span className="text-[10px] text-red-600 font-medium bg-red-50 px-1.5 py-0.5 rounded">已封禁</span>
                    ) : e.current_score >= 30 ? (
                      <span className="text-[10px] text-amber-600 font-medium bg-amber-50 px-1.5 py-0.5 rounded">警告</span>
                    ) : (
                      <span className="text-[10px] text-green-600 font-medium bg-green-50 px-1.5 py-0.5 rounded">正常</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {canModify("riskcontrol.adjustScore") && (
                        <><button onClick={() => postDenyAction({ action: "adjust_score", entity_type: e.entity_type, entity_value: e.entity_value, delta: 5 })} className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100">+5</button>
                        <button onClick={() => postDenyAction({ action: "adjust_score", entity_type: e.entity_type, entity_value: e.entity_value, delta: -5 })} className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-600 hover:bg-green-100">-5</button></>
                      )}
                      {e.is_banned && canModify("riskcontrol.unban") && (
                        <button onClick={() => postDenyAction({ action: "unban", entity_type: e.entity_type, entity_value: e.entity_value })} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100">解封</button>
                      )}
                      {canModify("riskcontrol.clearScore") && (
                        <button onClick={() => postDenyAction({ action: "clear_score", entity_type: e.entity_type, entity_value: e.entity_value })} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 hover:bg-slate-100">清分</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deny 事件列表 */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <button
          onClick={() => setShowDenyEvents(!showDenyEvents)}
          className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
        >
          <span className="text-sm font-bold text-slate-700">最近 Deny 事件 ({(recentEvents || []).length})</span>
          <span className="text-xs text-slate-400">{showDenyEvents ? "收起 ▲" : "展开 ▼"}</span>
        </button>
        {showDenyEvents && (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="text-left px-4 py-2 font-medium">时间</th>
                  <th className="text-left px-4 py-2 font-medium">来源</th>
                  <th className="text-left px-4 py-2 font-medium">原因</th>
                  <th className="text-left px-4 py-2 font-medium">IP</th>
                  <th className="text-left px-4 py-2 font-medium">设备码</th>
                  <th className="text-left px-4 py-2 font-medium">用户</th>
                  <th className="text-left px-4 py-2 font-medium">路径</th>
                </tr>
              </thead>
              <tbody>
                {(recentEvents || []).slice(0, 20).map((ev: any, j: number) => (
                  <tr key={j} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-1.5 text-slate-500 font-mono">{new Date(ev.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-4 py-1.5 text-slate-500">{ev.deny_source}</td>
                    <td className={`px-4 py-1.5 ${(ev.risk_score_added || 0) >= 20 ? "text-red-600 font-medium" : "text-slate-600"}`}>{denyReasonLabel[ev.deny_reason] || ev.deny_reason}</td>
                    <td className="px-4 py-1.5 font-mono text-slate-500">{ev.ip}</td>
                    <td className="px-4 py-1.5 font-mono text-[10px] text-slate-400" title={ev.device_code_hash}>{(ev.device_code_hash || "").slice(0, 10) || "—"}</td>
                    <td className="px-4 py-1.5 text-slate-600">{ev.username || "—"}</td>
                    <td className="px-4 py-1.5 text-slate-500 max-w-[120px] truncate" title={ev.request_path}>{ev.request_path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 实体详情弹窗 */}
      {denyDetailEntity && (
        <EntityDetailModal />
      )}
    </div>
  );
}

// 子组件：实体详情弹窗
function EntityDetailModal() {
  const { denyDetailEntity, setDenyDetailEntity, denyDashboard, denyReasonLabel } = useAdmin();
  if (!denyDetailEntity) return null;

  const { entity_type, entity_value } = denyDetailEntity;
  const events = (denyDashboard?.recentEvents || []).filter((ev: any) =>
    entity_type === "ip" ? ev.ip === entity_value : ev.device_code_hash === entity_value
  );

  // 关联 IP 和设备码
  const relatedIps = new Set<string>();
  const relatedDevices = new Set<string>();
  events.forEach((ev: any) => {
    if (entity_type !== "ip" && ev.ip) relatedIps.add(ev.ip);
    if (entity_type === "ip" && ev.device_code_hash) relatedDevices.add(ev.device_code_hash);
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setDenyDetailEntity(null)}>
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-3xl max-h-[80vh] overflow-auto mx-4" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <span className="text-sm font-bold text-slate-800">
              {entity_type === "ip" ? "IP" : "设备"} 详情
            </span>
            <span className="text-xs text-slate-500 font-mono ml-2">{entity_value}</span>
          </div>
          <button onClick={() => setDenyDetailEntity(null)} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {/* 关联信息 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-bold text-slate-500 mb-2">关联 IP ({relatedIps.size})</div>
              <div className="flex flex-wrap gap-1">
                {[...relatedIps].slice(0, 20).map((ip) => (
                  <span key={ip} className="text-[10px] font-mono bg-blue-50 text-blue-600 px-2 py-0.5 rounded">{ip}</span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-500 mb-2">关联设备码 ({relatedDevices.size})</div>
              <div className="flex flex-wrap gap-1">
                {[...relatedDevices].slice(0, 20).map((dc) => (
                  <span key={dc} className="text-[10px] font-mono bg-purple-50 text-purple-600 px-2 py-0.5 rounded">{dc.slice(0, 12)}</span>
                ))}
              </div>
            </div>
          </div>
          {/* Deny 事件列表 */}
          <div>
            <div className="text-xs font-bold text-slate-500 mb-2">Deny 事件 ({events.length})</div>
            <div className="overflow-x-auto max-h-[300px] overflow-y-auto border border-slate-100 rounded-lg">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500 sticky top-0 bg-white">
                    <th className="text-left px-3 py-1.5">时间</th>
                    <th className="text-left px-3 py-1.5">原因</th>
                    <th className="text-left px-3 py-1.5">路径</th>
                  </tr>
                </thead>
                <tbody>
                  {events.slice(0, 100).map((ev: any, i: number) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="px-3 py-1 text-slate-500 font-mono">{new Date(ev.created_at).toLocaleString("zh-CN")}</td>
                      <td className="px-3 py-1 text-slate-600">{denyReasonLabel[ev.deny_reason] || ev.deny_reason}</td>
                      <td className="px-3 py-1 text-slate-500 truncate max-w-[200px]" title={ev.request_path}>{ev.request_path}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
