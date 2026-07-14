"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://pan.tantantan.tech/wlm-api";
const APP_SOURCE = process.env.NEXT_PUBLIC_APP_SOURCE || "weilaimeng";

// ============ 类型 ============

export interface AdminContextValue {
  token: string | null;
  role: string | null;
  username: string | null;
  isAdmin: boolean;
  userPerms: Record<string, boolean> | null;

  // 数据
  adminUsers: any[];
  adminStats: any;
  denyDashboard: any;
  adminSettings: any;
  globalDownloadModes: any;

  // UI 状态
  adminMsg: string | null;
  adminDataSource: "ecs" | "supabase";
  adminPageSource: string;
  refreshInterval: number;
  lastFetchTime: number | null;
  loading: boolean;

  // 操作
  fetchAllData: () => Promise<void>;
  adminAction: (action: string, body: any) => Promise<boolean>;
  setAdminDataSource: (v: "ecs" | "supabase") => void;
  setAdminPageSource: (v: string) => void;
  setAdminMsg: (v: string | null) => void;
  logout: () => void;
  logAdminAction: (actionType: string, actionItem: string) => void;
  canView: (sectionKey: string) => boolean;
  canModify: (operationKey: string) => boolean;

  // Deny 相关
  denyDetailEntity: { entity_type: string; entity_value: string } | null;
  setDenyDetailEntity: (v: { entity_type: string; entity_value: string } | null) => void;
  denyReasonLabel: Record<string, string>;
}

const denyReasonLabel: Record<string, string> = {
  nginx_db_token: "数据库 Token 探测",
  nginx_sensitive_file: "敏感文件探测",
  nginx_pdf_referer: "PDF 盗链",
  nginx_well_known: "安全漏洞探测",
  nginx_unknown: "Nginx 拦截",
  api_ip_banned: "已封禁 IP 尝试",
  api_auth_failed: "API 认证失败",
  api_login_failed: "登录失败",
  api_role_denied: "越权访问管理接口",
  api_permission_denied: "无操作权限",
  api_file_rule_denied: "文件规则拒绝",
  api_all_items_denied: "批量操作全拒",
  api_mg_unauthorized: "管理后台未授权访问",
  frontend: "前端拦截",
  admin_add_score: "管理员手动加分",
  admin_sub_score: "管理员手动减分",
};

// 默认风险标签（mgRiskLabels 未配时使用）
const DEFAULT_RISK_LABELS: Record<string, number> = {
  "overview.viewStats":1,"overview.viewOnlineUsers":1,"overview.viewRecentActions":1,
  "overview.viewRecentDeny":2,"overview.switchDataSource":2,"overview.switchPageSource":2,
  "overview.viewPreviews":1,
  "downloads.viewChannels":1,"downloads.expandChannel":1,"downloads.viewHistory":2,
  "visits.viewIPs":1,"visits.switchSort":1,"visits.viewFlow":1,
  "visits.banShort":2,"visits.unban":2,"visits.banCustom":3,
  "actionlogs.viewTable":1,"actionlogs.filter":1,"actionlogs.exportCSV":1,
  "announcements.viewStatus":1,"announcements.viewHistory":1,"announcements.publish":2,
  "announcements.toggle":2,"announcements.delete":3,
  "fileperms.viewRules":2,"fileperms.previewRegex":2,"fileperms.editRules":3,"fileperms.deleteRule":3,
  "users.viewList":2,"users.viewPerms":2,"users.viewAssociations":2,"users.editBasePath":2,
  "users.addUser":3,"users.changeRole":4,"users.changePerms":4,"users.deleteUser":4,
  "riskcontrol.viewSummary":3,"riskcontrol.viewEntities":3,"riskcontrol.viewDetail":3,
  "riskcontrol.viewDenyEvents":3,"riskcontrol.adjustScore":4,"riskcontrol.unban":4,"riskcontrol.clearScore":4,
  "settings.view":2,"settings.appearance":2,"settings.dataRetention":2,
  "settings.global":3,"settings.fileLimits":3,"settings.loginLimits":3,
  "settings.denyConfig":4,"settings.changePassword":6,"settings.riskLabels":6,
  "emergency.view":3,"emergency.maintenance":5,"emergency.restore":5,"emergency.banAllIPs":5,
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminProvider");
  return ctx;
}

// ============ Provider ============

export function AdminProvider({
  token,
  role,
  username,
  permissions,
  children,
}: {
  token: string;
  role: string;
  username: string;
  permissions: Record<string, boolean> | null;
  children: React.ReactNode;
}) {
  const isAdmin = role === "admin";

  // ─── 数据状态 ───
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminStats, setAdminStats] = useState<any>(null);
  const [denyDashboard, setDenyDashboard] = useState<any>(null);
  const [adminSettings, setAdminSettings] = useState<any>({ enableGuestMode: true, permissions: {}, downloadChannel: "ecs" });
  const [globalDownloadModes, setGlobalDownloadModes] = useState<any>({});
  const [adminMsg, setAdminMsg] = useState<string | null>(null);
  const [adminDataSource, setAdminDataSource] = useState<"ecs" | "supabase">("ecs");
  const [adminPageSource, setAdminPageSource] = useState(APP_SOURCE);
  const [lastFetchTime, setLastFetchTime] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [denyDetailEntity, setDenyDetailEntity] = useState<{ entity_type: string; entity_value: string } | null>(null);

  // 刷新间隔：优先从 settings 读取，默认 60s
  const refreshInterval = adminSettings?.refreshInterval ?? 60;
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── 数据获取（完全复用现有 API） ───

  const fetchAllData = useCallback(async () => {
    if (!token) return;
    try {
      // 统一拉全部（API 各路由有独立权限校验）
      const [usrRes, statsRes, denyRes] = await Promise.all([
        fetch(`${API_BASE}/api/users`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/admin-stats?source=${adminDataSource}&page_source=${adminPageSource}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/api/deny-stats`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null as any),
      ]);

      const data = await usrRes.json();
      const sData = await statsRes.json();

      if (data.users) setAdminUsers(data.users);
      if (data.settings) {
        setAdminSettings(data.settings);
        if (data.settings.downloadModes) setGlobalDownloadModes(data.settings.downloadModes);
      }
      if (sData.code === 200 && sData.data) setAdminStats(sData.data);

      if (denyRes && denyRes.ok) {
        const denyData = await denyRes.json().catch(() => null);
        if (denyData?.code === 200) setDenyDashboard(denyData);
      }

      setLastFetchTime(Date.now());
    } catch {
      // 静默失败，数据保持上一次的值
    } finally {
      setLoading(false);
    }
  }, [token, role, adminDataSource, adminPageSource]);

  // ─── 操作日志（必须在 adminAction 之前定义！） ───
  const logAdminAction = useCallback(
    (actionType: string, actionItem: string) => {
      if (!token) return;
      fetch(`${API_BASE}/api/log-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          username: username || "admin",
          action_type: `管理 - ${actionType}`,
          action_item: actionItem,
          session_id: "",
          fingerprint: "",
          device_code: "",
          source: APP_SOURCE,
        }),
      }).catch(() => {});
    },
    [token, username]
  );

  // ─── adminAction（完全复用现有 POST /api/users） ───

  const adminAction = useCallback(
    async (action: string, body: any): Promise<boolean> => {
      if (!token) return false;
      setAdminMsg(null);
      try {
        const res = await fetch(`${API_BASE}/api/users`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action, ...body }),
        });
        const data = await res.json();
        if (!res.ok) {
          setAdminMsg(`❌ ${data.error}`);
          return false;
        }
        if (data.users) setAdminUsers(data.users);
        if (data.settings) {
          setAdminSettings(data.settings);
          if (data.settings.downloadModes) setGlobalDownloadModes(data.settings.downloadModes);
        }
        setAdminMsg("操作成功");
        // 操作日志
        logAdminAction(
          action === "updateSettings" ? "修改设置" :
          action === "add" ? "添加用户" :
          action === "remove" ? "删除用户" :
          action === "updateRole" ? "修改用户角色" :
          action === "updatePermissions" ? "修改用户权限" :
          action === "changeAdminPassword" ? "修改管理员密码" : action,
          action === "updateSettings" ? JSON.stringify(body.settings || {}).substring(0, 200) :
          action === "add" ? body.username : action === "remove" ? body.username :
          action === "updateRole" ? `${body.username} → ${body.role}` :
          action === "updatePermissions" ? body.username : ""
        );
        return true;
      } catch {
        setAdminMsg("接口异常");
        return false;
      }
    },
    [token, logAdminAction]
  );

  // ─── 权限检查 ───
  const mgPerms: Record<string, { view: number; modify: number }> = (permissions as any)?.mgPermissions || {};
  const riskLabels = adminSettings?.mgRiskLabels || DEFAULT_RISK_LABELS;

  const sectionMap: Record<string, string> = {
    overview: "mgOverview", downloads: "mgDownloads", visits: "mgVisits",
    actionlogs: "mgActionLogs", announcements: "mgAnnouncements",
    fileperms: "mgFilePerms", users: "mgUsers", riskcontrol: "mgRiskControl",
    settings: "mgSettings", emergency: "mgEmergency",
  };

  const canView = useCallback(
    (sectionKey: string) => {
      if (isAdmin) return true;
      return (mgPerms[sectionKey]?.view ?? 0) > 0;
    },
    [isAdmin, mgPerms]
  );

  const canModify = useCallback(
    (operationKey: string) => {
      if (isAdmin) return true;
      const requiredRisk = riskLabels[operationKey] ?? 0;
      if (requiredRisk >= 6) return false; // 超管操作
      const section = operationKey.split(".")[0];
      const mgKey = sectionMap[section];
      if (!mgKey) return false;
      return (mgPerms[mgKey]?.modify ?? 0) >= requiredRisk;
    },
    [isAdmin, mgPerms, riskLabels]
  );

  // ─── 自动清除消息 ───

  useEffect(() => {
    if (adminMsg) {
      if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
      msgTimerRef.current = setTimeout(() => setAdminMsg(null), 3000);
    }
  }, [adminMsg]);

  // ─── 首次加载 + 定时刷新 ───

  useEffect(() => {
    fetchAllData();
    const interval = Math.max(10, Math.min(3600, refreshInterval));
    const timer = setInterval(fetchAllData, interval * 1000);
    return () => clearInterval(timer);
  }, [fetchAllData, refreshInterval]);

  const value: AdminContextValue = {
    token,
    role,
    username,
    isAdmin,
    userPerms: permissions,
    adminUsers,
    adminStats,
    denyDashboard,
    adminSettings,
    globalDownloadModes,
    adminMsg,
    adminDataSource,
    adminPageSource,
    refreshInterval,
    lastFetchTime,
    loading,
    fetchAllData,
    adminAction,
    setAdminDataSource,
    setAdminPageSource,
    setAdminMsg,
    denyDetailEntity,
    setDenyDetailEntity,
    denyReasonLabel,
    logout: () => window.location.reload(),
    logAdminAction,
    canView,
    canModify,
  };

  return React.createElement(AdminContext.Provider, { value }, children);
}
