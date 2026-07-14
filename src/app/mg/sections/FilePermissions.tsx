"use client";

import { useState, useEffect } from "react";
import { useAdmin } from "../lib/admin-context";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://pan.tantantan.tech/wlm-api";

const ACTION_LABELS: Record<string, string> = {
  view: "浏览", download: "下载", preview: "预览", upload: "上传",
  delete: "删除", rename: "重命名", search: "搜索",
};

interface FileRule {
  id: string;
  path: string;
  pathType: "file" | "dir" | "regex";
  regexScope?: "name" | "path";
  groupName?: string;
  users: string[];
  deny: Record<string, boolean>;
}

export default function FilePermissions() {
  const { token, fetchAllData, logAdminAction, canModify } = useAdmin();
  const [rules, setRules] = useState<FileRule[]>([]);
  const [allUsers, setAllUsers] = useState<{ username: string; role: string }[]>([]);
  const [selectedRule, setSelectedRule] = useState<FileRule | null>(null);
  const [draft, setDraft] = useState<FileRule>({
    id: "", path: "/", pathType: "dir", users: [], deny: {},
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [regexPreview, setRegexPreview] = useState<any>(null);

  // 加载规则
  const loadRules = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/file-permissions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.rules) setRules(data.rules);
      if (data.users) setAllUsers(data.users);
    } catch { setMsg("加载文件权限规则失败"); }
  };

  useEffect(() => { loadRules(); }, []);

  // 保存规则
  const saveRules = async (newRules: FileRule[]) => {
    try {
      const res = await fetch(`${API_BASE}/api/file-permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rules: newRules }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "保存失败"); return; }
      setRules(newRules);
      setSelectedRule(null);
      setMsg("规则已保存");
      logAdminAction("文件权限", `保存规则: ${draft.path}`);
      setTimeout(() => setMsg(null), 2000);
    } catch { setMsg("保存文件权限规则失败"); }
  };

  // 正则预览
  const previewRegex = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/file-permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "preview",
          pattern: draft.path,
          scopePath: "/",
          regexScope: draft.regexScope || "path",
        }),
      });
      const data = await res.json();
      setRegexPreview(data);
    } catch { setRegexPreview({ error: "预览接口异常" }); }
  };

  const handleSaveDraft = () => {
    if (!draft.path.trim()) return;
    const newRules = selectedRule
      ? rules.map((r) => (r.id === draft.id ? { ...draft, id: draft.id || crypto.randomUUID() } : r))
      : [...rules, { ...draft, id: crypto.randomUUID() }];
    // 清理 deny 中 false 值
    const cleaned = newRules.map((r) => ({
      ...r,
      deny: Object.fromEntries(Object.entries(r.deny).filter(([, v]) => v)),
    }));
    saveRules(cleaned);
  };

  const handleDeleteRule = (id: string) => {
    const rule = rules.find(r => r.id === id);
    if (!confirm("确定删除此规则？")) return;
    if (rule) logAdminAction("文件权限", `删除规则: ${rule.path}`);
    saveRules(rules.filter((r) => r.id !== id));
  };

  const editRule = (rule: FileRule) => {
    setSelectedRule(rule);
    setDraft({ ...rule });
  };

  const newRule = () => {
    setSelectedRule(null);
    setDraft({ id: "", path: "/", pathType: "dir", users: [], deny: {} });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-slate-800">文件权限</h2>

      {msg && (
        <div className={`px-4 py-2 rounded-lg text-xs font-medium ${msg.startsWith("✅") ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}`}>
          {msg}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        {/* 左侧：规则列表 */}
        <div className="lg:w-2/5 space-y-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-slate-700">规则列表 ({rules.length})</h3>
            <button onClick={newRule} disabled={!canModify("fileperms.editRules")} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed">新建规则</button>
          </div>
          {rules.map((rule) => (
            <button
              key={rule.id}
              onClick={() => editRule(rule)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                selectedRule?.id === rule.id ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700 truncate max-w-[200px]">{rule.path}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  rule.pathType === "regex" ? "bg-purple-50 text-purple-600" :
                  rule.pathType === "dir" ? "bg-blue-50 text-blue-600" : "bg-slate-50 text-slate-500"
                }`}>
                  {rule.pathType === "regex" ? "正则" : rule.pathType === "dir" ? "目录" : "文件"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {Object.entries(rule.deny).map(([k]) => (
                  <span key={k} className="text-[9px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded">{ACTION_LABELS[k] || k}</span>
                ))}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">用户: {rule.users.length > 0 ? rule.users.join(", ") : "（全部）"}</div>
            </button>
          ))}
        </div>

        {/* 右侧：规则编辑器 */}
        <div className="lg:w-3/5 bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-bold text-slate-700 mb-4">
            {selectedRule ? "编辑规则" : "新建规则"}
          </h3>

          {/* 路径 */}
          <div className="mb-3">
            <label className="text-[10px] text-slate-500 block mb-1">路径</label>
            <input
              value={draft.path}
              onChange={(e) => setDraft({ ...draft, path: e.target.value })}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder={draft.pathType === "regex" ? "正则表达式" : "/path/to/file"}
            />
          </div>

          {/* 路径类型 */}
          <div className="flex items-center gap-3 mb-3">
            <label className="text-[10px] text-slate-500">类型</label>
            <select
              value={draft.pathType}
              onChange={(e) => setDraft({ ...draft, pathType: e.target.value as "file" | "dir" | "regex" })}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs"
            >
              <option value="dir">目录</option>
              <option value="file">文件</option>
              <option value="regex">正则</option>
            </select>
            {draft.pathType === "regex" && (
              <>
                <select
                  value={draft.regexScope || "path"}
                  onChange={(e) => setDraft({ ...draft, regexScope: e.target.value as "name" | "path" })}
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs"
                >
                  <option value="path">匹配路径</option>
                  <option value="name">匹配文件名</option>
                </select>
                <button onClick={previewRegex} disabled={!canModify("fileperms.previewRegex")} title={!canModify("fileperms.previewRegex") ? "无修改权限" : undefined} className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed">
                  预览匹配
                </button>
              </>
            )}
          </div>

          {/* 正则预览结果 */}
          {regexPreview && (
            <div className="mb-3 p-3 bg-slate-50 rounded-lg text-xs">
              {regexPreview.error ? (
                <span className="text-red-500">{regexPreview.error}</span>
              ) : (
                <>
                  <div className="text-slate-500 mb-1">匹配 {regexPreview.total} 个文件{regexPreview.truncated ? "（结果已截断）" : ""}</div>
                  <div className="max-h-[150px] overflow-y-auto space-y-0.5">
                    {(regexPreview.files || []).slice(0, 10).map((f: string, i: number) => (
                      <div key={i} className="font-mono text-slate-600">{f}</div>
                    ))}
                  </div>
                </>
              )}
              <button onClick={() => setRegexPreview(null)} className="text-blue-600 mt-1">关闭</button>
            </div>
          )}

          {/* 选择用户 */}
          <div className="mb-3">
            <label className="text-[10px] text-slate-500 block mb-1">适用用户（不选=全部用户）</label>
            <div className="flex flex-wrap gap-1.5">
              {allUsers.map((u) => {
                const selected = draft.users.includes(u.username);
                return (
                  <button
                    key={u.username}
                    onClick={() => {
                      const next = selected
                        ? draft.users.filter((n) => n !== u.username)
                        : [...draft.users, u.username];
                      setDraft({ ...draft, users: next });
                    }}
                    className={`text-[10px] px-2 py-1 rounded font-medium transition-colors ${
                      selected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {u.username}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 拒绝动作 */}
          <div className="mb-4">
            <label className="text-[10px] text-slate-500 block mb-1">拒绝动作</label>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(ACTION_LABELS).map(([key, label]) => {
                const checked = draft.deny[key] === true;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      const next = { ...draft.deny, [key]: !checked };
                      if (!next[key]) delete next[key];
                      setDraft({ ...draft, deny: next });
                    }}
                    className={`text-[10px] px-2 py-1 rounded font-medium transition-colors ${
                      checked ? "bg-red-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2">
            <button onClick={handleSaveDraft} disabled={!canModify("fileperms.editRules")} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed">保存</button>
            {selectedRule && (
              <button onClick={() => handleDeleteRule(selectedRule.id)} disabled={!canModify("fileperms.deleteRule")} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 disabled:opacity-30 disabled:cursor-not-allowed">删除</button>
            )}
            <button onClick={newRule} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200">
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
