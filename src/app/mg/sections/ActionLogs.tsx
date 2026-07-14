"use client";

import { useState, useMemo } from "react";
import { useAdmin } from "../lib/admin-context";

export default function ActionLogs() {
  const { adminStats, loading } = useAdmin();
  const [logTimeFilter, setLogTimeFilter] = useState("all");
  const [logUserFilter, setLogUserFilter] = useState("all");
  const [logFilter, setLogFilter] = useState("全部");
  const [riskLimit, setRiskLimit] = useState(50);

  if (loading || !adminStats) {
    return <div className="text-slate-500 text-sm py-12 text-center">⏳ 加载数据中...</div>;
  }

  const rawLogs = adminStats.recentActions || [];

  // 收集用户列表
  const userList = useMemo(() => {
    const set = new Set<string>();
    rawLogs.forEach((l: any) => { if (l.username) set.add(l.username); });
    return Array.from(set).slice(0, 20);
  }, [rawLogs]);

  // 筛选
  const now = Date.now();
  const filtered = useMemo(() => {
    let result = rawLogs;
    // 时间筛选
    if (logTimeFilter === "today") {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      result = result.filter((l: any) => new Date(l.time).getTime() >= today.getTime());
    } else if (logTimeFilter === "7d") {
      const cutoff = now - 7 * 24 * 3600 * 1000;
      result = result.filter((l: any) => new Date(l.time).getTime() >= cutoff);
    } else if (logTimeFilter === "30d") {
      const cutoff = now - 30 * 24 * 3600 * 1000;
      result = result.filter((l: any) => new Date(l.time).getTime() >= cutoff);
    }
    // 用户筛选
    if (logUserFilter !== "all") {
      result = result.filter((l: any) => l.username === logUserFilter);
    }
    // 动作筛选
    if (logFilter === "被拦截") result = result.filter((l: any) => (l.action || "").includes("被拦截") || (l.action || "").includes("blocked"));
    else if (logFilter === "失败") result = result.filter((l: any) => (l.action || "").includes("失败"));
    else if (logFilter === "下载") result = result.filter((l: any) => (l.action || "").startsWith("下载"));
    else if (logFilter === "预览") result = result.filter((l: any) => l.action === "预览");
    else if (logFilter === "删除") result = result.filter((l: any) => (l.action || "").startsWith("删除"));
    else if (logFilter === "文件权限") result = result.filter((l: any) => (l.action || "").includes("文件权限"));
    else if (logFilter === "登录") result = result.filter((l: any) => (l.action || "").includes("登录"));
    return result;
  }, [rawLogs, logTimeFilter, logUserFilter, logFilter, now]);

  const displayed = filtered.slice(0, riskLimit >= 99999 ? filtered.length : riskLimit);

  const actionColor = (action: string) => {
    if (action.includes("被拦截") || action.includes("blocked")) return "text-red-600 font-bold";
    if (action.includes("失败")) return "text-orange-600";
    if (action.includes("删除")) return "text-red-600";
    if (action.includes("下载")) return "text-green-600";
    if (action.includes("上传")) return "text-amber-600";
    if (action.includes("登录")) return "text-blue-600";
    if (action.includes("文件权限")) return "text-purple-600";
    return "text-slate-600";
  };

  const exportCSV = () => {
    const header = "时间,用户,动作,对象,设备码,IP,定位\n";
    const rows = filtered.map((l: any) =>
      `"${l.time}","${l.username}","${l.action}","${l.item}","${l.device_code || "-"}","${l.ip}","${l.location}"`
    ).join("\n");
    const blob = new Blob(["﻿" + header + rows], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "操作日志.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-800">操作日志</h2>
        <button onClick={exportCSV} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium">
          导出 CSV
        </button>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={logTimeFilter} onChange={e => setLogTimeFilter(e.target.value)} className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-600">
          <option value="all">全部时间</option>
          <option value="today">今天</option>
          <option value="7d">最近 7 天</option>
          <option value="30d">最近 30 天</option>
        </select>
        <select value={logUserFilter} onChange={e => setLogUserFilter(e.target.value)} className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-600">
          <option value="all">全部用户</option>
          {userList.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={logFilter} onChange={e => setLogFilter(e.target.value)} className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-600">
          <option value="全部">全部</option>
          <option value="被拦截">被拦截</option>
          <option value="失败">失败</option>
          <option value="下载">下载</option>
          <option value="预览">预览</option>
          <option value="删除">删除</option>
          <option value="文件权限">文件权限</option>
          <option value="登录">登录</option>
        </select>
        <select value={riskLimit} onChange={e => setRiskLimit(Number(e.target.value))} className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-600">
          <option value={10}>10 条</option>
          <option value={50}>50 条</option>
          <option value={200}>200 条</option>
          <option value={99999}>全部</option>
        </select>
        <span className="text-xs text-slate-400">共 {filtered.length} 条</span>
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="text-left px-4 py-2 font-medium w-[65px]">时间</th>
                <th className="text-left px-4 py-2 font-medium w-[45px]">用户</th>
                <th className="text-left px-4 py-2 font-medium w-[85px]">动作</th>
                <th className="text-left px-4 py-2 font-medium">对象</th>
                <th className="text-left px-4 py-2 font-medium w-[60px]">设备码</th>
                <th className="text-left px-4 py-2 font-medium w-[100px]">源 IP/定位</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((log: any, i: number) => (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-1.5 text-slate-500 font-mono">{new Date(log.time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="px-4 py-1.5 font-medium text-slate-700 truncate" title={log.username}>{log.username}</td>
                  <td className={`px-4 py-1.5 truncate ${actionColor(log.action)}`} title={log.action}>{log.action}</td>
                  <td className="px-4 py-1.5 text-slate-600 truncate max-w-[150px]" title={log.item}>{log.item}</td>
                  <td className="px-4 py-1.5 font-mono text-[10px] text-slate-400 truncate" title={log.device_code}>{(log.device_code || "").slice(0, 10) || "—"}</td>
                  <td className="px-4 py-1.5">
                    <div className="font-mono text-slate-500 truncate">{log.ip}</div>
                    <div className="text-[9px] text-slate-400 truncate">{log.location}</div>
                  </td>
                </tr>
              ))}
              {displayed.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">无匹配记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
