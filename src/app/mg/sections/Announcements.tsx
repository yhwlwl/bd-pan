"use client";

import { useState, useEffect } from "react";
import { useAdmin } from "../lib/admin-context";

interface Ann {
  id: string;
  content: string;
  active: boolean;
  targetAudience: "all" | "guest" | "user";
  displayLocation: "login" | "main" | "all";
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const LOCATION_LABELS: Record<string, string> = {
  login: "仅登录页", main: "仅主页", all: "登录页+主页",
};

const AUDIENCE_LABELS: Record<string, string> = {
  all: "所有人", guest: "仅访客", user: "仅登录用户",
};

export default function Announcements() {
  const { adminSettings, adminAction, logAdminAction, fetchAllData, canModify } = useAdmin();
  const [announcements, setAnnouncements] = useState<Ann[]>([]);
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState<"all" | "guest" | "user">("all");
  const [location, setLocation] = useState<"login" | "main" | "all">("all");
  const [schedule, setSchedule] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (adminSettings?.announcements) {
      setAnnouncements(adminSettings.announcements);
    }
  }, [adminSettings]);

  const showMsg = (text: string) => { setMsg(text); setTimeout(() => setMsg(null), 3000); };

  const save = async (newList: Ann[]) => {
    const ok = await adminAction("updateSettings", { settings: { ...adminSettings, announcements: newList } });
    if (ok) {
      logAdminAction("公告", "更新公告列表");
      fetchAllData();
    }
    return ok;
  };

  const handlePublishNow = async () => {
    if (!draft.trim()) { showMsg("请输入公告内容"); return; }
    const now = new Date().toISOString();
    const item: Ann = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      content: draft.trim(),
      active: true,
      targetAudience: target,
      displayLocation: location,
      scheduledAt: null,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    // 停用其他公告
    const updated = [item, ...announcements.map(a => ({ ...a, active: false }))];
    if (await save(updated)) {
      setDraft("");
      showMsg("公告已发布");
    }
  };

  const handleSchedule = async () => {
    if (!draft.trim()) { showMsg("请输入公告内容"); return; }
    if (!schedule) { showMsg("请选择定时发布时间"); return; }
    const now = new Date().toISOString();
    const item: Ann = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      content: draft.trim(),
      active: false,
      targetAudience: target,
      displayLocation: location,
      scheduledAt: new Date(schedule).toISOString(),
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const updated = [item, ...announcements];
    if (await save(updated)) {
      setDraft("");
      setSchedule("");
      showMsg(`公告已定时于 ${new Date(schedule).toLocaleString("zh-CN")} 发布`);
    }
  };

  const toggleActive = async (id: string) => {
    const updated = announcements.map(a => {
      if (a.id === id) {
        const activating = !a.active;
        return {
          ...a,
          active: activating,
          publishedAt: activating && !a.publishedAt ? new Date().toISOString() : a.publishedAt,
          updatedAt: new Date().toISOString(),
          // 激活时停用其他
        };
      }
      // 如果正在激活这条，停用其他
      if (!announcements.find(x => x.id === id)?.active && a.active) {
        return { ...a, active: false };
      }
      return a;
    });
    // 如果正在激活，停用所有其他
    const activating = !announcements.find(a => a.id === id)?.active;
    const final = activating
      ? updated.map(a => (a.id !== id ? { ...a, active: false } : { ...a, active: true }))
      : updated;
    if (await save(final)) {
      showMsg(activating ? "公告已激活" : "公告已停用");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除此公告？")) return;
    const updated = announcements.filter(a => a.id !== id);
    if (await save(updated)) {
      logAdminAction("公告", `删除公告`);
      showMsg("公告已删除");
    }
  };

  const activeAnnouncement = announcements.find(a => a.active);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-slate-800">公告</h2>

      {msg && <div className={`px-4 py-2 rounded-lg text-xs font-medium ${msg.includes("已") ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}`}>{msg}</div>}

      {/* ===== 当前状态 ===== */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-3">当前状态</h3>
        {activeAnnouncement ? (
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-700 truncate">{activeAnnouncement.content}</div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                <span>{AUDIENCE_LABELS[activeAnnouncement.targetAudience]}</span>
                <span>·</span>
                <span>{LOCATION_LABELS[activeAnnouncement.displayLocation || "all"]}</span>
                <span>·</span>
                <span>发布于 {new Date(activeAnnouncement.publishedAt || activeAnnouncement.createdAt).toLocaleString("zh-CN")}</span>
              </div>
            </div>
            <span className="shrink-0 ml-3 px-2 py-1 bg-green-50 text-green-600 text-[10px] font-medium rounded">发布中</span>
          </div>
        ) : (
          <div className="text-sm text-slate-400">当前无公告</div>
        )}
        {/* 预览 */}
        {activeAnnouncement && (
          <button onClick={() => setPreview(!preview)} className="text-xs text-blue-600 hover:underline mt-2 inline-block">
            {preview ? "收起预览" : "预览效果"}
          </button>
        )}
        {preview && activeAnnouncement && (
          <div className="mt-3 py-2 px-4 rounded-lg text-xs text-center font-medium bg-amber-50 border border-amber-200 text-amber-700">
            {activeAnnouncement.content}
          </div>
        )}
        {/* 待定时发布 */}
        {announcements.filter(a => a.scheduledAt && !a.active && new Date(a.scheduledAt) > new Date()).length > 0 && (
          <div className="mt-3 text-[10px] text-amber-600">
            待发布: {announcements.filter(a => a.scheduledAt && !a.active && new Date(a.scheduledAt) > new Date()).length} 条
          </div>
        )}
      </div>

      {/* ===== 编辑新公告 ===== */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-4">新建公告</h3>

        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-3 text-sm h-24 resize-y"
          placeholder="输入公告内容..."
        />

        <div className="flex flex-wrap items-end gap-3 mt-3">
          <div>
            <label className="text-[10px] text-slate-500 block mb-1">目标受众</label>
            <select value={target} onChange={e => setTarget(e.target.value as any)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <option value="all">所有人</option>
              <option value="guest">仅访客</option>
              <option value="user">仅登录用户</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 block mb-1">显示位置</label>
            <select value={location} onChange={e => setLocation(e.target.value as any)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <option value="all">登录页+主页</option>
              <option value="login">仅登录页</option>
              <option value="main">仅主页</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 block mb-1">定时发布（可选）</label>
            <input type="datetime-local" value={schedule} onChange={e => setSchedule(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={handlePublishNow} disabled={!canModify("announcements.publish")} title={!canModify("announcements.publish") ? "无修改权限" : undefined} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed">立即发布</button>
          {schedule && (
            <button onClick={handleSchedule} disabled={!canModify("announcements.publish")} title={!canModify("announcements.publish") ? "无修改权限" : undefined} className="bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-4 py-2 text-sm font-medium hover:bg-amber-100 disabled:opacity-30 disabled:cursor-not-allowed">定时发布</button>
          )}
        </div>
      </div>

      {/* ===== 历史公告 ===== */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-700">历史公告 ({announcements.length})</h3>
        </div>
        {announcements.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-slate-400">暂无历史公告</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {announcements.map((a) => (
              <div key={a.id} className="px-5 py-3 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-700 line-clamp-2">{a.content}</div>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] text-slate-400">
                    <span>{AUDIENCE_LABELS[a.targetAudience]}</span>
                    <span>{LOCATION_LABELS[a.displayLocation || "all"]}</span>
                    {a.scheduledAt && new Date(a.scheduledAt) > new Date() ? (
                      <span className="text-amber-600 font-medium">定时: {new Date(a.scheduledAt).toLocaleString("zh-CN")}</span>
                    ) : a.publishedAt ? (
                      <span>发布于 {new Date(a.publishedAt).toLocaleString("zh-CN")}</span>
                    ) : (
                      <span>创建于 {new Date(a.createdAt).toLocaleString("zh-CN")}</span>
                    )}
                    {a.active && <span className="px-1.5 py-0.5 bg-green-50 text-green-600 rounded text-[9px] font-medium">发布中</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggleActive(a.id)} disabled={!canModify("announcements.toggle")} title={!canModify("announcements.toggle") ? "无修改权限" : undefined}
                    className={`text-[10px] px-2 py-1 rounded font-medium disabled:opacity-30 disabled:cursor-not-allowed ${a.active ? "bg-slate-50 text-slate-500 hover:bg-slate-100" : "bg-green-50 text-green-600 hover:bg-green-100"}`}>
                    {a.active ? "停用" : "启用"}
                  </button>
                  <button onClick={() => handleDelete(a.id)} disabled={!canModify("announcements.delete")} title={!canModify("announcements.delete") ? "无修改权限" : undefined}
                    className="text-[10px] px-2 py-1 rounded text-red-500 hover:bg-red-50 font-medium disabled:opacity-30 disabled:cursor-not-allowed">删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
