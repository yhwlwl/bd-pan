"use client";

import { useState } from "react";
import { AdminProvider } from "./lib/admin-context";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://pan.tantantan.tech/wlm-api";

export default function MgLayout({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<{
    token: string;
    role: string;
    username: string;
    permissions: Record<string, boolean> | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ username: "", password: "" });

  // 登录
  const handleLogin = async () => {
    if (!form.username || !form.password) { setError("请输入用户名和密码"); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.username, password: form.password }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || `登录失败 (${res.status})`);
        setLoading(false);
        return;
      }
      // 仅 admin/manager 可进入管理后台
      if (data.role !== "admin" && data.role !== "manager") {
        setError("权限不足，仅管理员可访问");
        setLoading(false);
        return;
      }
      // 记录登录日志
      fetch(`${API_BASE}/api/log-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.token}` },
        body: JSON.stringify({
          username: data.username,
          action_type: "管理 - 登录后台",
          action_item: "/mg",
          session_id: data.sessionId || "",
          fingerprint: "",
          device_code: "",
          source: process.env.NEXT_PUBLIC_APP_SOURCE || "weilaimeng",
        }),
      }).catch(() => {});

      setAuth({
        token: data.token,
        role: data.role,
        username: data.username,
        permissions: data.permissions || null,
      });
    } catch {
      setError("网络异常，请重试");
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLogin();
  };

  // 未登录 → 显示登录页面
  if (!auth) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="w-full max-w-sm mx-4">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <div className="text-center mb-8">
              <h1 className="text-xl font-bold text-slate-800">WLM-PAN 管理后台</h1>
              <p className="text-sm text-slate-500 mt-1">请使用管理员账号登录</p>
            </div>

            {error && (
              <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">用户名</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  onKeyDown={handleKeyDown}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                  placeholder="管理员用户名"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">密码</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  onKeyDown={handleKeyDown}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                  placeholder="管理员密码"
                />
              </div>
              <button
                onClick={handleLogin}
                disabled={loading}
                className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {loading ? "验证中..." : "登录"}
              </button>
            </div>
          </div>

          <p className="text-center text-xs text-slate-400 mt-6">
            仅限管理员访问 · 登录操作将被记录
          </p>
        </div>
      </div>
    );
  }

  // 已登录 → 渲染管理后台
  return (
    <AdminProvider
      token={auth.token}
      role={auth.role}
      username={auth.username}
      permissions={auth.permissions}
    >
      {children}
    </AdminProvider>
  );
}
