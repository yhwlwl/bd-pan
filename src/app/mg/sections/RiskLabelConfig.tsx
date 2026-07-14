"use client";

import { useState, useEffect } from "react";
import { useAdmin } from "../lib/admin-context";

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

const RISK_NAMES: Record<number, string> = { 0:"无", 1:"低", 2:"中", 3:"高", 4:"极高", 5:"紧急", 6:"超管" };

const SECTION_LABELS: Record<string, string> = {
  overview:"总览", downloads:"下载明细", visits:"访问日志", actionlogs:"操作日志",
  announcements:"公告", fileperms:"文件权限", users:"用户管理", riskcontrol:"风控管理",
  settings:"设置", emergency:"应急",
};

const OP_LABELS: Record<string, string> = {
  "overview.viewStats":"查看指标卡","overview.viewOnlineUsers":"查看在线用户弹窗",
  "overview.viewRecentActions":"查看最近操作","overview.viewRecentDeny":"查看最近拦截",
  "overview.viewPreviews":"查看预览统计",
  "overview.switchDataSource":"切换数据源","overview.switchPageSource":"切换站来源",
  "downloads.viewChannels":"查看通道卡片","downloads.expandChannel":"展开通道详情",
  "downloads.viewHistory":"查看全部历史下载",
  "visits.viewIPs":"查看IP统计表","visits.switchSort":"切换排序/行数","visits.viewFlow":"查看Flow视图",
  "visits.banShort":"封禁IP 1h/24h","visits.unban":"解封IP","visits.banCustom":"封禁IP自定义时长",
  "actionlogs.viewTable":"查看操作日志","actionlogs.filter":"筛选日志","actionlogs.exportCSV":"导出CSV",
  "announcements.viewStatus":"查看公告状态","announcements.viewHistory":"查看历史公告",
  "announcements.publish":"发布/定时公告","announcements.toggle":"启用/停用公告","announcements.delete":"删除公告",
  "fileperms.viewRules":"查看规则列表","fileperms.previewRegex":"正则预览","fileperms.editRules":"编辑规则","fileperms.deleteRule":"删除规则",
  "users.viewList":"查看用户列表","users.viewPerms":"查看用户权限","users.viewAssociations":"查看关联IP/设备",
  "users.editBasePath":"修改目录隔离","users.addUser":"添加用户","users.changeRole":"修改角色","users.changePerms":"修改权限","users.deleteUser":"删除用户",
  "riskcontrol.viewSummary":"查看摘要条","riskcontrol.viewEntities":"查看实体表","riskcontrol.viewDetail":"查看实体详情",
  "riskcontrol.viewDenyEvents":"查看Deny事件","riskcontrol.adjustScore":"调整分数","riskcontrol.unban":"解封实体","riskcontrol.clearScore":"清空分数",
  "settings.view":"查看设置","settings.appearance":"修改站点外观","settings.dataRetention":"修改数据保留",
  "settings.global":"修改全局设置","settings.fileLimits":"修改文件限制","settings.loginLimits":"修改登录限制",
  "settings.denyConfig":"修改风控配置","settings.changePassword":"修改管理员密码","settings.riskLabels":"修改风险标签配置",
  "emergency.view":"查看应急面板","emergency.maintenance":"进入维护模式","emergency.restore":"恢复运行","emergency.banAllIPs":"封禁在线IP",
};

export default function RiskLabelConfig() {
  const { adminSettings, adminAction, fetchAllData } = useAdmin();
  const [labels, setLabels] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLabels({ ...DEFAULT_RISK_LABELS, ...(adminSettings?.mgRiskLabels || {}) });
  }, [adminSettings]);

  const showMsg = (t: string) => { setMsg(t); setTimeout(() => setMsg(null), 3000); };

  const save = async () => {
    // 只保存与默认值不同的
    const diff: Record<string, number> = {};
    for (const [k, v] of Object.entries(labels)) {
      if (v !== (DEFAULT_RISK_LABELS[k] ?? 0)) diff[k] = v;
    }
    const ok = await adminAction("updateSettings", { settings: { ...adminSettings, mgRiskLabels: diff } });
    if (ok) { showMsg("风险标签已保存"); fetchAllData(); }
  };

  const reset = async () => {
    if (!confirm("恢复所有风险标签为默认值？")) return;
    const ok = await adminAction("updateSettings", { settings: { ...adminSettings, mgRiskLabels: undefined } });
    if (ok) { setLabels({ ...DEFAULT_RISK_LABELS }); showMsg("已恢复默认值"); fetchAllData(); }
  };

  const toggle = (s: string) => setCollapsed(prev => ({ ...prev, [s]: !prev[s] }));

  // 按板块分组
  const sections = Object.keys(SECTION_LABELS);
  const getOps = (section: string) => Object.keys(labels).filter(k => k.startsWith(section + "."));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">风险标签配置</h2>
        <div className="flex gap-2">
          <button onClick={reset} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">恢复默认</button>
          <button onClick={save} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">保存配置</button>
        </div>
      </div>

      {msg && <div className="px-4 py-2 rounded-lg text-xs font-medium bg-green-50 text-green-600">{msg}</div>}

      <p className="text-xs text-slate-500">配置每个操作的风险等级。用户权限中「查看/修改最高到X级」即与此对比。</p>

      <div className="space-y-3">
        {sections.map(sec => {
          const ops = getOps(sec);
          const isCollapsed = collapsed[sec];
          return (
            <div key={sec} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <button onClick={() => toggle(sec)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 text-left">
                <span className="text-sm font-bold text-slate-700">{SECTION_LABELS[sec]}</span>
                <span className="text-xs text-slate-400">{isCollapsed ? "展开" : "收起"}</span>
              </button>
              {!isCollapsed && (
                <div className="border-t border-slate-100 divide-y divide-slate-50">
                  {ops.map(op => (
                    <div key={op} className="flex items-center justify-between px-5 py-2.5">
                      <span className="text-xs text-slate-600">{OP_LABELS[op] || op}</span>
                      <select
                        value={labels[op] ?? 0}
                        onChange={e => setLabels({ ...labels, [op]: parseInt(e.target.value) })}
                        className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
                      >
                        {[0,1,2,3,4,5,6].map(lv => (
                          <option key={lv} value={lv}>{RISK_NAMES[lv]}{lv > 0 ? ` (${lv})` : ""}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
