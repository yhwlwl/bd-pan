"use client";

import { useState, useMemo } from "react";
import { useAdmin } from "../lib/admin-context";

const PERM_LABELS: Record<string, string> = {
  view: "浏览", search: "搜索", download: "下载", upload: "上传",
  delete: "删除", rename: "重命名", preview: "预览",
  setting: "本地配置", mgAccess: "管理面板",
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

export default function UserManagement() {
  const { adminUsers, adminStats, denyDashboard, adminAction, fetchAllData, canModify, loading } = useAdmin();
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [newUserName, setNewUserName] = useState("");
  const [newUserPass, setNewUserPass] = useState("");
  const [newUserRole, setNewUserRole] = useState("manager");
  const [msg, setMsg] = useState<string | null>(null);

  if (loading) {
    return <div className="text-slate-500 text-sm py-12 text-center">⏳ 加载数据中...</div>;
  }

  const users = (adminUsers || []).filter((u: any) => u.username !== "admin");

  const toggleExpand = (username: string) => {
    setExpandedUser(prev => (prev === username ? null : username));
  };

  const handleAddUser = async () => {
    if (!newUserName || !newUserPass) { setMsg("请填写用户名和密码"); return; }
    const ok = await adminAction("add", { username: newUserName, password: newUserPass, role: newUserRole });
    if (ok) { setNewUserName(""); setNewUserPass(""); setNewUserRole("manager"); setMsg(null); }
    fetchAllData();
  };

  const handleRemoveUser = async (username: string) => {
    if (!confirm(`确定要删除用户 ${username} 吗？`)) return;
    await adminAction("remove", { username });
    fetchAllData();
  };

  const handleUpdateRole = async (username: string, role: string) => {
    await adminAction("updateRole", { username, role });
    fetchAllData();
  };

  const handleUpdatePerms = async (username: string, permissions: Record<string, boolean>) => {
    await adminAction("updatePermissions", { username, permissions });
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

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-slate-800">用户管理</h2>

      {msg && (
        <div className={`px-4 py-2 rounded-lg text-xs font-medium ${msg.startsWith("✅") ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}`}>
          {msg}
        </div>
      )}

      {/* 添加用户 */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-3">添加用户</h3>
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
      </div>

      {/* 用户列表 */}
      <div className="space-y-3">
        {users.map((u: any) => {
          const isExpanded = expandedUser === u.username;
          const assoc = userAssociations[u.username] || { ips: [], devices: [] };
          const currentPerms = u.permissions || {};

          return (
            <div key={u.username} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {/* 折叠标题行 */}
              <div
                onClick={() => toggleExpand(u.username)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium text-slate-700">{u.username}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                    u.role === "admin" ? "bg-red-50 text-red-600" :
                    u.role === "manager" ? "bg-blue-50 text-blue-600" :
                    "bg-slate-50 text-slate-500"
                  }`}>
                    {ROLE_LABELS[u.role] || u.role}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={u.role}
                    onChange={(e) => { e.stopPropagation(); handleUpdateRole(u.username, e.target.value); }}
                    onClick={(e) => e.stopPropagation()}
                    disabled={!canModify("users.changeRole")}
                    className="text-[10px] border border-slate-200 rounded px-2 py-1 text-slate-600 bg-white disabled:opacity-30"
                  >
                    <option value="admin">超级管理员</option>
                    <option value="manager">管理员</option>
                    <option value="guest">游客</option>
                  </select>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemoveUser(u.username); }}
                    disabled={!canModify("users.deleteUser")} title={!canModify("users.deleteUser") ? "无修改权限" : undefined}
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
                          <label key={key} className={`flex items-center gap-2 text-xs cursor-pointer ${key === "view" ? "" : ""}`}>
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
                        value={currentPerms.basePath || ""}
                        onChange={(e) => handleUpdatePerms(u.username, { ...currentPerms, basePath: e.target.value })}
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
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
