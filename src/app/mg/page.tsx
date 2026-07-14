"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAdmin } from "./lib/admin-context";
import Sidebar from "./sections/Sidebar";
import Overview from "./sections/Overview";
import Downloads from "./sections/Downloads";
import Visits from "./sections/Visits";
import ActionLogs from "./sections/ActionLogs";
import RiskControl from "./sections/RiskControl";
import UserManagement from "./sections/UserManagement";
import FilePermissions from "./sections/FilePermissions";
import Announcements from "./sections/Announcements";
import Emergency from "./sections/Emergency";
import RiskLabelConfig from "./sections/RiskLabelConfig";
import Settings from "./sections/Settings";

const TABS: { key: string; label: string; sectionKey: string; permKey?: string }[] = [
  { key: "overview", label: "总览", sectionKey: "mgOverview", permKey: "viewStats" },
  { key: "downloads", label: "下载明细", sectionKey: "mgDownloads", permKey: "viewDownloadLogs" },
  { key: "visits", label: "访问日志", sectionKey: "mgVisits", permKey: "viewIpStats" },
  { key: "action-logs", label: "操作日志", sectionKey: "mgActionLogs", permKey: "viewActionLogs" },
  { key: "risk-control", label: "风控管理", sectionKey: "mgRiskControl" },
  { key: "users", label: "用户管理", sectionKey: "mgUsers" },
  { key: "file-permissions", label: "文件权限", sectionKey: "mgFilePerms" },
  { key: "emergency", label: "应急", sectionKey: "mgEmergency" },
  { key: "announcements", label: "公告", sectionKey: "mgAnnouncements" },
  { key: "risk-labels", label: "风险标签", sectionKey: "mgSettings" },
  { key: "settings", label: "设置", sectionKey: "mgSettings" },
];

function MgContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isAdmin, canView, userPerms, loading } = useAdmin();
  const tab = searchParams.get("tab") || "overview";
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const visibleTabs = TABS.filter((t) => {
    if (isAdmin) return true;
    if (t.sectionKey === "mgFilePerms" && !userPerms?.controlFile) return false;
    return canView(t.sectionKey);
  });

  useEffect(() => {
    if (!visibleTabs.find((t) => t.key === tab)) {
      router.replace("/mg?tab=overview");
    }
  }, [tab, visibleTabs, router]);

  const handleNav = (key: string) => {
    router.push(`/mg?tab=${key}`);
    setSidebarOpen(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500">加载数据中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar currentTab={tab} visibleTabs={visibleTabs} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} onNavigate={handleNav} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="text-slate-600 hover:text-slate-900 p-1">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-bold text-slate-700 text-sm">WLM-PAN</span>
          <div className="w-6" />
        </header>
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          <div className="max-w-[1400px] mx-auto">
            {tab === "overview" && <Overview />}
            {tab === "downloads" && <Downloads />}
            {tab === "visits" && <Visits />}
            {tab === "action-logs" && <ActionLogs />}
            {tab === "risk-control" && <RiskControl />}
            {tab === "users" && <UserManagement />}
            {tab === "file-permissions" && <FilePermissions />}
            {tab === "emergency" && <Emergency />}
            {tab === "announcements" && <Announcements />}
            {tab === "risk-labels" && <RiskLabelConfig />}
            {tab === "settings" && <Settings />}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function MgPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen bg-slate-50"><div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>}>
      <MgContent />
    </Suspense>
  );
}
