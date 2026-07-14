"use client";

import { useAdmin } from "../lib/admin-context";

interface SidebarProps {
  currentTab: string;
  visibleTabs: { key: string; label: string }[];
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  onNavigate: (key: string) => void;
}

export default function Sidebar({ currentTab, visibleTabs, sidebarOpen, setSidebarOpen, onNavigate }: SidebarProps) {
  const {
    isAdmin,
    adminStats,
    adminDataSource,
    adminPageSource,
    setAdminDataSource,
    setAdminPageSource,
    fetchAllData,
    lastFetchTime,
    refreshInterval,
    logout,
    canModify,
  } = useAdmin();

  const onlineCount = adminStats?.onlineUsers?.length || 0;

  return (
    <>
      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 侧边栏 */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50 w-60 bg-slate-900 text-white flex flex-col
          transition-transform duration-200 lg:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* 品牌区 */}
        <div className="px-5 py-4 border-b border-slate-700/50 shrink-0">
          <h1 className="text-sm font-bold tracking-wide">WLM-PAN 管理后台</h1>
          <p className="text-[10px] text-slate-400 mt-0.5">未来梦在线阅读平台</p>
        </div>

        {/* 导航区 */}
        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
          {visibleTabs.map((t) => {
            const isActive = currentTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => onNavigate(t.key)}
                className={`
                  w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors text-left
                  ${isActive
                    ? "bg-blue-600 text-white font-medium shadow-sm"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }
                `}
              >
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </nav>

        {/* 底部状态区 */}
        <div className="px-4 py-3 border-t border-slate-700/50 space-y-2 shrink-0 text-[11px] text-slate-400">
          {/* 在线用户 */}
          <button
            onClick={() => {
              // 切换到总览并触发在线用户弹窗
              onNavigate("overview");
            }}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-800 transition-colors"
          >
            <span>在线用户</span>
            <span className="font-bold text-emerald-400">{onlineCount}</span>
          </button>

          {/* 数据源（仅 admin） */}
          {isAdmin && (
            <div className="flex items-center gap-2 px-2">
              <select
                value={adminDataSource}
                onChange={(e) => setAdminDataSource(e.target.value as "ecs" | "supabase")}
                disabled={!canModify("overview.switchDataSource")}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-300 flex-1 disabled:opacity-30"
              >
                <option value="ecs">ECS</option>
                <option value="supabase">Supabase</option>
              </select>
              <select
                value={adminPageSource}
                onChange={(e) => setAdminPageSource(e.target.value)}
                disabled={!canModify("overview.switchPageSource")}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-300 flex-1 disabled:opacity-30"
              >
                <option value="weilaimeng">未来梦</option>
                <option value="pan">主站</option>
                <option value="all">全部</option>
              </select>
            </div>
          )}

          {/* 刷新信息 */}
          <div className="px-2 space-y-0.5">
            <div className="flex items-center justify-between">
              <span>刷新间隔</span>
              <span>{refreshInterval}s</span>
            </div>
            {lastFetchTime && (
              <div className="flex items-center justify-between">
                <span>上次刷新</span>
                <span>{new Date(lastFetchTime).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              </div>
            )}
          </div>

          {/* 手动刷新 */}
          <button
            onClick={fetchAllData}
            className="w-full text-center py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors text-[11px]"
          >
            手动刷新
          </button>

          {/* 返回主站 */}
          <a href="/" className="block text-center py-1.5 text-slate-400 hover:text-white transition-colors">
            返回主站
          </a>

          {/* 退出登录 */}
          <button onClick={() => { if (confirm("确定退出管理后台？")) logout(); }} className="w-full text-center py-1.5 text-slate-400 hover:text-red-400 transition-colors text-[11px]">
            退出登录
          </button>
        </div>
      </aside>
    </>
  );
}
