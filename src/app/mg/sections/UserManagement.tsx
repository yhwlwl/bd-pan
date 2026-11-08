"use client";

import { useMemo, useState } from "react";
import { useAdmin } from "../lib/admin-context";
import { MAX_BATCH_USERS, parseBatchUsers } from "../../../lib/batch-users";

const PERM_LABELS: Record<string, string> = {
  view: "浏览", search: "搜索", download: "下载", upload: "上传",
  delete: "删除", rename: "重命名", preview: "预览",
  setting: "本地配置", controlFile: "主站文件管理", mgAccess: "管理面板",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "超级管理员", manager: "管理员", guest: "游客",
};

const RISK_OPTIONS = [
  { v: 0, label: "无" }, { v: 1, label: "低(1)" }, { v: 2, label: "中(2)" },
  { v: 3, label: "高(3)" }, { v: 4, label: "极高(4)" }, { v: 5, label: "紧急(5)" }, { v: 6, label: "超管(6)" },
];

const MG_SECTIONS = [
  { key: "mgOverview", label: "总览" },
  { key: "mgDownloads", label: "下载明细" },
  { key: "mgVisits", label: "访问日志" },
  { key: "mgActionLogs", label: "操作日志" },
  { key: "mgAnnouncements", label: "公告" },
  { key: "mgFilePerms", label: "文件权限" },
  { key: "mgUsers", label: "用户管理" },
  { key: "mgRiskControl", label: "风控管理" },
  { key: "mgSettings", label: "设置" },
  { key: "mgEmergency", label: "应急" },
];

const PAGE_SIZES = [10, 20, 50, 100];

type BatchSummary = {
  created?: string[];
  skipped?: Array<{ username: string; reason: string }>;
  failed?: Array<{ username: string; reason: string }>;
};

export default function UserManagement() {
  const { adminUsers, adminStats, denyDashboard, adminAction, adminActionDetailed, fetchAllData, canModify, canViewOperation, loading } = useAdmin();
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [newUserName, setNewUserName] = useState("");
  const [newUserPass, setNewUserPass] = useState("");
  const [newUserRole, setNewUserRole] = useState("manager");
  const [msg, setMsg] = useState<string | null>(null);

  // 添加方式：单个 / 批量
  const [addMode, setAddMode] = useState<"single" | "batch">("single");
  const [batchText, setBatchText] = useState("");
  const [batchRole, setBatchRole] = useState("manager");
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchSummary | null>(null);

  // 列表：搜索 / 角色筛选 / 分页
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // basePath 输入改用本地草稿，避免每敲一个字符都发一次请求
  const [basePathDraft, setBasePathDraft] = useState<Record<string, string>>({});

  const users = useMemo(
    () => (adminUsers || []).filter((u: any) => u.username !== "admin"),
    [adminUsers],
  );
  const canAssociations = canViewOperation("users.viewAssociations");

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return users.filter((u: any) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (!keyword) return true;
      const basePath = String(u.permissions?.basePath || "").toLowerCase();
      return u.username.toLowerCase().includes(keyword) || basePath.includes(keyword);
    });
  }, [users, search, roleFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageUsers = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const pageItems = useMemo(() => {
    const items: Array<number | "..."> = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i += 1) items.push(i);
      return items;
    }
    const start = Math.max(2, currentPage - 2);
    const end = Math.min(totalPages - 1, currentPage + 2);
    items.push(1);
    if (start > 2) items.push("...");
    for (let i = start; i <= end; i += 1) items.push(i);
    if (end < totalPages - 1) items.push("...");
    items.push(totalPages);
    return items;
  }, [totalPages, currentPage]);

  const parsedBatch = useMemo(() => parseBatchUsers(batchText), [batchText]);

  const toggleExpand = (username: string) => {
    setExpandedUser(prev => (prev === username ? null : username));
  };

  const handleAddUser = async () => {
    if (!newUserName || !newUserPass) { setMsg("请填写用户名和密码"); return; }
    const ok = await adminAction("add", { username: newUserName.trim(), password: newUserPass, role: newUserRole, mgOperation: "users.addUser" });
    if (ok) { setNewUserName(""); setNewUserPass(""); setNewUserRole("manager"); setMsg(null); }
    fetchAllData();
  };

  const handleBatchAdd = async () => {
    if (batchBusy || parsedBatch.entries.length === 0) return;
    setBatchBusy(true);
    setBatchResult(null);
    const result = await adminActionDetailed("addBatch", {
      role: batchRole,
      entries: parsedBatch.entries.map(({ username, password }) => ({ username, password })),
      mgOperation: "users.addUser",
    });
    setBatchBusy(false);
    if (!result.ok) {
      setMsg(`❌ ${result.error || "批量添加失败"}`);
      return;
    }
    const summary: BatchSummary = result.data || {};
    setBatchResult(summary);
    const created = summary.created?.length || 0;
    const skipped = summary.skipped?.length || 0;
    const failed = summary.failed?.length || 0;
    setMsg(
      failed > 0
        ? `⚠️ 成功 ${created} 个，跳过 ${skipped} 个，失败 ${failed} 个`
        : `✅ 成功添加 ${created} 个用户${skipped > 0 ? `，跳过 ${skipped} 个已存在` : ""}`,
    );
    // 已写入的行从输入框移除，剩下的刚好是需要处理的
    if (created > 0) {
      const createdSet = new Set(summary.created || []);
      const usernameByLine = new Map(parsedBatch.entries.map(entry => [entry.line, entry.username]));
      const kept = batchText.split(/\r?\n/).filter((raw, index) => {
        if (!raw.trim()) return true;
        const username = usernameByLine.get(index + 1);
        return !(username && createdSet.has(username));
      });
      setBatchText(kept.join("\n"));
    }
    fetchAllData();
  };

  const handleRemoveUser = async (username: string) => {
    if (!confirm(`确定要删除用户 ${username} 吗？`)) return;
    await adminAction("remove", { username, mgOperation: "users.deleteUser" });
    fetchAllData();
  };

  const handleUpdateRole = async (username: string, role: string) => {
    await adminAction("updateRole", { username, role, mgOperation: "users.changeRole" });
    fetchAllData();
  };

  const handleUpdatePerms = async (username: string, permissions: Record<string, any>) => {
    await adminAction("updatePermissions", { username, permissions, mgOperation: "users.changePerms" });
  };

  const commitBasePath = async (username: string, value: string, current: string) => {
    setBasePathDraft(prev => {
      const next = { ...prev };
      delete next[username];
      return next;
    });
    if (value === current) return;
    const target = users.find((u: any) => u.username === username);
    if (!target) return;
    await handleUpdatePerms(username, { ...(target.permissions || {}), basePath: value });
  };

  // 计算用户的关联 IP 和设备码（从 adminStats + denyDashboard）
  const userAssociations = useMemo(() => {
    const map: Record<string, { ips: { value: string; count: number }[]; devices: { value: string; count: number }[] }> = {};
    const ipCount: Record<string, Record<string, number>> = {};
    const dcCount: Record<string, Record<string, number>> = {};

    // 从操作日志提取
    (adminStats?.recentActions || []).forEach((log: any) => {
      const u = log.username;
      if (!u || u === "admin") return;
      if (!map[u]) map[u] = { ips: [], devices: [] };
      if (!ipCount[u]) ipCount[u] = {};
      if (!dcCount[u]) dcCount[u] = {};
      if (log.ip) ipCount[u][log.ip] = (ipCount[u][log.ip] || 0) + 1;
      if (log.device_code) dcCount[u][log.device_code] = (dcCount[u][log.device_code] || 0) + 1;
    });

    // 从 deny 事件提取
    (denyDashboard?.recentEvents || []).forEach((ev: any) => {
      const u = ev.username;
      if (!u || u === "admin") return;
      if (!map[u]) map[u] = { ips: [], devices: [] };
      if (!ipCount[u]) ipCount[u] = {};
      if (!dcCount[u]) dcCount[u] = {};
      if (ev.ip) ipCount[u][ev.ip] = (ipCount[u][ev.ip] || 0) + 1;
      if (ev.device_code_hash) dcCount[u][ev.device_code_hash] = (dcCount[u][ev.device_code_hash] || 0) + 1;
    });

    // 转换为列表
    Object.keys(map).forEach((u) => {
      map[u].ips = Object.entries(ipCount[u] || {}).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, 20);
      map[u].devices = Object.entries(dcCount[u] || {}).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, 10);
    });

    return map;
  }, [adminStats, denyDashboard]);

  if (loading) {
    return <div className="text-slate-500 text-sm py-12 text-center">⏳ 加载数据中...</div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-slate-800">用户管理</h2>

      {msg && (
        <div className={`px-4 py-2 rounded-lg text-xs font-medium ${msg.startsWith("✅") ? "bg-green-50 text-green-600" : msg.startsWith("⚠️") ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"}`}>
          {msg}
        </div>
      )}

      {/* 添加用户 */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-1 border-b border-slate-100 px-4 pt-3">
          {([["single", "单个添加"], ["batch", "批量添加"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setAddMode(key)}
              className={`px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors ${
                addMode === key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {addMode === "single" ? (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[10px] text-slate-500 mb-1">用户名</label>
                <input value={newUserName} onChange={e => setNewUserName(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-32" placeholder="用户名" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-1">密码</label>
                <input value={newUserPass} onChange={e => setNewUserPass(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-32" placeholder="密码" type="password" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-1">角色</label>
                <select value={newUserRole} onChange={e => setNewUserRole(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
                  <option value="admin">超级管理员</option>
                  <option value="manager">管理员</option>
                  <option value="guest">游客</option>
                </select>
              </div>
              <button onClick={handleAddUser} disabled={!canModify("users.addUser")} title={!canModify("users.addUser") ? "无修改权限" : undefined} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed">添加</button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] text-slate-500">每行一个用户：<code className="text-slate-600">用户名 密码</code></label>
                  <button onClick={() => { setBatchText(""); setBatchResult(null); setMsg(null); }} className="text-[10px] text-slate-400 hover:text-slate-600">清空</button>
                </div>
                <textarea
                  value={batchText}
                  onChange={e => { setBatchText(e.target.value); setBatchResult(null); }}
                  rows={10}
                  spellCheck={false}
                  placeholder={"alice passw0rd\nbob  123456\n# 井号开头为注释\ncarol,密码里可以有 空格"}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono leading-5 resize-y focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  分隔符：空格 / 制表符；也可以写成 <code>用户名,密码</code>（密码含空格时用逗号）。空行和 <code>#</code> 注释忽略，单次上限 {MAX_BATCH_USERS} 个。
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">角色（批量统一）</label>
                  <select value={batchRole} onChange={e => setBatchRole(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-40">
                    <option value="admin">超级管理员</option>
                    <option value="manager">管理员</option>
                    <option value="guest">游客</option>
                  </select>
                </div>

                <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs space-y-1">
                  <div className="text-slate-600">
                    可导入 <span className="font-bold text-slate-800">{parsedBatch.entries.length}</span> 个
                    {parsedBatch.errors.length > 0 && <> · <span className="text-red-600">{parsedBatch.errors.length} 行有问题</span></>}
                  </div>
                  {parsedBatch.errors.length > 0 && (
                    <ul className="max-h-28 overflow-auto space-y-0.5 text-[10px] text-red-500 font-mono">
                      {parsedBatch.errors.slice(0, 8).map(err => (
                        <li key={`${err.line}-${err.raw}`}>第 {err.line} 行：{err.reason}</li>
                      ))}
                      {parsedBatch.errors.length > 8 && <li>…另有 {parsedBatch.errors.length - 8} 行</li>}
                    </ul>
                  )}
                </div>

                <button
                  onClick={handleBatchAdd}
                  disabled={batchBusy || parsedBatch.entries.length === 0 || !canModify("users.addUser")}
                  title={!canModify("users.addUser") ? "无修改权限" : undefined}
                  className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {batchBusy ? "导入中..." : `批量添加 ${parsedBatch.entries.length} 个`}
                </button>

                {batchResult && (
                  <div className="rounded-lg border border-slate-100 px-3 py-2 text-[11px] space-y-1 max-h-48 overflow-auto">
                    {batchResult.created && batchResult.created.length > 0 && (
                      <div className="text-green-600">成功 {batchResult.created.length} 个：{batchResult.created.slice(0, 20).join("、")}{batchResult.created.length > 20 ? " …" : ""}</div>
                    )}
                    {batchResult.skipped && batchResult.skipped.length > 0 && (
                      <div className="text-amber-600">
                        跳过 {batchResult.skipped.length} 个：
                        {batchResult.skipped.slice(0, 10).map(item => `${item.username}（${item.reason}）`).join("、")}
                        {batchResult.skipped.length > 10 ? " …" : ""}
                      </div>
                    )}
                    {batchResult.failed && batchResult.failed.length > 0 && (
                      <div className="text-red-600">
                        失败 {batchResult.failed.length} 个：
                        {batchResult.failed.slice(0, 10).map(item => `${item.username}（${item.reason}）`).join("、")}
                        {batchResult.failed.length > 10 ? " …" : ""}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 用户列表工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="搜索用户名 / 目录"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-56 bg-white"
        />
        <select
          value={roleFilter}
          onChange={e => { setRoleFilter(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white text-slate-600"
        >
          <option value="all">全部角色</option>
          <option value="admin">超级管理员</option>
          <option value="manager">管理员</option>
          <option value="guest">游客</option>
        </select>
        <select
          value={pageSize}
          onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
          className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white text-slate-600"
        >
          {PAGE_SIZES.map(size => <option key={size} value={size}>每页 {size} 条</option>)}
        </select>
        <span className="text-xs text-slate-400">
          共 {users.length} 个用户
          {(search.trim() || roleFilter !== "all") && <> · 匹配 {filtered.length} 个</>}
        </span>
      </div>

      {/* 用户列表 */}
      <div className="space-y-3">
        {pageUsers.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 py-12 text-center text-xs text-slate-400">
            没有匹配的用户
          </div>
        )}

        {pageUsers.map((u: any) => {
          const isExpanded = expandedUser === u.username;
          const assoc = userAssociations[u.username] || { ips: [], devices: [] };
          const currentPerms = u.permissions || {};
          const basePath = String(currentPerms.basePath || "/");
          const isBuiltin = u.username === "guest";

          return (
            <div key={u.username} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {/* 折叠标题行 */}
              <div
                onClick={() => toggleExpand(u.username)}
                className="w-full flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-medium text-slate-700 truncate">{u.username}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium shrink-0 ${
                    u.role === "admin" ? "bg-red-50 text-red-600" :
                    u.role === "manager" ? "bg-blue-50 text-blue-600" :
                    "bg-slate-50 text-slate-500"
                  }`}>
                    {ROLE_LABELS[u.role] || u.role}
                  </span>
                  {basePath !== "/" && (
                    <span className="text-[10px] font-mono bg-slate-50 text-slate-500 px-2 py-0.5 rounded truncate max-w-[240px]" title={basePath}>
                      目录 {basePath}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={u.role}
                    onChange={(e) => { e.stopPropagation(); handleUpdateRole(u.username, e.target.value); }}
                    onClick={(e) => e.stopPropagation()}
                    disabled={!canModify("users.changeRole") || isBuiltin}
                    className="text-[10px] border border-slate-200 rounded px-2 py-1 text-slate-600 bg-white disabled:opacity-30"
                  >
                    <option value="admin">超级管理员</option>
                    <option value="manager">管理员</option>
                    <option value="guest">游客</option>
                  </select>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemoveUser(u.username); }}
                    disabled={!canModify("users.deleteUser") || isBuiltin}
                    title={isBuiltin ? "内置账号不可删除" : !canModify("users.deleteUser") ? "无修改权限" : undefined}
                    className="text-[10px] text-red-500 hover:text-red-700 px-2 py-1 hover:bg-red-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    删除
                  </button>
                  <span className="text-xs text-slate-400">{isExpanded ? "▲" : "▼"}</span>
                </div>
              </div>

              {/* 展开内容 */}
              {isExpanded && (
                <div className="border-t border-slate-100 p-5 space-y-5">
                  {/* 权限编辑 */}
                  <div>
                    <div className="text-xs font-bold text-slate-500 mb-3">权限设置</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {Object.entries(PERM_LABELS).map(([key, label]) => {
                        const checked = currentPerms[key] === true;
                        return (
                          <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = { ...currentPerms, [key]: !checked };
                                if (key === "view" && !checked) {
                                  ["search", "download", "upload", "delete", "rename", "preview"].forEach(k => { next[k] = false; });
                                }
                                handleUpdatePerms(u.username, next);
                              }}
                              disabled={!canModify("users.changePerms")}
                              className="rounded"
                            />
                            <span className={checked ? "text-slate-700 font-medium" : "text-slate-400"}>{label}</span>
                          </label>
                        );
                      })}
                    </div>
                    {/* 目录隔离 */}
                    <div className="mt-3">
                      <label className="text-[10px] text-slate-500 block mb-1">目录隔离 (basePath)</label>
                      <input
                        value={basePathDraft[u.username] ?? basePath}
                        onChange={(e) => setBasePathDraft(prev => ({ ...prev, [u.username]: e.target.value }))}
                        onBlur={(e) => commitBasePath(u.username, e.target.value, basePath)}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        disabled={!canModify("users.editBasePath")}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs w-full max-w-md disabled:opacity-30"
                        placeholder="/sta/..."
                      />
                    </div>

                    {/* 管理后台板块权限（风险分级） */}
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <div className="text-xs font-bold text-slate-500 mb-3">管理后台权限（风险分级）</div>
                      <div className="space-y-2">
                        {MG_SECTIONS.map(sec => {
                          const mg = (currentPerms.mgPermissions || {})[sec.key] || { view: 0, modify: 0 };
                          return (
                            <div key={sec.key} className="flex items-center gap-2 text-xs">
                              <span className="w-24 text-slate-600 shrink-0">{sec.label}</span>
                              <span className="text-slate-400">查看</span>
                              <select
                                value={mg.view}
                                onChange={e => {
                                  const next = { ...(currentPerms.mgPermissions || {}), [sec.key]: { ...mg, view: parseInt(e.target.value) } };
                                  handleUpdatePerms(u.username, { ...currentPerms, mgPermissions: next });
                                }}
                                disabled={!canModify("users.changePerms")}
                                className="border border-slate-200 rounded px-1.5 py-0.5 text-[10px] bg-white disabled:opacity-30"
                              >
                                {RISK_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                              </select>
                              <span className="text-slate-400">修改</span>
                              <select
                                value={mg.modify}
                                onChange={e => {
                                  const next = { ...(currentPerms.mgPermissions || {}), [sec.key]: { ...mg, modify: parseInt(e.target.value) } };
                                  handleUpdatePerms(u.username, { ...currentPerms, mgPermissions: next });
                                }}
                                disabled={!canModify("users.changePerms")}
                                className="border border-slate-200 rounded px-1.5 py-0.5 text-[10px] bg-white disabled:opacity-30"
                              >
                                {RISK_OPTIONS.filter(o => o.v <= 5).map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {canAssociations && <>
                  {/* 关联 IP */}
                  <div>
                    <div className="text-xs font-bold text-slate-500 mb-2">关联 IP ({assoc.ips.length})</div>
                    <div className="flex flex-wrap gap-1">
                      {assoc.ips.length === 0 ? (
                        <span className="text-[10px] text-slate-400">无关联数据</span>
                      ) : (
                        assoc.ips.map((ip) => (
                          <span key={ip.value} className="text-[10px] font-mono bg-blue-50 text-blue-600 px-2 py-0.5 rounded" title={`出现 ${ip.count} 次`}>
                            {ip.value} <span className="text-blue-400">({ip.count})</span>
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  {/* 关联设备码 */}
                  <div>
                    <div className="text-xs font-bold text-slate-500 mb-2">关联设备码 ({assoc.devices.length})</div>
                    <div className="flex flex-wrap gap-1">
                      {assoc.devices.length === 0 ? (
                        <span className="text-[10px] text-slate-400">无关联数据</span>
                      ) : (
                        assoc.devices.map((dc) => (
                          <span key={dc.value} className="text-[10px] font-mono bg-purple-50 text-purple-600 px-2 py-0.5 rounded" title={`出现 ${dc.count} 次`}>
                            {dc.value.slice(0, 14)} <span className="text-purple-400">({dc.count})</span>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  </>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 分页 */}
      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            第 {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filtered.length)} 条，共 {filtered.length} 条
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              className="px-2.5 py-1 text-xs rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            {pageItems.map((item, index) => (
              item === "..." ? (
                <span key={`gap-${index}`} className="px-1 text-xs text-slate-300">…</span>
              ) : (
                <button
                  key={item}
                  onClick={() => setPage(item)}
                  className={`min-w-[28px] px-2 py-1 text-xs rounded border ${
                    item === currentPage
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {item}
                </button>
              )
            ))}
            <button
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              className="px-2.5 py-1 text-xs rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
