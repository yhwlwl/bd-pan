
"use client";
import { useState, useEffect, useRef } from 'react';
import CHANGELOG_DATA from '../data/changelog.json';

const ALIST_BASE_DEFAULT = (process.env.NEXT_PUBLIC_ALIST_URL || 'https://pan.tantantan.tech:5245').replace(/\/+$/, '');

type Role = 'admin' | 'manager' | 'guest';
type Theme = 'light' | 'dark';

export interface UserPermissions {
  view: boolean;
  search: boolean;
  download: boolean;
  upload: boolean;
  delete: boolean;
  rename: boolean;
  preview: boolean;
  setting?: boolean;
  controlFile?: boolean;
  basePath?: string;
  viewStats?: boolean;
  viewActionLogs?: boolean;
  viewIpStats?: boolean;
  viewDownloadLogs?: boolean;
}

type FilePermissionAction = 'view' | 'search' | 'download' | 'upload' | 'delete' | 'rename' | 'preview';

interface FilePermissionRule {
  id: string;
  path: string;
  pathType: 'file' | 'dir' | 'regex';
  regexScope?: 'name' | 'path';
  groupName?: string;
  users: string[];
  deny: Partial<Record<FilePermissionAction, boolean>>;
  createdAt?: number;
  updatedAt?: number;
}

export type DownloadModeState = 'enabled' | 'disabled' | 'hidden';

type AlistItem = {
  name: string;
  is_dir?: boolean;
  size?: number;
  modified?: string;
  sign?: string;
  path?: string;
  parent?: string;
  provider?: string;
};

export interface GlobalSettings {
  enableGuestMode: boolean;
  permissions?: Record<string, UserPermissions>;
  filePermissionRules?: FilePermissionRule[];
  disableThirdDownload?: boolean;
  downloadChannel?: 'ecs' | 'frp';
  downloadModes?: {
    ecs: DownloadModeState;
    cf: DownloadModeState;
    raw: DownloadModeState;
    vercel: DownloadModeState;
    direct302: DownloadModeState;
  };
  bannedIps?: Record<string, number>;
  hideAlistButton?: boolean;
  announcement?: string;
  sessionDurationHours?: number;
}

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [userPerms, setUserPerms] = useState<UserPermissions | null>(null);
  const [theme, setTheme] = useState<Theme>('dark');

  // 登录表单
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // AList 文件浏览
  const [alistPath, setAlistPath] = useState('/');
  const [alistFiles, setAlistFiles] = useState<any[]>([]);
  const [alistLoading, setAlistLoading] = useState(false);
  const [alistError, setAlistError] = useState<string | null>(null);
  const [alistMsg, setAlistMsg] = useState<string | null>(null);
  const [alistProvider, setAlistProvider] = useState<string>('');
  const [currentPathPerms, setCurrentPathPerms] = useState<{ delete: boolean; rename: boolean; upload: boolean; search: boolean } | null>(null);
  const [alistSelected, setAlistSelected] = useState<Set<string>>(new Set());
  const [alistSearchKeyword, setAlistSearchKeyword] = useState('');
  const [alistSearchScope, setAlistSearchScope] = useState<0 | 1>(1);
  const [alistSearchLoading, setAlistSearchLoading] = useState(false);
  const [alistSearchError, setAlistSearchError] = useState<string | null>(null);
  const [alistSearchResults, setAlistSearchResults] = useState<AlistItem[]>([]);
  const [alistSearchActive, setAlistSearchActive] = useState(false);
  const alistSearchRunRef = useRef(0);

  // 文件操作
  const [alistShowMkdir, setAlistShowMkdir] = useState(false);
  const [alistMkdirName, setAlistMkdirName] = useState('');
  const [alistUploadFiles, setAlistUploadFiles] = useState<File[]>([]);
  const [alistUploading, setAlistUploading] = useState(false);
  const [uploadProgressMsg, setUploadProgressMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [alistRenaming, setAlistRenaming] = useState<string | null>(null);
  const [alistNewName, setAlistNewName] = useState('');
  const [alistDownloadModal, setAlistDownloadModal] = useState<{ name: string; filePath: string; sign?: string } | null>(null);
  const [alistCopyLinkModal, setAlistCopyLinkModal] = useState<{ url: string; fileName: string } | null>(null);
  const [nodeLatencies, setNodeLatencies] = useState<Record<string, number | null>>({});
  const [isCompressing, setIsCompressing] = useState(false);
  const [batchModeModal, setBatchModeModal] = useState<{ folders: Array<{ name: string; filePath: string }>; files: Array<{ name: string; file: any; filePath: string }> } | null>(null);
  const [t2Progress, setT2Progress] = useState<{ current: number; total: number; msg: string } | null>(null);
  // 文件预览
  const [previewFile, setPreviewFile] = useState<{ name: string; url: string; type: 'image' | 'video' | 'text' | 'pdf' | 'archive' | 'office'; filePath: string; sign?: string; size?: number } | null>(null);
  const [previewItemMeta, setPreviewItemMeta] = useState<{ name: string; filePath: string; sign?: string; size?: number; type?: 'image' | 'video' | 'text' | 'pdf' | 'archive' | 'office' | 'unknown'; perms?: { download?: boolean; preview?: boolean } } | null>(null);
  const [previewText, setPreviewText] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewStarted, setPreviewStarted] = useState(false);
  const [archiveItems, setArchiveItems] = useState<any[]>([]);

  // 更新日志弹窗
  const [showChangelog, setShowChangelog] = useState(false);
  // 使用手册弹窗
  const [showManual, setShowManual] = useState(false);

  // 管理面板
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminUsers, setAdminUsers] = useState<{ username: string; role: Role; permissions: UserPermissions }[]>([]);
  const [adminStats, setAdminStats] = useState<any>(null);
  const [adminSettings, setAdminSettings] = useState<GlobalSettings>({
    enableGuestMode: true,
    permissions: {},
    downloadChannel: 'ecs',
    hideAlistButton: true,
  });
  const [globalDownloadModes, setGlobalDownloadModes] = useState<GlobalSettings['downloadModes']>({
    ecs: 'enabled', cf: 'enabled', raw: 'enabled', vercel: 'disabled', direct302: 'enabled'
  });
  const [globalAnnouncement, setGlobalAnnouncement] = useState('');
  const [downloadChannel, setDownloadChannel] = useState<'ecs' | 'frp'>('ecs');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPass, setNewUserPass] = useState('');
  const [newUserRole, setNewUserRole] = useState<Role>('manager');
  const [adminMsg, setAdminMsg] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [showFilePermPanel, setShowFilePermPanel] = useState(false);
  const [filePermUsers, setFilePermUsers] = useState<{ username: string; role: Role }[]>([]);
  const [filePermRules, setFilePermRules] = useState<FilePermissionRule[]>([]);
  const [filePermMsg, setFilePermMsg] = useState<string | null>(null);
  const [filePermTypeLocked, setFilePermTypeLocked] = useState(false);
  const [regexPreview, setRegexPreview] = useState<{
    loading: boolean;
    total: number;
    files: Array<{ name: string; path: string; is_dir: boolean }>;
    truncated: boolean;
    error?: string;
    debug?: { alistTotal: number; listedDirs?: number; elapsedMs: number };
  } | null>(null);
  const [filePermDraft, setFilePermDraft] = useState<FilePermissionRule>({
    id: '',
    path: '/',
    pathType: 'file',
    groupName: '',
    users: ['guest'],
    deny: { view: true, download: true, preview: true },
  });

  const [ipLimit, setIpLimit] = useState<number>(5);
  const [ipSort, setIpSort] = useState<'count' | 'time' | 'flow'>('count');
  const [riskLimit, setRiskLimit] = useState<number>(5);
  const [logFilter, setLogFilter] = useState<string>('全部');
  const [selectedChannelDetailedStats, setSelectedChannelDetailedStats] = useState<string | null>(null);
  const [allDownloadStatsModal, setAllDownloadStatsModal] = useState<{ title: string; logs: any[] } | null>(null);
  // === 远端 AList 设置（仅本地生效） ===
  const [showSettings, setShowSettings] = useState(false);
  const [customUrl, setCustomUrl] = useState('');
  const [customUser, setCustomUser] = useState('');
  const [customPass, setCustomPass] = useState('');

  const isAdmin = userRole === 'admin';
  const canControlFile = isAdmin || userPerms?.controlFile === true;
  const canDownload = userPerms ? userPerms.download : false;
  const canUpload = userPerms ? userPerms.upload : false;
  const canDelete = userPerms ? userPerms.delete : false;
  const canRename = userPerms ? userPerms.rename : false;
  const canView = userPerms ? userPerms.view : false;
  const canSearch = userRole === 'admin' ? true : (userPerms ? userPerms.search : false);

  const [alistDeleteConfirm, setAlistDeleteConfirm] = useState<{ name: string; isDir: boolean } | null>(null);
  const [alistDeleteInput, setAlistDeleteInput] = useState('');

  const getCustomConfig = () => {
    if (typeof window !== 'undefined') {
      try {
        const str = localStorage.getItem('ALIST_CUSTOM_CONFIG');
        if (str) return JSON.parse(str);
      } catch (e) { }
    }
    return null;
  };

  const getPreviewType = (name: string): 'image' | 'video' | 'text' | 'pdf' | 'archive' | 'office' | null => {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'ogg', 'mov'].includes(ext)) return 'video';
    if (['txt', 'md', 'log', 'json', 'csv', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'sh', 'bat', 'sql', 'go', 'rs', 'rb', 'php', 'swift', 'kt'].includes(ext)) return 'text';
    if (ext === 'pdf') return 'pdf';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
    if (['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext)) return 'office';
    return null;
  };

  const getChildPath = (parentPath: string, name: string) => `${parentPath.replace(/\/+$/, '')}/${name}`;
  const getParentPath = (path: string) => path.replace(/\/[^/]+\/?$/, '') || '/';
  const normalizeVisiblePath = (path: string) => {
    const raw = (path || '/').trim();
    if (!raw || raw === '/') return '/';
    return (raw.startsWith('/') ? raw : `/${raw}`).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  };
  const applyBasePathToVisiblePath = (path: string, basePath?: string) => {
    const normalizedPath = normalizeVisiblePath(path);
    const normalizedBase = normalizeVisiblePath(basePath || '/');
    if (normalizedBase === '/') return normalizedPath;
    if (normalizedPath === '/') return normalizedBase;
    if (normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`)) {
      return normalizedPath;
    }
    return `${normalizedBase}${normalizedPath}`.replace(/\/+/g, '/');
  };
  const getPathProviderHints = (path: string, provider?: string) => {
    const providerText = (provider || '').toLowerCase();
    const pathText = path.toLowerCase();
    return {
      isBaidu: providerText.includes('baidu') || pathText.includes('baidu') || path.includes('百度网盘'),
      isAliyun: providerText.includes('aliyun') || pathText.includes('aliyun') || path.includes('阿里云盘'),
    };
  };
  const matchesSearchKeyword = (name: string, keyword: string) => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return true;
    const normalizedName = name.toLowerCase();
    return normalizedName.includes(normalizedKeyword)
      || (normalizedKeyword.startsWith('.') && normalizedName.endsWith(normalizedKeyword));
  };
  const normalizeSearchResults = (payload: any): AlistItem[] => {
    const items = Array.isArray(payload?.data?.content) ? payload.data.content : [];
    return items.map((item: any) => ({
      ...item,
      path: item?.path || item?.obj_path || item?.full_path,
      parent: item?.parent,
      is_dir: Boolean(item?.is_dir),
    }));
  };
  const filterSearchResults = (items: AlistItem[], keyword: string) => {
    return items.filter((item) => matchesSearchKeyword(item.name, keyword));
  };

  const openPreview = async (item: any, filePath: string) => {
    const type = getPreviewType(item.name) || 'unknown';
    setPreviewItemMeta({ name: item.name, filePath, sign: item.sign, size: item.size, type: type as any, perms: (item as any).perms });
    setPreviewStarted(false);
    setPreviewFile(null);
    setPreviewText('');
    setArchiveItems([]);
    return true;
  };

  const loadPreviewContent = async () => {
    if (!userPerms?.preview) {
      setAlistMsg('❌ 您没有在线预览的权限');
      return;
    }
    if (!previewItemMeta || !previewItemMeta.type || previewItemMeta.type === 'unknown') return;
    const { name, filePath, sign, size, type } = previewItemMeta;

    setPreviewLoading(true);
    setPreviewStarted(true);
    setPreviewText('');

    // 记录预览日志
    logUserAction('预览', filePath);

    const prov = alistProvider.toLowerCase();
    const isBaidu = prov.includes('baidu') || alistPath.toLowerCase().includes('baidu') || alistPath.includes('百度网盘');

    try {
      if (type === 'archive') {
        const ext = name.split('.').pop()?.toLowerCase();
        setPreviewText(`📦 ${ext?.toUpperCase() || '未知'} 压缩包暂不支持在线预览目录。\n\n请点击右上角 ⬇️ 下载按钮将压缩包保存到本地后查看内容。`);
        setPreviewFile({ name, url: '', type, filePath, sign, size });
        setPreviewLoading(false);
        return true;
      }

      // 获取文件直链
      const res = await fetchAlist({ action: 'get', path: filePath });
      const data = await res.json();
      if (data.code !== 200 || !data.data?.raw_url) {
        setAlistMsg('❌ 获取文件预览链接失败');
        setPreviewLoading(false);
        return false;
      }

      let previewUrl = `/api/alist-download?path=${encodeURIComponent(filePath)}&preview=1`;
      if (userToken) previewUrl += `&token=${encodeURIComponent(userToken)}`;
      const ccObj = getCustomConfig();
      if (ccObj) previewUrl += `&c=${btoa(JSON.stringify(ccObj))}`;

      // 接入微软 Office 在线预览服务
      if (type === 'office') {
        let absoluteUrl = previewUrl;
        if (absoluteUrl.startsWith('/')) {
          absoluteUrl = window.location.origin + absoluteUrl;
        }
        previewUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absoluteUrl)}`;
      }

      // 文本文件需要 fetch 内容
      if (type === 'text') {
        if ((size || 0) > 2 * 1024 * 1024) {
          setPreviewText('⚠️ 文件超过 2MB，无法在线预览。请下载后查看。');
        } else {
          try {
            const textRes = await fetch(previewUrl);
            const text = await textRes.text();
            setPreviewText(text);
          } catch (err: any) {
            setPreviewText(`⚠️ 无法加载文件内容，请尝试下载查看。${err.message}`);
          }
        }
      }

      setPreviewFile({ name, url: previewUrl, type, filePath, sign, size });
      setPreviewLoading(false);
      return true;
    } catch (err: any) {
      setPreviewText(`❌ 预览加载出错: ${err.message || '未知错误'}`);
      setPreviewLoading(false);
      return false;
    }
  };

  const logUserAction = async (action_type: string, action_item: string, status: 'success' | 'blocked' | 'failed' = 'success', customUsername?: string) => {
    try {
      const suffix = status === 'blocked' ? ' - 被拦截' : status === 'failed' ? ' - 失败' : '';
      await fetch('/api/log-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: customUsername || username || '游客',
          action_type: action_type + suffix,
          action_item
        })
      });
    } catch { }
  };

  const getAlistBase = () => {
    const cc = getCustomConfig();
    if (cc && cc.url) return cc.url.replace(/\/+$/, '');
    return ALIST_BASE_DEFAULT;
  };

  const fetchAlist = async (body: any, customHeaders: Record<string, string> = {}) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...customHeaders };
    if (userToken) headers['Authorization'] = `Bearer ${userToken}`;

    const cc = getCustomConfig();
    if (cc) {
      if (cc.url) headers['x-alist-url'] = cc.url;
      if (cc.user) headers['x-alist-username'] = cc.user;
      if (cc.pass) headers['x-alist-password'] = cc.pass;
    }

    return fetch('/api/alist', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem('BDPAN_THEME', next);
  };

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      // 主题初始化
      const saved = localStorage.getItem('BDPAN_THEME') as Theme | null;
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const initial: Theme = saved || (prefersDark ? 'dark' : 'light');
      setTheme(initial);
      document.documentElement.classList.toggle('dark', initial === 'dark');

      const savedToken = window.localStorage.getItem('BDPAN_TOKEN');
      const savedRole = window.localStorage.getItem('BDPAN_ROLE') as Role | null;
      const savedUser = window.localStorage.getItem('BDPAN_USERNAME');
      const savedPerms = window.localStorage.getItem('BDPAN_PERMS');
      const trackedUsername = savedUser || '访客';
      if (savedToken && savedRole) {
        setUserToken(savedToken);
        setUserRole(savedRole);
        setUsername(savedUser);
        if (savedPerms) {
          try { setUserPerms(JSON.parse(savedPerms)); } catch { }
        }
      }

      // 访客追踪
      fetch('https://ipapi.co/json/')
        .then(res => res.json())
        .then(data => {
          fetch('/api/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: trackedUsername,
              time: new Date().toISOString(),
              ip: data.ip,
              country: data.country_name || '',
              region: data.region || '',
              city: data.city || '',
              device: navigator.userAgent,
              source: 'pan'
            })
          }).catch(() => { });
        })
        .catch(() => {
          fetch('/api/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: trackedUsername, time: new Date().toISOString(), device: navigator.userAgent, source: 'pan' })
          }).catch(() => { });
        });
    }

    // 获取公共设置
    fetch('/api/global-settings', { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        if (data) {
          if (data.downloadModes) setGlobalDownloadModes(data.downloadModes);
          if (data.announcement) setGlobalAnnouncement(data.announcement);
          if (data.downloadChannel === 'ecs' || data.downloadChannel === 'frp') {
            setDownloadChannel(data.downloadChannel);
          }
          // 同步全局设置到本地状态，对所有用户生效
          setAdminSettings(prev => ({
            ...prev,
            enableGuestMode: data.enableGuestMode ?? prev.enableGuestMode,
            hideAlistButton: data.hideAlistButton ?? prev.hideAlistButton,
            downloadChannel: (data.downloadChannel as any) || prev.downloadChannel,
            downloadModes: data.downloadModes || prev.downloadModes,
            announcement: data.announcement || prev.announcement,
          }));
        }
      })
      .catch(() => { });


  }, []);

  // Token 存在时自动加载目录
  useEffect(() => {
    if (userToken) {
      alistListDir('/');
    }
  }, [userToken]);

  // 自动清除消息（30s）
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (alistMsg) {
      if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
      msgTimerRef.current = setTimeout(() => setAlistMsg(null), 30000);
      return () => { if (msgTimerRef.current) clearTimeout(msgTimerRef.current); };
    }
  }, [alistMsg]);

  // 节点智能优选 Ping 检测
  const pingNode = async (url: string, key: string) => {
    const start = Date.now();
    try {
      await fetch(url, { mode: 'no-cors', cache: 'no-store' });
      setNodeLatencies(prev => ({ ...prev, [key]: Date.now() - start }));
    } catch {
      setNodeLatencies(prev => ({ ...prev, [key]: -1 }));
    }
  };

  useEffect(() => {
    if (alistDownloadModal) {
      setNodeLatencies({});
      if (globalDownloadModes?.cf !== 'disabled' && globalDownloadModes?.cf !== 'hidden') {
        pingNode('https://cf.ryantan.fun/favicon.ico?t=' + Date.now(), 'cf');
      }
      if (globalDownloadModes?.ecs !== 'disabled' && globalDownloadModes?.ecs !== 'hidden') {
        const url = getAlistBase();
        if (url.startsWith('https://')) {
          pingNode(url + '/favicon.ico?t=' + Date.now(), 'ecs');
        } else {
          setNodeLatencies(prev => ({ ...prev, ecs: -2 }));
        }
      }
      if (globalDownloadModes?.raw !== 'disabled' && globalDownloadModes?.raw !== 'hidden') {
        // Ping baidu CDN directly to see speed of raw resolving
        pingNode('https://pan.baidu.com/favicon.ico?t=' + Date.now(), 'raw');
      }
    }
  }, [alistDownloadModal, globalDownloadModes]);

  // === 登录 ===
  const handleLogin = async () => {
    const uname = loginUsername.trim();
    const pwd = loginPassword.trim();
    if (!uname || !pwd) { setAuthError('请填写用户名及访问密钥'); return; }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uname, password: pwd }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) { logUserAction('登录', uname, 'failed', uname); setAuthError(data.error || '登录失败'); return; }
      setUserToken(data.token);
      setUserRole(data.role);
      setUsername(data.username);
      setUserPerms(data.permissions || null);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('BDPAN_TOKEN', data.token);
        window.localStorage.setItem('BDPAN_ROLE', data.role);
        window.localStorage.setItem('BDPAN_USERNAME', data.username);
        if (data.permissions) window.localStorage.setItem('BDPAN_PERMS', JSON.stringify(data.permissions));
      }
      setLoginUsername('');
      setLoginPassword('');
      logUserAction('登录', data.username, 'success', data.username);
    } catch { logUserAction('登录', uname, 'failed', uname); setAuthError('登录接口异常'); }
    finally { setAuthLoading(false); }
  };

  const handleGuestLogin = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) { logUserAction('登录 - 游客', '游客模式不可用', 'failed', 'guest'); setAuthError(data.error || '游客模式不可用'); return; }
      setUserToken(data.token);
      setUserRole(data.role);
      setUsername(data.username);
      setUserPerms(data.permissions || null);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('BDPAN_TOKEN', data.token);
        window.localStorage.setItem('BDPAN_ROLE', data.role);
        window.localStorage.setItem('BDPAN_USERNAME', data.username);
        if (data.permissions) window.localStorage.setItem('BDPAN_PERMS', JSON.stringify(data.permissions));
      }
      logUserAction('登录 - 游客', 'guest', 'success', 'guest');
    } catch { logUserAction('登录 - 游客', '接口异常', 'failed', 'guest'); setAuthError('登录接口异常'); }
    finally { setAuthLoading(false); }
  };

  const handleLogout = () => {
    setUserToken(null);
    setUserRole(null);
    setUsername(null);
    setUserPerms(null);
    setAlistFiles([]);
    setAlistPath('/');
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('BDPAN_TOKEN');
      window.localStorage.removeItem('BDPAN_ROLE');
      window.localStorage.removeItem('BDPAN_USERNAME');
      window.localStorage.removeItem('BDPAN_PERMS');
    }
  };

  // === AList 目录列表 ===
  const alistListDir = async (path: string) => {
    setAlistLoading(true);
    setAlistError(null);
    try {
      const res = await fetchAlist({ action: 'list', path });
      const data = await res.json();
      if (data.code === 200) {
        setAlistFiles(data.data?.content || []);
        setAlistPath(path);
        setAlistProvider(data.data?.provider || '');
        setCurrentPathPerms(data.data?.current_perms || null);
        setAlistSelected(new Set());
        setAlistSearchActive(false);
        setAlistSearchError(null);
        setAlistSearchResults([]);
        logUserAction('浏览目录', path);
      } else {
        setAlistError(data.message || '加载失败');
        if (data.code === 401 || data.code === 403) setAlistFiles([]);
      }
    } catch { setAlistError('网盘接口异常'); }
    finally { setAlistLoading(false); }
  };

  const alistSearchLegacy = async () => {
    const keyword = alistSearchKeyword.trim();
    if (!keyword) {
      setAlistSearchActive(false);
      setAlistSearchError('请输入搜索关键词');
      setAlistSearchResults([]);
      return;
    }

    setAlistSearchLoading(true);
    setAlistSearchActive(true);
    setAlistSearchError(null);
    try {
      const fallbackKeyword = keyword.includes('.') ? keyword.replace(/\.[^/.]+$/, '') : '';
      const keywordsToTry = Array.from(new Set([
        keyword,
        keyword.startsWith('.') ? keyword.slice(1) : '',
        fallbackKeyword,
      ].filter(Boolean)));
      const merged = new Map<string, AlistItem>();
      let lastError = '搜索失败';

      for (const currentKeyword of keywordsToTry) {
        const res = await fetchAlist({ action: 'search', parent: alistPath, keywords: currentKeyword, scope: alistSearchScope });
        const data = await res.json();
        if (data.code !== 200) {
          lastError = data.message || lastError;
          continue;
        }
        normalizeSearchResults(data).forEach((item) => {
          const key = item.path || `${item.parent || ''}/${item.name}`;
          merged.set(key, item);
        });
      }

      const matchedResults = filterSearchResults([...merged.values()], keyword);
      if (matchedResults.length > 0 || merged.size > 0) {
        setAlistSearchResults(matchedResults);
      } else if (merged.size === 0) {
        setAlistSearchResults([]);
        setAlistSearchError(lastError);
      } else {
        setAlistSearchResults([]);
      }
    } catch {
      setAlistSearchResults([]);
      setAlistSearchError('搜索接口异常');
    } finally {
      setAlistSearchLoading(false);
    }
  };

  const clearAlistSearch = () => {
    setAlistSearchKeyword('');
    setAlistSearchError(null);
    setAlistSearchResults([]);
    setAlistSearchActive(false);
  };

  const alistSearchBlocking = async () => {
    const keyword = alistSearchKeyword.trim();
    if (!keyword) {
      setAlistSearchActive(false);
      setAlistSearchError('请输入搜索关键词');
      setAlistSearchResults([]);
      return;
    }

    setAlistSearchLoading(true);
    setAlistSearchActive(true);
    setAlistSearchError(null);

    try {
      const queue = [alistPath];
      const visited = new Set<string>();
      const matchedFiles: AlistItem[] = [];

      while (queue.length > 0) {
        const currentPath = queue.shift();
        if (!currentPath || visited.has(currentPath)) continue;
        visited.add(currentPath);

        const res = await fetchAlist({ action: 'list', path: currentPath });
        const data = await res.json();
        if (data.code !== 200) throw new Error(data.message || '搜索失败');

        const provider = data.data?.provider || '';
        const content = Array.isArray(data.data?.content) ? data.data.content : [];
        content.forEach((item: AlistItem) => {
          const itemPath = getChildPath(currentPath, item.name);
          if (item.is_dir) {
            queue.push(itemPath);
            return;
          }
          if (!matchesSearchKeyword(item.name, keyword)) return;
          matchedFiles.push({
            ...item,
            path: itemPath,
            parent: currentPath,
            provider,
          });
        });
      }

      setAlistSearchResults(matchedFiles);
    } catch (error: any) {
      setAlistSearchResults([]);
      setAlistSearchError(error?.message || '搜索接口异常');
    } finally {
      setAlistSearchLoading(false);
    }
  };

  const alistSearchFast = async () => {
    const keyword = alistSearchKeyword.trim();
    if (!keyword) {
      setAlistSearchActive(false);
      setAlistSearchError('请输入搜索关键词');
      setAlistSearchResults([]);
      return;
    }

    const searchRunId = ++alistSearchRunRef.current;
    setAlistSearchLoading(true);
    setAlistSearchActive(true);
    setAlistSearchError(null);
    setAlistSearchResults([]);

    try {
      const fallbackKeyword = keyword.includes('.') ? keyword.replace(/\.[^/.]+$/, '') : '';
      const keywordsToTry = Array.from(new Set([
        keyword,
        keyword.startsWith('.') ? keyword.slice(1) : '',
        fallbackKeyword,
      ].filter(Boolean)));

      const merged = new Map<string, AlistItem>();
      let lastError = '搜索失败';

      for (const currentKeyword of keywordsToTry) {
        if (searchRunId !== alistSearchRunRef.current) return;

        const res = await fetchAlist({ action: 'search', parent: alistPath, keywords: currentKeyword, scope: 0 });
        const data = await res.json();

        if (data.code !== 200) {
          lastError = data.message || lastError;
          continue;
        }

        normalizeSearchResults(data).forEach((raw: any) => {
          const name = raw?.name || (typeof raw?.path === 'string' ? raw.path.split('/').filter(Boolean).pop() : '');
          if (!name) return;

          const fullPath = raw?.path || (raw?.parent ? getChildPath(raw.parent, name) : undefined);
          const parentPath = raw?.parent || (fullPath ? getParentPath(fullPath) : undefined);

          const item: AlistItem = {
            ...raw,
            name,
            path: fullPath,
            parent: parentPath,
            is_dir: Boolean(raw?.is_dir),
          };

          const key = item.path || `${item.parent || ''}/${item.name}`;
          merged.set(key, item);
        });
      }

      if (searchRunId !== alistSearchRunRef.current) return;

      const base = (alistPath || '/').replace(/\/+$/, '') || '/';
      const basePrefix = base === '/' ? '/' : `${base}/`;

      const results = [...merged.values()]
        .filter((item) => {
          if (!item.name) return false;
          if (!matchesSearchKeyword(item.name, keyword)) return false;
          if (!item.path) return false;
          return base === '/' ? item.path.startsWith('/') : item.path.startsWith(basePrefix);
        })
        .sort((a, b) => {
          const ad = Boolean(a.is_dir);
          const bd = Boolean(b.is_dir);
          if (ad !== bd) return ad ? -1 : 1;
          return a.name.localeCompare(b.name, 'zh-Hans-CN');
        });

      setAlistSearchResults(results);
      logUserAction('搜索文件', `${alistPath}: "${keyword}" (${results.length}条)`);
      if (results.length === 0 && merged.size === 0) setAlistSearchError(lastError);
    } catch (error: any) {
      if (searchRunId === alistSearchRunRef.current) {
        setAlistSearchResults([]);
        setAlistSearchError(error?.message || '搜索接口异常');
      }
    } finally {
      if (searchRunId === alistSearchRunRef.current) {
        setAlistSearchLoading(false);
      }
    }
  };

  const alistSearch = async () => {
    const keyword = alistSearchKeyword.trim();
    if (!keyword) {
      setAlistSearchActive(false);
      setAlistSearchError('请输入搜索关键词');
      setAlistSearchResults([]);
      return;
    }

    const searchRunId = ++alistSearchRunRef.current;
    setAlistSearchLoading(true);
    setAlistSearchActive(true);
    setAlistSearchError(null);
    setAlistSearchResults([]);

    try {
      const queue = [alistPath];
      const visited = new Set<string>();
      const matchedFiles: AlistItem[] = [];

      while (queue.length > 0) {
        const currentPath = queue.shift();
        if (!currentPath || visited.has(currentPath)) continue;
        visited.add(currentPath);

        if (searchRunId !== alistSearchRunRef.current) return;

        const res = await fetchAlist({ action: 'list', path: currentPath });
        const data = await res.json();
        if (data.code !== 200) throw new Error(data.message || '搜索失败');

        const provider = data.data?.provider || '';
        const content = Array.isArray(data.data?.content) ? data.data.content : [];
        let foundInCurrentDir = false;

        content.forEach((item: AlistItem) => {
          const itemPath = getChildPath(currentPath, item.name);
          if (item.is_dir) {
            queue.push(itemPath);
            return;
          }
          if (!matchesSearchKeyword(item.name, keyword)) return;
          foundInCurrentDir = true;
          matchedFiles.push({
            ...item,
            path: itemPath,
            parent: currentPath,
            provider,
          });
        });

        if (foundInCurrentDir && searchRunId === alistSearchRunRef.current) {
          setAlistSearchResults([...matchedFiles]);
        }
      }

      if (searchRunId === alistSearchRunRef.current) {
        setAlistSearchResults([...matchedFiles]);
      }
    } catch (error: any) {
      if (searchRunId === alistSearchRunRef.current) {
        setAlistSearchResults([]);
        setAlistSearchError(error?.message || '搜索接口异常');
      }
    } finally {
      if (searchRunId === alistSearchRunRef.current) {
        setAlistSearchLoading(false);
      }
    }
  };

  const openAlistItem = (item: AlistItem, currentPath: string, provider?: string) => {
    if (item.is_dir) {
      if (!canView) { setAlistMsg('❌ 无浏览子目录权限'); return; }
      const nextPath = item.path || getChildPath(currentPath, item.name);
      setAlistSelected(new Set());
      alistListDir(nextPath);
      return;
    }

    const filePath = item.path || getChildPath(currentPath, item.name);

    if (!canDownload) {
      logUserAction('下载', filePath, 'blocked');
      setAlistMsg('❌ 无下载权限'); return;
    }

    // 检查文件级权限（正则规则 / 路径规则）
    const filePerms = (item as any).perms as { download?: boolean; preview?: boolean } | undefined;
    const fileDownloadDenied = filePerms?.download === false;
    const filePreviewDenied = filePerms?.preview === false;

    console.log(`[openAlistItem] file=${filePath}, perms=`, filePerms, `downloadDenied=${fileDownloadDenied}, previewDenied=${filePreviewDenied}`);

    const { isBaidu, isAliyun } = getPathProviderHints(filePath, provider);
    const previewType = getPreviewType(item.name);

    if (previewType) {
      if (!userPerms?.preview) {
        logUserAction('预览', filePath, 'blocked');
        setAlistMsg('❌ 您没有在线预览的权限');
        return;
      }
      if (filePreviewDenied && fileDownloadDenied) {
        logUserAction('预览', filePath, 'blocked');
        setAlistMsg('❌ 该文件已被权限规则禁止访问');
        return;
      }
      console.log(`[openAlistItem] 打开预览: ${filePath}`);
      openPreview(item, filePath);
      return;
    }

    // 不可预览的文件：下载被禁就直接拒绝
    if (fileDownloadDenied) {
      logUserAction('下载', filePath, 'blocked');
      setAlistMsg('❌ 该文件已被权限规则禁止下载');
      return;
    }

    if (isBaidu) {
      setAlistDownloadModal({ name: item.name, filePath, sign: item.sign });
    } else if (isAliyun) {
      alistProxyDownload(filePath, item.name, '下载 - 阿里云盘直链下载');
    } else {
      alistDirectDownload(filePath, item.sign, '下载 - 普通直链下载');
    }
  };

  // === 下载逻辑 ===
  const alistDirectDownload = (filePath: string, fileSign?: string, actionType: string = '直连下载') => {
    alistProxyDownload(filePath, filePath.split('/').pop() || 'download', actionType);
  };

  const alistProxyDownload = (filePath: string, fileName: string, actionType: string = '代理下载') => {
    logUserAction(actionType, filePath);
    let downloadUrl = `/api/alist-download?path=${encodeURIComponent(filePath)}`;
    if (userToken) downloadUrl += `&token=${encodeURIComponent(userToken)}`;
    const ccConfigStr = localStorage.getItem('ALIST_CUSTOM_CONFIG');
    if (ccConfigStr) {
      downloadUrl += `&c=${btoa(ccConfigStr)}`;
    }
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const alistNavigate = (item: any) => {
    if (item.is_dir) {
      // 浏览权限：根目录始终允许，子目录需要 view 权限
      if (!canView) { setAlistMsg('❌ 无浏览子目录权限'); return; }
      const newPath = `${alistPath.replace(/\/+$/, '')}/${item.name}`;
      setAlistSelected(new Set());
      alistListDir(newPath);
      return;
    }

    // 检查文件级权限
    if (item.perms?.preview === false) {
      logUserAction('预览', `${alistPath.replace(/\/+$/, '')}/${item.name}`, 'blocked');
      setAlistMsg('❌ 该文件已被权限规则禁止预览');
      return;
    }

    const filePath = `${alistPath.replace(/\/+$/, '')}/${item.name}`;
    openPreview(item, filePath);
  };

  const alistBatchDownload = () => {
    console.log('[批量下载] 触发，选中项:', alistSelected);
    console.log('[批量下载] 权限检查:', { canDownload, userPerms });
    
    if (!canDownload) { 
      setAlistMsg('❌ 无下载权限'); 
      console.warn('[批量下载] 权限不足');
      return; 
    }
    if (alistSelected.size === 0) {
      console.warn('[批量下载] 未选中任何项');
      return;
    }

    const prov = alistProvider.toLowerCase();
    const isBaidu = prov.includes('baidu') || alistPath.toLowerCase().includes('baidu') || alistPath.includes('百度网盘');
    const isAliyun = prov.includes('aliyun') || alistPath.toLowerCase().includes('aliyun') || alistPath.includes('阿里云盘');

    console.log('[批量下载] 云盘类型:', { prov, isBaidu, isAliyun });

    const selectedItems = Array.from(alistSelected).map(name => {
      const file = alistFiles.find((f: any) => f.name === name);
      const filePath = `${alistPath.replace(/\/+$/, '')}/${name}`;
      return { name, file, filePath, isDir: file?.is_dir || false };
    });

    // 分离文件和文件夹
    const fileItems = selectedItems.filter(item => !item.isDir);
    const folderItems = selectedItems.filter(item => item.isDir);

    // 文件夹也走统一流程：展示选择弹窗
    if (folderItems.length > 0 || fileItems.length > 0) {
      setBatchModeModal({ folders: folderItems, files: fileItems });
    }

    setAlistSelected(new Set());
  };

  // T2: 逐个直链自动下载
  const alistBatchDownloadT2 = async (folders: Array<{ name: string; filePath: string }>, files: Array<{ name: string; file: any; filePath: string }>) => {
    setBatchModeModal(null);
    const allPaths = [...folders.map(f => f.filePath), ...files.map(f => f.filePath)];
    logUserAction('批量下载 - 逐个直链', `${alistPath} - ${allPaths.join(', ')}`);

    const params = new URLSearchParams();
    params.set('paths', JSON.stringify(allPaths));
    if (userToken) params.set('token', userToken);
    const headers: Record<string, string> = {};
    if (userToken) headers['Authorization'] = `Bearer ${userToken}`;

    setT2Progress({ current: 0, total: 0, msg: '⏳ 正在获取文件列表...' });

    try {
      const res = await fetch(`/api/alist-batch-list?${params.toString()}`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const fileList: Array<{ path: string; sign: string; relativePath: string }> = data.files || [];
      const skipped = data.skipped || 0;

      if (fileList.length === 0) {
        setT2Progress(null);
        setAlistMsg(skipped > 0 ? `⚠️ 所有文件均被权限策略禁止访问` : '❌ 没有可下载的文件');
        return;
      }

      const alistBase = getAlistBase();
      setT2Progress({ current: 0, total: fileList.length, msg: `⏳ 正在下载 0/${fileList.length}...` });

      const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

      const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
      const interval = isMobile ? 2000 : 600;
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        const url = f.sign ? `${alistBase}/p${f.path}?sign=${f.sign}` : `${alistBase}/p${f.path}`;
        const a = document.createElement('a');
        a.href = url;
        a.download = f.relativePath.split('/').pop() || '';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setT2Progress({ current: i + 1, total: fileList.length, msg: `⏳ 正在下载 ${i + 1}/${fileList.length}...` });
        await delay(interval);
      }

      setT2Progress(null);
      if (skipped > 0) {
        setAlistMsg(`⚠️ 已触发 ${fileList.length} 个文件下载，${skipped} 个因权限策略跳过`);
      } else {
        setAlistMsg(`✅ 已触发 ${fileList.length} 个文件下载`);
      }
      setTimeout(() => setAlistMsg(null), 4000);
    } catch (err: any) {
      setT2Progress(null);
      setAlistMsg(`❌ ${err.message}`);
    }
  };

  // 批量下载文件夹 - alist /p/ 直链 + ZIP 打包
  const alistBatchDownloadFolders = (folders: Array<{ name: string; filePath: string }>) => {
    const paths = folders.map(f => f.filePath);
    console.log('[批量下载] 打包路径:', paths);
    logUserAction('批量下载文件夹', `${alistPath} - ${paths.join(', ')}`);

    const zipFileName = folders.length === 1 ? folders[0].name : `多个文件夹_${new Date().getTime()}`;
    const params = new URLSearchParams();
    params.set('paths', JSON.stringify(paths));
    if (userToken) params.set('token', userToken);

    setIsCompressing(true);
    setAlistMsg('⏳ 正在打包（优先 /p/ 直链，降级百度CDN）...');
    console.log(`[批量下载:T1] 首选 /p/ 直链 + ZIP, ${paths.length} 个路径`);

    const headers: Record<string, string> = {};
    if (userToken) headers['Authorization'] = `Bearer ${userToken}`;

    // 先预览（获取目录信息）
    fetch(`/api/alist-zip-preview?${params.toString()}`, { headers })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `权限不足 (${res.status})`);
        return data;
      })
      .then(data => {
        if (data.dirs && data.dirs.length > 0) {
          const totalFiles = data.dirs.reduce((sum: number, d: any) => sum + d.fileCount, 0);
          setAlistMsg(`[ZIP] ${data.dirs.length} 个目录，共 ${totalFiles} 个文件`);
          console.log(`[批量下载:T1] 目录数=${data.dirs.length}, 文件数=${totalFiles}`);
        }
        fetch(`/api/alist-zip-download?${params.toString()}`, headers)
          .then(async r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const skipped = parseInt(r.headers.get('X-Skipped-Files') || '0', 10);
            const blob = await r.blob();
            return { blob, skipped };
          })
          .then(({ blob, skipped }) => {
            const u = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = u; a.download = `${zipFileName}.zip`;
            document.body.appendChild(a); a.click();
            setTimeout(() => { window.URL.revokeObjectURL(u); document.body.removeChild(a); }, 100);
            setIsCompressing(false);
            if (skipped > 0) {
              setAlistMsg(`⚠️ 下载完成，${skipped} 个文件因权限策略未包含`);
            } else {
              setAlistMsg('✅ ZIP 下载完成');
            }
            console.log(`[批量下载:T1] ✅ ZIP 下载完成, 跳过:${skipped}`);
            setTimeout(() => setAlistMsg(null), 4000);
          })
          .catch(err => {
            setIsCompressing(false);
            setAlistMsg(`❌ ZIP 打包失败: ${err.message}`);
            console.warn(`[批量下载:T2] ⚠️ ZIP 失败，降级到直链清单`, err);
          });
      })
      .catch(err => {
        setIsCompressing(false);
        setAlistMsg(`❌ ${err.message}`);
        console.warn(`[批量下载] ❌ 失败:`, err.message);
      });
  };

  const alistToggleSelect = (name: string) => {
    setAlistSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        console.log('[复选框] 取消选中:', name);
      } else {
        next.add(name);
        console.log('[复选框] 选中:', name);
      }
      console.log('[复选框] 当前选中项总数:', next.size);
      return next;
    });
  };

  const alistSelectAll = () => {
    const allNames = alistFiles.map((f: any) => f.name);
    if (alistSelected.size === allNames.length) setAlistSelected(new Set());
    else setAlistSelected(new Set(allNames));
  };

  // === 文件管理操作 ===
  const alistMkdir = async () => {
    if (!alistMkdirName.trim()) return;
    setAlistMsg(null);
    try {
      const res = await fetchAlist({ action: 'mkdir', path: alistPath, dir_name: alistMkdirName.trim() });
      const data = await res.json();
      if (data.code === 200) { setAlistMsg('✅ 文件夹创建成功'); setAlistMkdirName(''); setAlistShowMkdir(false); alistListDir(alistPath); logUserAction('新建文件夹', `${alistPath}/${alistMkdirName.trim()}`); }
      else { logUserAction('新建文件夹', `${alistPath}/${alistMkdirName.trim()}`, 'failed'); setAlistMsg(`❌ ${data.message}`); }
    } catch { logUserAction('新建文件夹', `${alistPath}/${alistMkdirName.trim()}`, 'failed'); setAlistMsg('❌ 接口异常'); }
  };

  const alistRemove = async (file: any) => {
    if (file.is_dir) {
      setAlistDeleteConfirm({ name: file.name, isDir: true });
      setAlistDeleteInput('');
      return;
    }
    if (!confirm(`确认删除文件 ${file.name} 吗？`)) return;
    executeRemove(file.name);
  };

  const executeRemove = async (name: string) => {
    setAlistMsg(null);
    try {
      const res = await fetchAlist({ action: 'remove', path: alistPath, names: [name] });
      const data = await res.json();
      const delPath = `${alistPath.replace(/\/+$/, '')}/${name}`;
      if (data.code === 200) { setAlistMsg('✅ 删除成功'); logUserAction('删除', delPath); alistListDir(alistPath); }
      else { logUserAction('删除', delPath, 'failed'); setAlistMsg(`❌ ${data.message}`); }
    } catch { logUserAction('删除', `${alistPath.replace(/\/+$/, '')}/${name}`, 'failed'); setAlistMsg('❌ 接口异常'); }
    setAlistDeleteConfirm(null);
  };

  const alistRename = async (filePath: string) => {
    if (!alistNewName.trim()) return;
    setAlistMsg(null);
    try {
      const res = await fetchAlist({ action: 'rename', path: filePath, newName: alistNewName.trim() });
      const data = await res.json();
      const renameInfo = `${filePath} -> ${alistNewName.trim()}`;
      if (data.code === 200) { setAlistMsg('✅ 重命名成功'); logUserAction('重命名', renameInfo); setAlistRenaming(null); setAlistNewName(''); alistListDir(alistPath); }
      else { logUserAction('重命名', renameInfo, 'failed'); setAlistMsg(`❌ ${data.message}`); }
    } catch { setAlistMsg('❌ 接口异常'); }
  };

  const alistUpload = async () => {
    if (alistUploadFiles.length === 0 || !userToken) return;
    setAlistUploading(true);
    setAlistMsg(null);
    setUploadProgress(0);
    setUploadProgressMsg('准备上传...');

    let successCount = 0;
    let failCount = 0;
    let lastError = '';

    // 提前缓存，避免每个文件都去请求 token
    let cachedTokenData: any = null;
    const isPageHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    try {
      const tokenRes = await fetch('/api/alist-token', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` },
      });
      cachedTokenData = await tokenRes.json();
    } catch (e) {
      console.warn('获取直连 token 失败:', e);
    }
    
    // 提前读取自定义配置避免重复读 storage
    const cc = getCustomConfig();

    for (let i = 0; i < alistUploadFiles.length; i++) {
      const file = alistUploadFiles[i];
      setUploadProgressMsg(`正在上传 (${i + 1}/${alistUploadFiles.length}): ${file.name}`);
      setUploadProgress(Math.round((i / alistUploadFiles.length) * 100));

      try {
        const relativePath = (file as any).customPath || file.webkitRelativePath || file.name;
        const uploadPath = alistPath.replace(/\/+$/, '') + '/' + relativePath;
        const realUploadPath = applyBasePathToVisiblePath(uploadPath, userPerms?.basePath);
        const encodedFilePath = realUploadPath.split('/').map(encodeURIComponent).join('/');

        // 1. 尝试直连 ECS 上传（绕过 Vercel，极速）
        let directSuccess = false;
        try {
          const isAlistHttps = cachedTokenData && cachedTokenData.url && cachedTokenData.url.startsWith('https');

          if (cachedTokenData && cachedTokenData.token && cachedTokenData.url && (!isPageHttps || isAlistHttps)) {
            const uploadData: any = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('PUT', `${cachedTokenData.url}/api/fs/put`);
              xhr.setRequestHeader('Authorization', cachedTokenData.token);
              xhr.setRequestHeader('File-Path', encodedFilePath);
              xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
              xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                   const fileProgress = (e.loaded / e.total);
                   const totalProgress = Math.round(((i + fileProgress) / alistUploadFiles.length) * 100);
                   setUploadProgress(totalProgress);
                }
              };
              xhr.onload = () => {
                try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('响应解析失败')); }
              };
              xhr.onerror = () => reject(new Error('CORS_OR_NETWORK'));
              xhr.send(file);
            });
            if (uploadData.code === 200) {
              directSuccess = true;
              successCount++;
            } else {
              throw new Error(uploadData.message);
            }
          }
        } catch (directErr: any) {
          if (directErr.message !== 'CORS_OR_NETWORK') {
             if (!directSuccess) throw directErr;
          }
        }

        // 2. Fallback: 通过 Vercel Dashboard 代理上传
        if (!directSuccess) {
          const headers: Record<string, string> = {
            'Authorization': `Bearer ${userToken}`,
            'File-Path': encodedFilePath,
            'Content-Type': file.type || 'application/octet-stream',
            'Content-Length': String(file.size),
          };
          const cc = getCustomConfig();
          if (cc) {
            if (cc.url) headers['x-alist-url'] = cc.url;
            if (cc.user) headers['x-alist-username'] = cc.user;
            if (cc.pass) headers['x-alist-password'] = cc.pass;
          }
          const uploadData: any = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', '/api/alist-upload');
            Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                 const fileProgress = (e.loaded / e.total);
                 const totalProgress = Math.round(((i + fileProgress) / alistUploadFiles.length) * 100);
                 setUploadProgress(totalProgress);
              }
            };
            xhr.onload = () => {
              try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('响应解析失败')); }
            };
            xhr.onerror = () => reject(new Error('网络异常'));
            xhr.send(file);
          });
          if (uploadData.code === 200) {
             successCount++;
          } else {
             throw new Error(uploadData.message);
          }
        }
      } catch (e: any) {
         failCount++;
         lastError = e.message;
      }
    }

    if (failCount === 0) {
       setAlistMsg(`✅ 成功上传 ${successCount} 个文件/文件夹`);
       setAlistUploadFiles([]);
    } else if (successCount > 0) {
       setAlistMsg(`⚠️ 上传完成，${successCount} 成功，${failCount} 失败 (最后错误: ${lastError})`);
       setAlistUploadFiles([]);
    } else {
       setAlistMsg(`❌ 上传失败: ${lastError}`);
    }

    logUserAction('批量上传', `${alistPath} (${successCount} 个文件)`);
    setAlistUploading(false);
    setUploadProgress(null);
    setUploadProgressMsg('');
    alistListDir(alistPath);
  };

  // === 管理面板操作 ===
  const fetchAdminData = async () => {
    if (!userToken) return;
    try {
      // 非 admin 只拉统计数据（操作日志等）
      if (userRole !== 'admin') {
        const statsRes = await fetch('/api/admin-stats', { headers: { 'Authorization': `Bearer ${userToken}` } });
        const sData = await statsRes.json();
        if (sData.code === 200 && sData.data) setAdminStats(sData.data);
        return;
      }
      // admin 拉全部
      const [usrRes, statsRes] = await Promise.all([
        fetch('/api/users', { headers: { 'Authorization': `Bearer ${userToken}` } }),
        fetch('/api/admin-stats', { headers: { 'Authorization': `Bearer ${userToken}` } })
      ]);
      const data = await usrRes.json();
      const sData = await statsRes.json();

      if (data.users) setAdminUsers(data.users);
      if (data.settings) {
        setAdminSettings(data.settings);
        if (data.settings.downloadModes) {
          setGlobalDownloadModes(data.settings.downloadModes);
        }
        if (data.settings.downloadChannel === 'ecs' || data.settings.downloadChannel === 'frp') {
          setDownloadChannel(data.settings.downloadChannel);
        }
      }
      if (sData.code === 200 && sData.data) {
        setAdminStats(sData.data);
      }
    } catch { }
  };

  const adminAction = async (action: string, body: any) => {
    if (!userToken) return;
    setAdminMsg(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await res.json();
      if (!res.ok) { setAdminMsg(`❌ ${data.error}`); return; }
      if (data.users) setAdminUsers(data.users);
      if (data.settings) {
        setAdminSettings(data.settings);
        if (data.settings.downloadModes) {
          setGlobalDownloadModes(data.settings.downloadModes);
        }
      }
      setAdminMsg('✅ 操作成功');
    } catch { setAdminMsg('❌ 接口异常'); }
  };

  // 自动清除管理消息
  useEffect(() => {
    if (adminMsg) {
      const t = setTimeout(() => setAdminMsg(null), 3000);
      return () => clearTimeout(t);
    }
  }, [adminMsg]);

  const normalizeRulePath = (value: string) => {
    const trimmed = value.trim() || '/';
    if (trimmed === '/') return '/';
    return (trimmed.startsWith('/') ? trimmed : `/${trimmed}`).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  };

  const createDefaultFileRule = (path: string = '/', pathType: 'file' | 'dir' | 'regex' = 'file'): FilePermissionRule => ({
    id: '',
    path: pathType === 'regex' ? '' : normalizeRulePath(path),
    pathType,
    regexScope: 'path',
    groupName: '',
    users: ['guest'],
    deny: pathType === 'file'
      ? { view: true, download: true, preview: true }
      : { view: true, download: true, preview: true, upload: true },
  });

  const fetchFilePermissionsData = async () => {
    if (!userToken || !canControlFile) return;
    try {
      const res = await fetch('/api/file-permissions', {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setFilePermMsg(data.error || '加载文件权限规则失败');
        return;
      }
      setFilePermUsers(data.users || []);
      setFilePermRules(data.rules || []);
    } catch {
      setFilePermMsg('加载文件权限规则失败');
    }
  };

  const saveFilePermissionRules = async (rules: FilePermissionRule[]) => {
    if (!userToken) return false;
    setFilePermMsg(null);
    try {
      const res = await fetch('/api/file-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ rules }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFilePermMsg(data.error || '保存文件权限规则失败');
        return false;
      }
      setFilePermRules(data.rules || rules);
      setAdminSettings(prev => ({ ...prev, filePermissionRules: data.rules || rules }));
      setFilePermMsg('文件权限规则已保存');
      return true;
    } catch {
      setFilePermMsg('保存文件权限规则失败');
      return false;
    }
  };

  const openFilePermissionPanel = async (path?: string, pathType: 'file' | 'dir' = 'file', lockType: boolean = true) => {
    setShowFilePermPanel(true);
    setFilePermTypeLocked(lockType);
    setFilePermDraft(createDefaultFileRule(path || alistPath, pathType));
    await fetchFilePermissionsData();
  };

  const submitFilePermissionDraft = async () => {
    const isRegex = filePermDraft.pathType === 'regex';
    const rulePath = isRegex ? filePermDraft.path.trim() : normalizeRulePath(filePermDraft.path);
    const users = filePermDraft.users.filter(Boolean);

    if (!rulePath || users.length === 0) {
      setFilePermMsg(isRegex ? '请输入匹配表达式并至少选择一个用户' : '请选择路径和至少一个用户');
      return;
    }

    // 如果是 regex 类型，验证正则合法性
    if (isRegex) {
      try { new RegExp(rulePath); } catch {
        setFilePermMsg('正则表达式语法错误，请检查');
        return;
      }
    }

    const nextRule: FilePermissionRule = {
      ...filePermDraft,
      deny: filePermDraft.pathType === 'file'
        ? Object.fromEntries(Object.entries(filePermDraft.deny).filter(([key, value]) => key !== 'upload' && value)) as Partial<Record<FilePermissionAction, boolean>>
        : filePermDraft.deny,
      id: filePermDraft.id || `rule_${Date.now()}`,
      path: rulePath,
      regexScope: isRegex ? (filePermDraft.regexScope || 'path') : undefined,
      groupName: filePermDraft.groupName?.trim() || '',
      users,
      updatedAt: Date.now(),
      createdAt: filePermDraft.createdAt || Date.now(),
    };

    const nextRules = filePermRules.some(rule => rule.id === nextRule.id)
      ? filePermRules.map(rule => rule.id === nextRule.id ? nextRule : rule)
      : [nextRule, ...filePermRules];

    const ok = await saveFilePermissionRules(nextRules);
    if (ok) {
      const ruleDesc = `[${nextRule.pathType}] ${nextRule.path} (用户:${nextRule.users.join(',')}, 禁:${Object.keys(nextRule.deny).filter(k => nextRule.deny[k as FilePermissionAction]).join(',')})`;
      logUserAction('文件权限 - 保存规则', ruleDesc);
      setFilePermDraft(createDefaultFileRule(alistPath, 'dir'));
      setRegexPreview(null);
    }
  };

  // === 工具函数 ===
  const formatSize = (size: number) => {
    if (size >= 1073741824) return `${(size / 1073741824).toFixed(1)}GB`;
    if (size >= 1048576) return `${(size / 1048576).toFixed(1)}MB`;
    if (size >= 1024) return `${Math.round(size / 1024)}KB`;
    return `${size}B`;
  };

  const getFileIcon = (file: any) => {
    if (file.is_dir) return '📁';
    if (/\.(jpg|jpeg|png|gif|webp|svg|ico)$/i.test(file.name)) return '🖼️';
    if (/\.(mp4|mkv|avi|mov|webm)$/i.test(file.name)) return '🎬';
    if (/\.(mp3|flac|wav|ogg|aac)$/i.test(file.name)) return '🎵';
    if (/\.(zip|rar|7z|tar|gz)$/i.test(file.name)) return '📦';
    if (/\.(pdf)$/i.test(file.name)) return '📕';
    if (/\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(file.name)) return '📝';
    return '📄';
  };

  const roleLabel = (role: Role) => {
    switch (role) {
      case 'admin': return '超级管理员';
      case 'manager': return '管理员';
      case 'guest': return '游客';
    }
  };

  const roleBadgeColor = (role: Role) => {
    switch (role) {
      case 'admin': return 'bg-pink-500/20 text-pink-400 border-pink-500/40';
      case 'manager': return 'bg-blue-500/20 text-blue-400 border-blue-500/40';
      case 'guest': return 'bg-zinc-700/30 text-zinc-400 border-zinc-600/40';
    }
  };

  if (!mounted) return <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }} />;

  // === 登录页 ===
  if (!userToken) {
    return (
      <div className="min-h-screen bg-gradient-animated flex items-center justify-center p-4" style={{ color: 'var(--text-secondary)' }}>
        <div className="w-full max-w-sm glass-strong rounded-2xl p-6 animate-in">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">☁️</div>
            <h1 className="text-xl font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>成都七中STA · 科协网盘</h1>
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>成都七中科学技术协会 · 百度网盘文件共享平台</p>
          </div>
          <div className="space-y-3">
            <input
              type="text"
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') document.getElementById('pwd-input')?.focus(); }}
              placeholder="用户名"
              autoComplete="username"
              className="w-full rounded-lg px-3 py-2.5 text-xs outline-none transition-all" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
            />
            <input
              id="pwd-input"
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
              placeholder="密码"
              autoComplete="current-password"
              className="w-full rounded-lg px-3 py-2.5 text-xs outline-none transition-all" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
            />
            <button
              onClick={handleLogin}
              disabled={authLoading}
              className={`w-full text-xs font-bold py-2.5 rounded-lg transition-all text-white ${authLoading
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:shadow-lg hover:opacity-90'}`}
              style={{ background: 'var(--accent)' }}
            >
              {authLoading ? '验证中...' : '登 录'}
            </button>
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full" style={{ borderTop: '1px solid var(--border-color)' }}></div></div>
              <div className="relative flex justify-center text-[10px]"><span className="px-2" style={{ background: 'var(--bg-primary)', color: 'var(--text-faint)' }}>OR</span></div>
            </div>
            <button
              onClick={handleGuestLogin}
              disabled={authLoading}
              className="w-full text-xs font-bold py-2.5 rounded-lg transition-all" style={{ border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
            >
              👤 游客模式
            </button>
            {authError && <div className="text-[11px] text-red-400 text-center">{authError}</div>}
          </div>
          <div className="flex items-center justify-between mt-5">
            <p className="text-[9px]" style={{ color: 'var(--text-faint)' }}>© 成都七中科学技术协会</p>
            <button onClick={toggleTheme} className="text-sm opacity-60 hover:opacity-100 transition-opacity" title="切换主题">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // === 主应用 ===
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>

      {/* 顶部状态栏 */}
      <header className="h-12 glass-strong flex items-center justify-between px-4 md:px-6 text-[10px] font-bold tracking-widest shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
        <div className="flex items-center gap-3">
          <span className="text-base">☁️</span>
          <span style={{ color: 'var(--accent)' }} className="uppercase">STA-PAN</span>
          <span className="opacity-30">|</span>
          <span className="text-emerald-500 hidden sm:inline">ONLINE</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${roleBadgeColor(userRole!)}`}>
              {roleLabel(userRole!)}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>{username}</span>
          </div>
          <span className="opacity-30">|</span>
          <button onClick={toggleTheme} className="text-sm opacity-60 hover:opacity-100 transition-opacity" title="切换主题">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          {isAdmin && (
            <button
              onClick={() => { setShowAdminPanel(true); fetchAdminData(); }}
              className="text-[10px] hover:opacity-80 transition-opacity tracking-widest flex items-center gap-1"
              style={{ color: 'var(--accent)' }}
            >
              👑 管理
            </button>
          )}
          {!isAdmin && (userPerms?.viewStats || userPerms?.viewActionLogs || userPerms?.viewIpStats || userPerms?.viewDownloadLogs) && (
            <button
              onClick={() => { setShowAdminPanel(true); fetchAdminData(); }}
              className="text-[10px] hover:opacity-80 transition-opacity tracking-widest flex items-center gap-1"
              style={{ color: 'var(--text-muted)' }}
            >
              📊 日志
            </button>
          )}
          {canControlFile && (
            <button
              onClick={() => openFilePermissionPanel(alistPath, 'dir', false)}
              className="text-[10px] hover:opacity-80 transition-opacity tracking-widest flex items-center gap-1"
              style={{ color: 'var(--accent-2)' }}
            >
              🔒 文件权限
            </button>
          )}
          {(isAdmin || userPerms?.setting) && (
            <button
              onClick={() => {
                const cc = getCustomConfig();
                if (cc) { setCustomUrl(cc.url || ''); setCustomUser(cc.user || ''); setCustomPass(cc.pass || ''); }
                setShowSettings(true);
              }}
              className="text-[10px] hover:opacity-80 transition-opacity tracking-widest flex items-center gap-1"
              style={{ color: 'var(--text-muted)' }}
            >
              ⚙️ 设置
            </button>
          )}
          <button
            onClick={() => setShowManual(true)}
            className="text-[10px] hover:opacity-80 transition-opacity tracking-widest flex items-center gap-1"
            style={{ color: 'var(--accent)' }}
          >
            📖 说明
          </button>
          <span className="opacity-30">|</span>
          <button onClick={handleLogout} className="text-[10px] hover:opacity-80 transition-opacity tracking-widest" style={{ color: 'var(--text-muted)' }}>
            退出
          </button>
        </div>
      </header>

      {/* 管理面板弹窗 */}
      {showAdminPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowAdminPanel(false)}>
          <div className="w-full max-w-lg glass-strong rounded-2xl p-5 mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">{isAdmin ? '👑' : '📊'}</span>
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{isAdmin ? '管理面板' : '日志面板'}</h3>
              </div>
              <button onClick={() => setShowAdminPanel(false)} className="text-lg hover:opacity-100 opacity-60 transition-opacity">✕</button>
            </div>

            {adminMsg && (
              <div className={`mb-3 px-3 py-1.5 rounded text-[11px] font-bold ${adminMsg.startsWith('✅') ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                {adminMsg}
              </div>
            )}

            {/* 数据大盘 */}
            {adminStats && (isAdmin || userPerms?.viewStats) && (
              <div className="mb-5 rounded-xl p-4 flex flex-col gap-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                <div className="text-[10px] uppercase font-bold tracking-widest" style={{ color: 'var(--text-muted)' }}>实时数据审计 (全量历史)</div>
                <div className="flex items-center justify-between mx-2 mb-2">
                  <div
                    className="flex flex-col items-center cursor-pointer hover:bg-zinc-800/30 px-4 py-2 rounded-xl transition-colors tooltip-trigger"
                    title="点击查看详情"
                    onClick={() => setAllDownloadStatsModal({ title: '过去24小时下载记录', logs: adminStats.allDownloadLogs?.filter((l: any) => new Date(l.time).getTime() >= Date.now() - 24 * 3600 * 1000) || [] })}
                  >
                    <span className="text-[24px] font-black text-pink-500">{adminStats.past24hDownloads || 0}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>过去24小时</span>
                  </div>
                  <div
                    className="flex flex-col items-center cursor-pointer hover:bg-zinc-800/30 px-4 py-2 rounded-xl transition-colors tooltip-trigger"
                    title="点击查看详情"
                    onClick={() => setAllDownloadStatsModal({ title: '全部历史下载记录', logs: adminStats.allDownloadLogs || [] })}
                  >
                    <span className="text-[24px] font-black text-blue-500">{adminStats.totalDownloads || 0}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>总历史下载数</span>
                  </div>
                  <div
                    className="flex flex-col items-center px-4 py-2 rounded-xl"
                  >
                    <span className="text-[24px] font-black text-cyan-500">{adminStats.totalPanVisits || 0}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>总访问次数</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 text-[10px]">
                  {[
                    { key: 'ecs', name: '阿里云 ECS', color: 'pink' },
                    { key: 'cf', name: 'Cloudflare', color: 'blue' },
                    { key: 'raw', name: '真实直链', color: 'emerald' },
                    { key: 'vercel', name: 'Vercel 中转', color: 'orange' },
                    { key: 'direct302', name: '302 跳转', color: 'zinc' },
                  ].map(ch => (
                    <div
                      key={ch.key}
                      onClick={() => setSelectedChannelDetailedStats(ch.key)}
                      className="flex justify-between px-2 py-1.5 rounded bg-black/20 border border-zinc-800/50 cursor-pointer hover:bg-zinc-800/50 transition-colors tooltip-trigger"
                      title="点击查看详细下载日志"
                    >
                      <span className={`text-${ch.color}-400`}>{ch.name}</span>
                      <span className="font-bold text-zinc-300 text-right">
                        <span className="text-zinc-500 font-normal pr-1" title="过去24小时">{(adminStats.channelStats?.[ch.key]?.past24h) || 0} /</span>
                        <span title="历史总计">{(adminStats.channelStats?.[ch.key]?.total) || 0}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 访问统计与封禁 */}
            {adminStats && (isAdmin || userPerms?.viewIpStats) && ((adminStats.topIps && adminStats.topIps.length > 0) || (adminStats.viewLogs && adminStats.viewLogs.length > 0)) && (
              <div className="mb-5 rounded-xl p-4 flex flex-col gap-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase font-bold tracking-widest" style={{ color: isAdmin ? '#ef4444' : 'var(--text-muted)' }}>IP 访问统计{isAdmin && '与封禁'}</div>
                  <div className="flex gap-2">
                    <select
                      value={ipSort}
                      onChange={(e) => setIpSort(e.target.value as any)}
                      className="rounded px-1.5 py-0.5 text-[10px] outline-none transition-all"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    >
                      <option value="count">按请求数</option>
                      <option value="time">按最新活跃</option>
                      <option value="flow">流水显示</option>
                    </select>
                    <select
                      value={ipLimit}
                      onChange={(e) => setIpLimit(Number(e.target.value))}
                      className="rounded px-1.5 py-0.5 text-[10px] outline-none transition-all"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    >
                      <option value={5}>显示 5 条</option>
                      <option value={10}>显示 10 条</option>
                      <option value={50}>显示 50 条</option>
                      <option value={99999}>显示全部</option>
                    </select>
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                  <table className="w-full text-left text-[11px]">
                    <thead className="sticky top-0 backdrop-blur" style={{ background: 'var(--bg-input)' }}>
                      <tr>
                        {ipSort === 'flow' ? (
                          <>
                            <th className="py-2 text-zinc-400 font-normal w-[120px]">访问源</th>
                            <th className="py-2 text-zinc-400 font-normal w-[120px]">时间</th>
                            <th className="py-2 text-zinc-400 font-normal w-[90px]">账号</th>
                            <th className="py-2 text-zinc-400 font-normal w-[40px]">操作</th>
                          </>
                        ) : (
                          <>
                            <th className="py-2 text-zinc-400 font-normal w-[120px]">访问源 (IP/定位)</th>
                            <th className="py-2 text-zinc-400 font-normal text-center">流水 / 最新活跃时间</th>
                            <th className="py-2 text-zinc-400 font-normal w-[60px] truncate">账号</th>
                            <th className="py-2 text-zinc-400 font-normal w-[40px] text-right">操作</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {ipSort === 'flow' ? (
                        (adminStats.viewLogs || []).slice(0, ipLimit).map((log: any, idx: number) => {
                          const location = [log.country, log.region, log.city].filter(Boolean).join(' ') || '未知';
                          const isBanned = adminSettings?.bannedIps?.[log.ip_address] && adminSettings.bannedIps[log.ip_address] > Date.now();
                          const banExpiry = isBanned ? new Date(adminSettings.bannedIps![log.ip_address]).toLocaleString() : '';
                          return (
                            <tr key={idx} className="border-t border-zinc-800/30">
                              <td className="py-1.5 w-[120px] truncate" title={`${log.ip_address} - ${location}`}>
                                <div className="font-mono text-zinc-300">{log.ip_address}</div>
                                <div className="text-[9px] text-zinc-500">{location}</div>
                              </td>
                              <td className="py-1.5 w-[120px] truncate text-zinc-400" title={new Date(log.visit_time).toLocaleString()}>
                                {new Date(log.visit_time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="py-1.5 w-[90px] truncate text-zinc-400" title={log.username}>{log.username || '访客'}</td>
                              {isAdmin && (
                              <td className="py-1.5 text-right w-[40px]">
                                {isBanned ? (
                                  <button
                                    onClick={() => {
                                      const newBans = { ...adminSettings.bannedIps };
                                      delete newBans[log.ip_address];
                                      adminAction('updateSettings', { settings: { bannedIps: newBans } });
                                    }}
                                    className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20" title={`过期时间: ${banExpiry}`}>解封</button>
                                ) : (
                                  <button
                                    onClick={() => {
                                      const hoursStr = window.prompt(`需要封禁 IP ${log.ip_address} 多少小时？\n输入 0 或取消可终止操作。`, '24');
                                      if (!hoursStr) return;
                                      const hours = parseInt(hoursStr, 10);
                                      if (isNaN(hours) || hours <= 0) return;
                                      const newBans = { ...(adminSettings.bannedIps || {}), [log.ip_address]: Date.now() + hours * 3600 * 1000 };
                                      adminAction('updateSettings', { settings: { bannedIps: newBans } });
                                    }}
                                    className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-colors border border-red-500/20">封禁</button>
                                )}
                              </td>
                              )}
                            </tr>
                          );
                        })
                      ) : (
                        [...adminStats.topIps].sort((a: any, b: any) => ipSort === 'count' ? b.count - a.count : new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime()).slice(0, ipLimit).map((ipHit: any) => {
                          const isBanned = adminSettings?.bannedIps?.[ipHit.ip] && adminSettings.bannedIps[ipHit.ip] > Date.now();
                          const banExpiry = isBanned ? new Date(adminSettings.bannedIps![ipHit.ip]).toLocaleString() : '';
                          return (
                            <tr key={ipHit.ip} className="border-t border-zinc-800/30">
                              <td className="py-1.5 w-[120px] truncate" title={`${ipHit.ip} - ${ipHit.location}`}>
                                <div className="font-mono text-zinc-300">{ipHit.ip}</div>
                                <div className="text-[9px] text-zinc-500">{ipHit.location || '未知定位'}</div>
                              </td>
                              <td className="py-1.5 text-center">
                                <div className="text-zinc-400 font-bold">{ipHit.count}</div>
                                <div className="text-[9px] text-zinc-500">{new Date(ipHit.lastActive).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                              </td>
                              <td className="py-1.5 text-zinc-400 w-[60px] truncate" title={ipHit.lastUser}>{ipHit.lastUser}</td>
                              {isAdmin && (
                              <td className="py-1.5 text-right w-[40px]">
                                {isBanned ? (
                                  <button
                                    onClick={() => {
                                      const newBans = { ...adminSettings.bannedIps };
                                      delete newBans[ipHit.ip];
                                      adminAction('updateSettings', { settings: { bannedIps: newBans } });
                                    }}
                                    className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20" title={`过期时间: ${banExpiry}`}>解封</button>
                                ) : (
                                  <button
                                    onClick={() => {
                                      const hoursStr = window.prompt(`需要封禁 IP ${ipHit.ip} 多少小时？\n输入 0 或取消可终止操作。`, '24');
                                      if (!hoursStr) return;
                                      const hours = parseInt(hoursStr, 10);
                                      if (isNaN(hours) || hours <= 0) return;
                                      const newBans = { ...(adminSettings.bannedIps || {}), [ipHit.ip]: Date.now() + hours * 3600 * 1000 };
                                      adminAction('updateSettings', { settings: { bannedIps: newBans } });
                                    }}
                                    className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-colors border border-red-500/20">封禁</button>
                                )}
                              </td>
                              )}
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 操作日志 */}
            {adminStats && (isAdmin || userPerms?.viewActionLogs) && adminStats.recentActions && adminStats.recentActions.length > 0 && (
              <div className="mb-5 rounded-xl p-4 flex flex-col gap-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase font-bold tracking-widest" style={{ color: 'var(--text-muted)' }}>操作日志 (最近)</div>
                  <div className="flex gap-2">
                    <select
                      value={logFilter}
                      onChange={(e) => setLogFilter(e.target.value)}
                      className="rounded px-1.5 py-0.5 text-[10px] outline-none transition-all"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    >
                      <option value="全部">全部</option>
                      <option value="被拦截">🚫 被拦截</option>
                      <option value="失败">⚠️ 失败</option>
                      <option value="下载">⬇️ 下载</option>
                      <option value="删除">🗑 删除</option>
                      <option value="文件权限">🔒 权限</option>
                      <option value="登录">🔑 登录</option>
                    </select>
                    <select
                      value={riskLimit}
                      onChange={(e) => setRiskLimit(Number(e.target.value))}
                      className="rounded px-1.5 py-0.5 text-[10px] outline-none transition-all"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    >
                      <option value={10}>10 条</option>
                      <option value={50}>50 条</option>
                      <option value={200}>200 条</option>
                      <option value={99999}>全部</option>
                    </select>
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                  <table className="w-full text-left text-[11px]">
                    <thead className="sticky top-0 backdrop-blur" style={{ background: 'var(--bg-input)' }}>
                      <tr>
                        <th className="py-2 text-zinc-400 font-normal w-[65px]">时间</th>
                        <th className="py-2 text-zinc-400 font-normal w-[45px]">用户</th>
                        <th className="py-2 text-zinc-400 font-normal w-[85px]">动作</th>
                        <th className="py-2 text-zinc-400 font-normal">对象</th>
                        <th className="py-2 text-zinc-400 font-normal w-[100px]">源 IP/定位</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminStats.recentActions
                        .filter((log: any) => {
                          if (logFilter === '全部') return true;
                          return log.action.includes(logFilter);
                        })
                        .slice(0, riskLimit).map((log: any, idx: number) => {
                        const actColor = log.action.includes('被拦截') ? 'text-red-400 font-bold' :
                          log.action.includes('失败')   ? 'text-orange-400' :
                          log.action.includes('删除')   ? 'text-red-400' :
                          log.action.includes('下载')   ? 'text-green-400' :
                          log.action.includes('上传')   ? 'text-yellow-400' :
                          log.action.includes('登录')   ? 'text-blue-400' :
                          log.action.includes('文件权限') ? 'text-purple-400' :
                          'text-zinc-400';
                        return (
                        <tr key={idx} className="border-t border-zinc-800/30">
                          <td className="py-1.5 text-zinc-500 w-[65px] truncate" title={new Date(log.time).toLocaleString()}>{new Date(log.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                          <td className="py-1.5 text-zinc-300 font-bold w-[45px] truncate" title={log.username}>{log.username}</td>
                          <td className={`py-1.5 w-[85px] truncate ${actColor}`} title={log.action}>{log.action}</td>
                          <td className="py-1.5 text-zinc-400 truncate max-w-[120px]" title={log.item}>{log.item}</td>
                          <td className="py-1.5 w-[100px] truncate" title={`${log.ip} - ${log.location}`}>
                            <div className="font-mono text-zinc-500 truncate">{log.ip}</div>
                            <div className="text-[9px] text-zinc-600 truncate">{log.location}</div>
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 安全设置：超管密码 */}
            <div className={`mb-5 rounded-xl p-4 ${isAdmin ? '' : 'hidden'}`} style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
              <div className="text-[10px] uppercase font-bold tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>安全设置</div>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  placeholder="新管理员密码"
                  id="admin-new-password"
                  className="flex-1 rounded px-2.5 py-2 text-[11px] outline-none"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                />
                <button
                  onClick={() => {
                    const input = document.getElementById('admin-new-password') as HTMLInputElement;
                    if (!input.value.trim()) return;
                    adminAction('changeAdminPassword', { password: input.value });
                    input.value = '';
                  }}
                  className="px-4 py-2 bg-red-500/80 text-white text-[11px] font-bold rounded hover:opacity-100 transition-opacity"
                >
                  修改密钥
                </button>
              </div>
            </div>

            {/* 全局设置 */}
            <div className={`mb-5 rounded-xl p-4 ${isAdmin ? '' : 'hidden'}`} style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
              <div className="text-[10px] uppercase font-bold tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>全局设置</div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>启用游客模式 · {adminSettings.enableGuestMode ? '已开启' : '已关闭'}</span>
                <button
                  onClick={() => adminAction('updateSettings', { settings: { enableGuestMode: !adminSettings.enableGuestMode } })}
                  className={`w-10 h-5 rounded-full transition-colors relative ${adminSettings.enableGuestMode ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all ${adminSettings.enableGuestMode ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between mb-3 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>隐藏 AList 原始入口 · {adminSettings.hideAlistButton ? '已开启' : '已关闭'}</span>
                <button
                  onClick={() => adminAction('updateSettings', { settings: { hideAlistButton: !adminSettings.hideAlistButton } })}
                  className={`w-10 h-5 rounded-full transition-colors relative ${adminSettings.hideAlistButton ? 'bg-orange-500' : 'bg-zinc-700'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all ${adminSettings.hideAlistButton ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>
              <div className="pt-3 mt-3 border-t space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-[10px] block mb-2" style={{ color: 'var(--text-muted)' }}>大文件下载通道控制</span>
                {[
                  { key: 'ecs', label: '🚀 阿里云服务器极速下载' },
                  { key: 'cf', label: '🌟 Cloudflare 边缘加速' },
                  { key: 'raw', label: '🚀 复制直链 (迅雷/IDM)' },
                  { key: 'vercel', label: '🔥 服务器中转下载 (备用)' },
                  { key: 'direct302', label: '⚡ 302 直链跳转' }
                ].map((mode) => {
                  const currentMode = adminSettings.downloadModes?.[mode.key as keyof typeof adminSettings.downloadModes] || 'enabled';
                  return (
                    <div key={mode.key} className="flex items-center justify-between">
                      <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{mode.label}</span>
                      <select
                        value={currentMode}
                        onChange={(e) => {
                          const newModes = { ...(adminSettings.downloadModes || {}), [mode.key]: e.target.value };
                          adminAction('updateSettings', { settings: { downloadModes: newModes } });
                          // Optimistic update locally
                          setAdminSettings(prev => ({ ...prev, downloadModes: newModes as any }));
                        }}
                        className="rounded px-1.5 py-1 text-[10px] outline-none shrink-0 w-[60px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                      >
                        <option value="enabled">可用</option>
                        <option value="disabled">禁用</option>
                        <option value="hidden">隐藏</option>
                      </select>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <div>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>下载/上传渠道</span>
                  <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-faint)' }}>ECS = 阿里云极速线路 · FRP = NAS 备用</div>
                </div>
                <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <button
                    onClick={() => { adminAction('updateSettings', { settings: { downloadChannel: 'ecs' } }); setDownloadChannel('ecs'); }}
                    className={`px-3 py-1 rounded text-[10px] font-bold transition-all ${downloadChannel === 'ecs' ? 'bg-pink-500 text-white' : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                  >🚀 ECS</button>
                  <button
                    onClick={() => { adminAction('updateSettings', { settings: { downloadChannel: 'frp' } }); setDownloadChannel('frp'); }}
                    className={`px-3 py-1 rounded text-[10px] font-bold transition-all ${downloadChannel === 'frp' ? 'bg-blue-500 text-white' : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                  >📡 FRP</button>
                </div>
              </div>
              <div className="pt-3 mt-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>登录保持时长（小时）</span>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={adminSettings.sessionDurationHours ?? 8}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v > 0) {
                      setAdminSettings(prev => ({ ...prev, sessionDurationHours: v }));
                      adminAction('updateSettings', { settings: { sessionDurationHours: v } });
                    }
                  }}
                  className="w-16 rounded px-2 py-1 text-[10px] text-center outline-none"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                />
              </div>
              <div className="pt-3 mt-3 border-t space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-[10px] block mb-2" style={{ color: 'var(--text-muted)' }}>系统公告 (清空则不显示)</span>
                <textarea
                  value={adminSettings.announcement || ''}
                  onChange={(e) => setAdminSettings(prev => ({ ...prev, announcement: e.target.value }))}
                  className="w-full h-24 bg-black/40 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-200 outline-none focus:border-blue-500/50 transition-colors resize-none placeholder-zinc-600 font-sans"
                  placeholder="在此输入需要向全部用户显示的系统公告..."
                />
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      const content = adminSettings.announcement || '';
                      adminAction('updateSettings', { settings: { announcement: content } });
                      setGlobalAnnouncement(content);
                      setAlistMsg('✅ 公告已成功发布');
                    }}
                    className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-100 text-[10px] font-bold rounded-lg transition-all shadow-md active:scale-95"
                  >
                    📢 立即发布公告
                  </button>
                </div>
              </div>
            </div>

            {/* 用户列表 */}
            <div className={`mb-5 rounded-xl p-4 ${isAdmin ? '' : 'hidden'}`} style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
              <div className="text-[10px] uppercase font-bold tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>用户列表</div>
              <div className="space-y-2">
                {adminUsers.filter((u) => u.username !== 'admin').map((u) => (
                  <div key={u.username} className="flex flex-col gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono" style={{ color: 'var(--text-primary)' }}>{u.username}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${roleBadgeColor(u.role)}`}>
                          {roleLabel(u.role)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {u.username !== 'admin' && u.username !== 'guest' && (
                          <>
                            <select
                              value={u.role}
                              onChange={(e) => adminAction('updateRole', { username: u.username, role: e.target.value })}
                              className="rounded px-1.5 py-0.5 text-[10px] outline-none" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                            >
                              {isAdmin && <option value="admin">超级管理员</option>}
                              <option value="manager">管理员</option>
                              <option value="guest">游客</option>
                            </select>
                            <button
                              onClick={() => { if (confirm(`确认删除用户 ${u.username}？`)) adminAction('remove', { username: u.username }); }}
                              className="hover:text-red-500 transition-colors" style={{ color: 'var(--text-muted)' }}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {/* 权限设置 (仅非admin) */}
                    {u.username !== 'admin' && (
                      <div className="pt-2 mt-1 border-t flex flex-col gap-3" style={{ borderColor: 'var(--border-subtle)' }}>
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                          {[
                            { key: 'search', label: '🔍 搜索' },
                            { key: 'view', label: '👀 浏览' },
                            { key: 'preview', label: '👁️ 预览' },
                            { key: 'download', label: '⬇️ 下载' },
                            { key: 'upload', label: '⬆️ 上传' },
                            { key: 'delete', label: '🗑️ 删除' },
                            { key: 'rename', label: '📝 重命名' },
                            { key: 'setting', label: '⚙️ 本地配置' },
                            { key: 'controlFile', label: '🔒 文件管理' },
                            { key: 'viewStats', label: '📊 数据审计' },
                            { key: 'viewActionLogs', label: '📋 操作日志' },
                            { key: 'viewIpStats', label: '🌐 IP统计' },
                            { key: 'viewDownloadLogs', label: '📥 下载明细' }
                          ].map(perm => {
                            const isLogPerm = ['viewStats', 'viewActionLogs', 'viewIpStats', 'viewDownloadLogs'].includes(perm.key);
                            const uPerms = (u.permissions || {}) as any as Record<string, boolean>;
                            const isOn = uPerms[perm.key] === true;
                            const viewOff = !isLogPerm && perm.key !== 'view' && perm.key !== 'controlFile' && !uPerms.view;
                            return (
                              <label key={perm.key} className={`flex items-center gap-1.5 cursor-pointer ${viewOff ? 'opacity-30 pointer-events-none' : 'hover:opacity-80'}`}>
                                <input
                                  type="checkbox"
                                  checked={isOn}
                                  disabled={viewOff}
                                  onChange={(e) => {
                                    let newPerms = { ...uPerms, [perm.key]: e.target.checked };
                                    if (perm.key === 'view' && !e.target.checked) {
                                      newPerms = { ...newPerms, view: false, search: false, preview: false, download: false, upload: false, delete: false, rename: false, setting: false };
                                    }
                                    adminAction('updatePermissions', { username: u.username, permissions: newPerms });
                                  }}
                                  className="w-2.5 h-2.5 accent-pink-500"
                                />
                                <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{perm.label}</span>
                              </label>
                            );
                          })}
                        </div>

                        {/* 目录隔离设置 */}
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] shrink-0" style={{ color: 'var(--text-muted)' }}>🔒 根目录映射：</span>
                          <input
                            type="text"
                            defaultValue={u.permissions?.basePath || '/'}
                            onBlur={(e) => {
                              const newPath = e.target.value.trim() || '/';
                              if (newPath !== (u.permissions?.basePath || '/')) {
                                adminAction('updatePermissions', { username: u.username, permissions: { ...u.permissions, basePath: newPath.startsWith('/') ? newPath : `/${newPath}` } });
                              }
                            }}
                            placeholder="如: /Movies (默认 /)"
                            className="flex-1 rounded px-2 py-1 text-[10px] outline-none"
                            style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 添加用户 */}
            {isAdmin && (
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
              <div className="text-[10px] uppercase font-bold tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>添加用户</div>
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    type="text" value={newUserName} onChange={e => setNewUserName(e.target.value)}
                    placeholder="用户名" className="flex-1 rounded px-2.5 py-2 text-[11px] outline-none" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  />
                  <input
                    type="password" value={newUserPass} onChange={e => setNewUserPass(e.target.value)}
                    placeholder="密钥" className="flex-1 rounded px-2.5 py-2 text-[11px] outline-none" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="flex gap-2">
                  <select
                    value={newUserRole} onChange={e => setNewUserRole(e.target.value as 'manager' | 'guest')}
                    className="flex-1 rounded px-2.5 py-2 text-[11px] outline-none border-accent" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  >
                    {isAdmin && <option value="admin">超级管理员</option>}
                    <option value="manager">核心成员（可上传/管理）</option>
                    <option value="guest">游客（仅浏览/下载）</option>
                  </select>
                  <button
                    onClick={() => {
                      if (!newUserName.trim() || !newUserPass.trim()) { setAdminMsg('❌ 用户名和密钥不能为空'); return; }
                      adminAction('add', { username: newUserName.trim(), password: newUserPass.trim(), role: newUserRole });
                      setNewUserName(''); setNewUserPass('');
                    }}
                    className="px-4 py-2 bg-accent text-white text-[11px] font-bold rounded hover:opacity-80 transition-opacity"
                  >
                    添加
                  </button>
                </div>
              </div>
            </div>
            )}
          </div>
        </div>
      )}

      {/* 详细下载日志弹窗 */}
      {selectedChannelDetailedStats && adminStats?.channelStats?.[selectedChannelDetailedStats] && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setSelectedChannelDetailedStats(null)}>
          <div className="w-full max-w-lg glass-strong rounded-2xl p-5 mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">📋</span>
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  渠道下载明细 - {selectedChannelDetailedStats.toUpperCase()}
                </h3>
              </div>
              <button onClick={() => setSelectedChannelDetailedStats(null)} className="text-lg hover:opacity-100 opacity-60 transition-opacity">✕</button>
            </div>

            <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
              <span className="text-[10px] text-emerald-500/80 font-bold uppercase tracking-wider">数据汇总</span>
              <span className="text-[12px] font-mono font-bold text-emerald-400">共计 {adminStats.channelStats[selectedChannelDetailedStats].logs?.length || 0} 条流水</span>
            </div>

            <div className="max-h-96 overflow-y-auto pr-2 custom-scrollbar">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 backdrop-blur pb-1 mb-1 border-b border-zinc-800/50" style={{ background: 'var(--bg-input)' }}>
                  <tr>
                    <th className="py-2 text-zinc-400 font-normal w-[65px]">时间</th>
                    <th className="py-2 text-zinc-400 font-normal w-[45px]">用户</th>
                    <th className="py-2 text-zinc-400 font-normal w-[120px]">请求 IP/定位</th>
                    <th className="py-2 text-zinc-400 font-normal">文件内容</th>
                  </tr>
                </thead>
                <tbody>
                  {adminStats.channelStats[selectedChannelDetailedStats].logs?.map((log: any, idx: number) => (
                    <tr key={idx} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                      <td className="py-1.5 text-zinc-500 w-[65px] truncate" title={new Date(log.time).toLocaleString()}>{new Date(log.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="py-1.5 text-zinc-300 font-bold w-[45px] truncate" title={log.username}>{log.username}</td>
                      <td className="py-1.5 w-[120px] truncate" title={`${log.ip} - ${log.location}`}>
                        <div className="font-mono text-zinc-500 truncate">{log.ip}</div>
                        <div className="text-[9px] text-zinc-600 truncate">{log.location}</div>
                      </td>
                      <td className="py-1.5 text-orange-300 truncate max-w-[150px]" title={log.item}>{log.item}</td>
                    </tr>
                  ))}
                  {!adminStats.channelStats[selectedChannelDetailedStats].logs?.length && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-zinc-500 text-[11px]">本通道暂无下载访问记录</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 全量下载统计弹窗 */}
      {allDownloadStatsModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setAllDownloadStatsModal(null)}>
          <div className="w-full max-w-lg glass-strong rounded-2xl p-5 mx-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">📊</span>
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  {allDownloadStatsModal.title}
                </h3>
              </div>
              <button onClick={() => setAllDownloadStatsModal(null)} className="text-lg hover:opacity-100 opacity-60 transition-opacity">✕</button>
            </div>

            <div className="mb-3 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-between">
              <span className="text-[10px] text-blue-500/80 font-bold uppercase tracking-wider">全量审计</span>
              <span className="text-[12px] font-mono font-bold text-blue-400">共计 {allDownloadStatsModal.logs.length} 条流水</span>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 backdrop-blur pb-1 mb-1 border-b border-zinc-800/50" style={{ background: 'var(--bg-input)' }}>
                  <tr>
                    <th className="py-2 text-zinc-400 font-normal w-[65px]">时间</th>
                    <th className="py-2 text-zinc-400 font-normal w-[45px]">用户</th>
                    <th className="py-2 text-zinc-400 font-normal w-[120px]">请求 IP/定位</th>
                    <th className="py-2 text-zinc-400 font-normal">文件与渠道</th>
                  </tr>
                </thead>
                <tbody>
                  {allDownloadStatsModal.logs.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).map((log: any, idx: number) => (
                    <tr key={idx} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                      <td className="py-1.5 text-zinc-500 w-[65px] truncate" title={new Date(log.time).toLocaleString()}>{new Date(log.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="py-1.5 text-zinc-300 font-bold w-[45px] truncate" title={log.username}>{log.username}</td>
                      <td className="py-1.5 w-[120px] truncate" title={`${log.ip} - ${log.location}`}>
                        <div className="font-mono text-zinc-500 truncate">{log.ip}</div>
                        <div className="text-[9px] text-zinc-600 truncate">{log.location}</div>
                      </td>
                      <td className="py-1.5 text-orange-300 truncate max-w-[150px]" title={log.item}>
                        <div className="truncate">{log.item}</div>
                        <div className="text-[9px] text-emerald-500/80 uppercase">{log.channel}</div>
                      </td>
                    </tr>
                  ))}
                  {!allDownloadStatsModal.logs.length && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-zinc-500 text-[11px]">所选时间范围内暂无下载记录</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 设置弹窗 */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowSettings(false)}>
          <div className="w-full max-w-sm glass-strong rounded-2xl p-4 mx-4 animate-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[12px] font-bold" style={{ color: 'var(--text-primary)' }}>⚙️ AList 服务端设置</div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>仅在您当前浏览器有效，覆盖系统默认配置</div>
              </div>
              <button onClick={() => setShowSettings(false)} className="text-lg hover:opacity-100 opacity-60 transition-opacity">✕</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] mb-1 block" style={{ color: 'var(--text-muted)' }}>AList_URL [必须项]</label>
                <input type="text" value={customUrl} onChange={e => setCustomUrl(e.target.value)} placeholder="如: https://pan.tantantan.tech:5245" className="w-full rounded px-2.5 py-2 text-[11px] outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[10px] mb-1 block" style={{ color: 'var(--text-muted)' }}>AList_Username [用于后台/直链获取]</label>
                <input type="text" value={customUser} onChange={e => setCustomUser(e.target.value)} placeholder="可留空使用默认" className="w-full rounded px-2.5 py-2 text-[11px] outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[10px] mb-1 block" style={{ color: 'var(--text-muted)' }}>AList_Password</label>
                <input type="password" value={customPass} onChange={e => setCustomPass(e.target.value)} placeholder="可留空使用默认" className="w-full rounded px-2.5 py-2 text-[11px] outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => {
                  if (customUrl) {
                    localStorage.setItem('ALIST_CUSTOM_CONFIG', JSON.stringify({ url: customUrl, user: customUser, pass: customPass }));
                    setAlistMsg('✅ 本地自定义配置已保存并生效');
                  } else {
                    localStorage.removeItem('ALIST_CUSTOM_CONFIG');
                    setAlistMsg('✅ 已恢复默认后端配置');
                  }
                  setShowSettings(false);
                  alistListDir('/');
                }}
                className="flex-1 bg-accent text-white text-[11px] font-bold py-2 rounded shadow hover:opacity-80"
              >
                保存配置
              </button>
              <button
                onClick={() => {
                  localStorage.removeItem('ALIST_CUSTOM_CONFIG');
                  setCustomUrl(''); setCustomUser(''); setCustomPass('');
                  setAlistMsg('✅ 已恢复默认配置');
                  setShowSettings(false);
                  alistListDir('/');
                }}
                className="px-3 text-[11px] py-2 rounded" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}
              >
                恢复默认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 使用说明弹窗 */}
      {showManual && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-md" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setShowManual(false)}>
          <div className="w-full max-w-xl max-h-[85vh] flex flex-col glass-strong rounded-3xl overflow-hidden animate-in shadow-2xl border border-white/10" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}>
              <div className="flex items-center gap-3">
                <span className="text-xl">📖</span>
                <div>
                  <h3 className="text-base font-bold text-accent">STA-PAN 使用指南</h3>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>如何获得最满速的下载体验？</div>
                </div>
              </div>
              <button onClick={() => setShowManual(false)} className="hover:opacity-100 opacity-60 transition-opacity p-2 -mr-2 text-lg">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              <section className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-wider text-accent border-l-2 border-accent pl-2">1. 关于下载限制与本站优势</h4>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
                  <p className="text-xs leading-relaxed text-zinc-100">
                    <span className="font-bold text-pink-400">为什么会有这么多复杂的下载方式？</span><br />
                    百度网盘会校验客户端的 <code className="text-[10px] bg-black/30 px-1 py-0.5 rounded text-pink-300">User-Agent: pan.baidu.com</code>，如果不携带正确的 UA，下载请求会被阻断（返回 403 错误）。为了统一 IP 来源、避免触发百度风控，所有百度网盘文件均通过以下方式下载。
                  </p>
                  <div className="h-px w-full bg-white/10"></div>
                  <p className="text-xs leading-relaxed text-zinc-100">
                    <span className="font-bold text-emerald-200">STA-PAN 的最大优势：对手机端极度友好！</span><br />
                    如果你直接使用AList，也就是之前的那个版本，手机上通常只能靠专门抓包或安装带有改 UA 功能的特殊浏览器/插件才能下载大文件。
                    <br />而在本站：我们通过 <span className="font-bold text-blue-100">阿里云节点中转</span> 或是 <span className="font-bold text-blue-100">Cloudflare中转</span>，在云端帮你**自动补齐了 UA**，所以你在手机上可以像下普通文件一样，直接浏览器点击完成极速下载，完全**免除任何插件配置。**只不过会牺牲速度，但总比在手机上下不了好
                  </p>
                </div>
              </section>

              <section className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-wider text-accent border-l-2 border-accent pl-2">下载方式对比</h4>
                <div className="grid grid-cols-1 gap-4">
                  {/* 阿里云极速线路 */}
                  <div className="p-4 rounded-2xl bg-pink-600/10 border border-pink-500/30">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm">🚀</span>
                      <span className="text-sm font-black uppercase text-pink-100 italic">阿里云极速线路 (最推荐)</span>
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-100 mb-2">
                      利用阿里云国内 BGP 骨干网中转，自动处理百度 UA。
                    </p>
                    <div className="space-y-1.5 pt-2 border-t border-pink-500/10">
                      <div className="text-[11px] flex items-center gap-2">
                        <span className="text-white font-bold shrink-0">✅ 推荐度:</span>
                        <span className="text-pink-400 font-bold">⭐⭐⭐⭐⭐ (最快的)</span>
                      </div>
                      <div className="text-[11px] flex items-start gap-2">
                        <span className="text-white font-bold shrink-0">✨ 优点:</span>
                        <span className="text-pink-100">国内线路，速度极快，对手机浏览器直下最友好。</span>
                      </div>
                    </div>
                  </div>
                  {/* CF 边缘加速 */}
                  <div className="p-4 rounded-2xl bg-blue-600/10 border border-blue-500/30">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm">☁️</span>
                      <span className="text-sm font-black uppercase text-blue-100">Cloudflare 边缘加速</span>
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-100 mb-2">
                      通过部署在海外的 CF Workers 节点中转文件请求，绕过国内直连限制。
                    </p>
                    <div className="space-y-1.5 pt-2 border-t border-blue-500/10">
                      <div className="text-[11px] flex items-center gap-2">
                        <span className="text-white font-bold shrink-0">✅ 推荐度:</span>
                        <span className="text-blue-300 font-bold">⭐⭐⭐</span>
                      </div>
                      <div className="text-[11px] flex items-start gap-2">
                        <span className="text-white font-bold shrink-0">✨ 优点:</span>
                        <span className="text-blue-100">不通过阿里云，在阿里云服务器失效时作为首选下载方案</span>
                      </div>
                    </div>
                  </div>

                  {/* IDM 直链 */}
                  <div className="p-4 rounded-2xl bg-emerald-600/10 border border-emerald-500/30">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm">🚀</span>
                      <span className="text-sm font-black uppercase text-emerald-200">复制直链 (搭配 IDM/迅雷)</span>
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-100 mb-2">
                      直接调取百度网盘 CDN 原始地址。配合多线程下载器可突破单线程限速。
                    </p>
                    <div className="space-y-1.5 pt-2 border-t border-emerald-500/10">
                      <div className="text-[11px] flex items-center gap-2">
                        <span className="text-white font-bold shrink-0">✅ 推荐度:</span>
                        <span className="text-emerald-300 font-bold">⭐⭐⭐⭐⭐ (满速)</span>
                      </div>
                      <div className="text-[11px] flex items-start gap-2">
                        <span className="text-white font-bold shrink-0">✨ 优点:</span>
                        <span className="text-emerald-100 font-bold">速度可达 50MB/s。由于是点对点下载</span>
                      </div>
                    </div>
                  </div>

                  {/* 服务器中转 */}
                  <div className="p-4 rounded-2xl bg-pink-600/10 border border-pink-500/30 opacity-90">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm">🔥</span>
                      <span className="text-sm font-black uppercase text-pink-100">vercel中转下载</span>
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-100 mb-2">
                      由 vercel 服务器代理加UA，每个月有7G下载限额，不推荐
                    </p>
                    <div className="space-y-1.5 pt-2 border-t border-pink-500/10">
                      <div className="text-[11px] flex items-center gap-2">
                        <span className="text-white font-bold shrink-0">⚠️ 推荐度:</span>
                        <span className="text-pink-300 font-bold">⭐ (仅做故障备用)</span>
                      </div>
                      <div className="text-[11px] flex items-start gap-2">
                        <span className="text-white font-bold shrink-0">❌ 缺点:</span>
                        <span className="text-pink-100">消耗服务器有限的带宽与流量（每个月只有7G），请尽量避开。</span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* IDM 配置指南 */}
              <section className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-wider text-accent border-l-2 border-accent pl-2">3. IDM/NDM 满速配置教程 (极速 50MB/s)</h4>
                <div className="p-5 rounded-3xl bg-white/5 border border-white/10 space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</div>
                    <p className="text-xs text-zinc-100">下载安装官方版 <a href="https://zhuanlan.zhihu.com/p/1977103358688002514" target="_blank" className="text-accent underline font-bold">IDM（NDM同理）</a> (电脑端专用)。</p>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</div>
                    <p className="text-xs text-zinc-100">
                      进入设置：<span className="font-bold text-white border-b border-white/30">选项 (Options) -&gt; 下载 (Downloads)</span>。
                    </p>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">3</div>
                    <div className="flex-1 space-y-3">
                      <p className="text-xs text-zinc-100">在底部找到 <span className="font-bold text-white uppercase tracking-tighter">“手动添加任务时使用的 UA”</span>，复制填写：</p>
                      <code className="block p-3 rounded-xl bg-black border border-white/20 text-sm font-mono text-pink-400 select-all text-center">pan.baidu.com</code>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">4</div>
                    <p className="text-xs text-zinc-100">在网盘点击 <span className="text-emerald-400 font-bold underline">复制直链</span>，在 IDM 中新建粘贴即可起飞。</p>
                  </div>
                </div>
              </section>

              {/* 大小文件逻辑汇总 */}
              <section className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-wider text-accent border-l-2 border-accent pl-2">4. 到底怎么下载？</h4>
                <div className="p-4 rounded-2xl bg-emerald-600/10 border border-emerald-500/30 text-xs text-zinc-100 leading-relaxed shadow-lg">
                  <div className="mb-2">
                    <span className="text-emerald-400 font-bold">● 小于 20MB 的文件：</span>
                    点击文件列表中的文件，<span className="text-white font-bold bg-emerald-400/20 px-1 py-0.5 rounded">直接下载</span>，无需任何额外操作！
                  </div>
                  <div>
                    <span className="text-pink-400 font-bold">● 大于 20MB 的文件：</span>
                    因受百度网盘限制，点击大文件后会弹出备选通道（参见上面的第 2 点）。
                    <ul className="list-disc pl-5 mt-2 space-y-1.5 text-[11px] text-zinc-300">
                      <li><strong className="text-blue-300">手机端直接点：</strong> 无脑选第一个 <span className="bg-blue-500/20 px-1 py-0.5 rounded">阿里云服务器代理下载</span>，这是手机端满速、免插件的最优解。</li>
                      <li><strong className="text-emerald-300">电脑端最快下载：</strong> 如果有 IDM 或迅雷或NDM，选第二个 <span className="bg-emerald-500/20 px-1 py-0.5 rounded">复制直链</span>。</li>
                      <li>如果阿里云挂了，选cloudflare。上述挂了，才选“vercel”（尽量少用）。</li>
                    </ul>
                  </div>
                </div>
              </section>


            </div>

            <div className="p-4 border-t" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}>
              <button
                onClick={() => setShowManual(false)}
                className="w-full py-2.5 rounded-xl bg-accent text-white text-xs font-bold hover:opacity-90 transition-opacity shadow-lg shadow-accent/20"
              >
                我知道了，去下载文件
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 文件预览弹窗 */}
      {previewItemMeta && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 backdrop-blur-xl" style={{ background: 'rgba(0,0,0,0.85)' }} onClick={() => { setPreviewFile(null); setPreviewText(''); setPreviewItemMeta(null); setArchiveItems([]); }}>
          <div className="w-full max-w-5xl max-h-[92vh] flex flex-col rounded-3xl overflow-hidden animate-in shadow-2xl border border-white/10" style={{ background: 'var(--bg-app)' }} onClick={e => e.stopPropagation()}>
            {/* 顶部栏 */}
            <div className="flex items-center justify-between px-6 py-4 border-b shrink-0" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-lg shrink-0">
                  {previewFile?.type === 'image' ? '🖼️' : previewFile?.type === 'video' ? '🎬' : previewFile?.type === 'pdf' ? '📄' : previewFile?.type === 'archive' ? '📦' : '📝'}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{previewItemMeta?.name || '加载中...'}</h3>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {previewItemMeta?.size ? `${(previewItemMeta.size / 1024 / 1024).toFixed(2)} MB` : ''} · 在线预览
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {previewItemMeta && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canDownload) { setPreviewFile(null); setPreviewText(''); setPreviewItemMeta(null); setArchiveItems([]); logUserAction('下载', previewItemMeta?.filePath || '', 'blocked'); setAlistMsg('❌ 您没有下载权限'); return; }
                      if (previewItemMeta?.perms?.download === false) { setPreviewFile(null); setPreviewText(''); setPreviewItemMeta(null); setArchiveItems([]); logUserAction('下载', previewItemMeta?.filePath || '', 'blocked'); setAlistMsg('❌ 该文件已被权限规则禁止下载'); return; }
                      const prov = alistProvider.toLowerCase();
                      const isBaidu = prov.includes('baidu') || alistPath.toLowerCase().includes('baidu') || alistPath.includes('百度网盘');
                      const isAliyun = prov.includes('aliyun') || alistPath.toLowerCase().includes('aliyun') || alistPath.includes('阿里云盘');
                      if (isBaidu) {
                        setAlistDownloadModal({ name: previewItemMeta.name, filePath: previewItemMeta.filePath, sign: previewItemMeta.sign });
                      } else if (isAliyun) {
                        alistProxyDownload(previewItemMeta.filePath, previewItemMeta.name);
                      } else {
                        alistDirectDownload(previewItemMeta.filePath, previewItemMeta.sign);
                      }
                      setPreviewFile(null); setPreviewText(''); setPreviewItemMeta(null); setArchiveItems([]);
                    }}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-accent text-white hover:opacity-80 transition-opacity"
                  >
                    ⬇️ 下载
                  </button>
                )}
                <button onClick={() => { setPreviewFile(null); setPreviewText(''); setPreviewItemMeta(null); setPreviewStarted(false); setArchiveItems([]); }} className="hover:opacity-100 opacity-60 transition-opacity p-2 text-lg">✕</button>
              </div>
            </div>

            {/* 预览主体 */}
            <div className="flex-1 overflow-auto flex items-center justify-center p-4" style={{ background: '#0a0a0a' }}>
              {!previewStarted ? (
                <div className="flex flex-col items-center justify-center gap-4">
                  <div className="text-zinc-500 text-sm">点击下方按钮开始加载并预览文件</div>
                  <button onClick={loadPreviewContent} className="px-6 py-2.5 bg-accent hover:opacity-80 text-white font-bold rounded-lg shadow-[0_0_15px_rgba(236,72,153,0.3)] transition-all">
                    ▶️ 点击加载预览
                  </button>
                </div>
              ) : previewLoading && !previewFile ? (
                <div className="text-zinc-400 text-sm animate-pulse">⏳ 正在加载预览...</div>
              ) : previewText && previewText.startsWith('❌') ? (
                <div className="text-red-400 text-sm p-6 text-center">{previewText}</div>
              ) : previewFile?.type === 'image' ? (
                <img src={previewFile.url} alt={previewFile.name} className="max-w-full max-h-[78vh] object-contain rounded-lg shadow-2xl" />
              ) : previewFile?.type === 'video' ? (
                <video src={previewFile.url} controls autoPlay className="max-w-full max-h-[78vh] rounded-lg shadow-2xl" style={{ outline: 'none' }} />
              ) : previewFile?.type === 'pdf' ? (
                <iframe src={previewFile.url} className="w-full h-[78vh] rounded-lg border-0 bg-white" title={previewFile.name} />
              ) : previewFile?.type === 'office' ? (
                <iframe src={previewFile.url} className="w-full h-[78vh] rounded-lg border-0 bg-white" title={previewFile.name} />
              ) : previewFile?.type === 'text' ? (
                <pre className="w-full h-full overflow-auto text-xs leading-relaxed text-zinc-300 font-mono p-6 rounded-xl whitespace-pre-wrap break-words" style={{ background: '#111', maxHeight: '78vh' }}>
                  {previewText || '加载中...'}
                </pre>
              ) : previewFile?.type === 'archive' ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-xs text-zinc-300 p-6 rounded-xl" style={{ background: '#111', maxHeight: '78vh' }}>
                  <div className="font-bold text-lg mb-4 text-emerald-400">📦 压缩包预览</div>
                  <div className="text-zinc-400 whitespace-pre-wrap text-center leading-relaxed max-w-md">{previewText}</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* 更新日志弹窗 */}
      {showChangelog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowChangelog(false)}>
          <div className="w-full max-w-lg max-h-[80vh] flex flex-col glass-strong rounded-2xl overflow-hidden animate-in shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}>
              <div>
                <h3 className="text-base font-bold text-accent">更新日志 (Changelog)</h3>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>STA-PAN 开发历程记录</div>
              </div>
              <button onClick={() => setShowChangelog(false)} className="hover:opacity-100 opacity-60 transition-opacity p-2 -mr-2 text-lg">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {CHANGELOG_DATA.map((log: any, idx: number) => (
                <div key={log.hash} className="relative pl-6">
                  {/* Timeline dot and line */}
                  <div className="absolute left-[3px] top-[5px] w-2 h-2 rounded-full bg-pink-500 shadow-[0_0_8px_rgba(236,72,153,0.8)] ring-4 ring-black" style={{ '--tw-ring-color': 'var(--bg-app)' } as any}></div>
                  {idx !== CHANGELOG_DATA.length - 1 && (
                    <div className="absolute left-[6px] top-[14px] bottom-[-24px] w-[1px]" style={{ background: 'var(--border-color)' }}></div>
                  )}
                  <div className="flex items-baseline gap-2 mb-1.5">
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded border border-pink-500/30 text-pink-400 bg-pink-500/5">v{log.version}</span>
                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{log.date.split(' ')[0]}</span>
                  </div>
                  <div className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                    {log.message}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 text-center text-[10px] border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-faint)' }}>
              历史版本记录就到这里啦 ~
            </div>
          </div>
        </div>
      )}

      {/* 批量下载 T1/T2 选择弹窗 */}
      {batchModeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setBatchModeModal(null)}>
          <div className="w-full max-w-sm glass-strong rounded-2xl p-5 mx-4 animate-in" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className="text-lg mb-1">📦</div>
              <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>批量下载</div>
              <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                {batchModeModal.folders.length > 0 && `${batchModeModal.folders.length} 个文件夹`}
                {batchModeModal.folders.length > 0 && batchModeModal.files.length > 0 && ' + '}
                {batchModeModal.files.length > 0 && `${batchModeModal.files.length} 个文件`}
              </div>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => {
                  setBatchModeModal(null);
                  // 文件和文件夹合并打包
                  const allItems = [...batchModeModal.folders, ...batchModeModal.files];
                  if (allItems.length > 0) {
                    alistBatchDownloadFolders(allItems);
                  }
                }}
                className="w-full flex items-center justify-between rounded-xl px-4 py-3 text-left border transition-all hover:scale-[1.02] active:scale-[0.98] group"
                style={{ background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(8, 145, 178, 0.05))', borderColor: 'rgba(6, 182, 212, 0.3)' }}
              >
                <div>
                  <div className="text-[12px] font-bold text-cyan-200">📦 打包下载 (ZIP)</div>
                  <div className="text-[10px] text-zinc-500">合并为一个压缩包，保留目录结构</div>
                </div>
              </button>
              <button
                onClick={() => alistBatchDownloadT2(batchModeModal.folders, batchModeModal.files)}
                className="w-full flex items-center justify-between rounded-xl px-4 py-3 text-left border transition-all hover:scale-[1.02] active:scale-[0.98] group"
                style={{ background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(22, 163, 74, 0.05))', borderColor: 'rgba(34, 197, 94, 0.3)' }}
              >
                <div>
                  <div className="text-[12px] font-bold text-green-200">⚡ 逐个下载 (直链满速)</div>
                  <div className="text-[10px] text-zinc-500">每个文件直连下载，不经过服务器中转</div>
                </div>
              </button>
              <button onClick={() => setBatchModeModal(null)}
                className="w-full text-center text-[11px] py-2 rounded-lg transition-all"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}
              >取消</button>
            </div>
          </div>
        </div>
      )}

      {/* T2 进度提示 */}
      {t2Progress && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-2xl animate-in"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
          <div className="flex items-center gap-3 text-[13px] font-bold">
            <span>⚡</span>
            <span>{t2Progress.msg}</span>
            {t2Progress.total > 0 && (
              <div className="w-32 h-2 rounded-full bg-zinc-700 overflow-hidden">
                <div className="h-full bg-green-500 transition-all" style={{ width: `${(t2Progress.current / t2Progress.total) * 100}%` }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 百度网盘文件下载方式选择弹窗 */}
      {alistDownloadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setAlistDownloadModal(null)}>
          <div className="w-full max-w-sm glass-strong rounded-2xl p-4 mx-4 glow-accent animate-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'var(--text-muted)' }}>百度网盘文件下载</div>
                <div className="text-xs font-mono truncate max-w-[260px] mt-1" style={{ color: 'var(--text-primary)' }}>{alistDownloadModal.name}</div>
              </div>
              <button onClick={() => setAlistDownloadModal(null)} className="hover:opacity-100 opacity-60 text-lg transition-opacity">✕</button>
            </div>
            <div className="space-y-2">
              {/* 云端节点极速下载 (200M - 服务器代理加UA) */}
              {globalDownloadModes?.ecs !== 'hidden' && (
                <button
                  onClick={() => {
                    if (globalDownloadModes?.ecs === 'disabled') return;
                    setAlistMsg('⏳ 正在连接阿里云服务器...');
                    console.log(`[下载:ECS] ${alistDownloadModal!.filePath}`);
                    logUserAction('下载 - 阿里云服务器极速下载', alistDownloadModal!.filePath);
                    let downloadUrl = `/api/alist-download?path=${encodeURIComponent(alistDownloadModal!.filePath)}`;
                    if (userToken) downloadUrl += `&token=${encodeURIComponent(userToken)}`;
                    const ccConfigStr = localStorage.getItem('ALIST_CUSTOM_CONFIG');
                    if (ccConfigStr) {
                      downloadUrl += `&c=${btoa(encodeURIComponent(ccConfigStr))}`;
                    }
                    window.open(downloadUrl, '_blank');
                    setAlistMsg('已启动阿里云服务器通道');
                    setAlistDownloadModal(null);
                  }}
                  disabled={globalDownloadModes?.ecs === 'disabled'}
                  className={`w-full flex items-center justify-between border rounded-xl px-4 py-3 text-left transition-all duration-300 ${globalDownloadModes?.ecs === 'disabled' ? 'opacity-50 cursor-not-allowed grayscale' : 'hover:scale-[1.02] active:scale-[0.98] shadow-sm group'}`}
                  style={{ background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.1) 0%, rgba(219, 39, 119, 0.05) 100%)', borderColor: 'rgba(236, 72, 153, 0.3)' }}
                >
                  <div>
                    <div className="text-[12px] font-bold pb-0.5 text-pink-400 group-hover:text-pink-300 transition-colors flex items-center gap-2">
                      <span>阿里云服务器下载 {globalDownloadModes?.ecs === 'disabled' && '(已禁用)'}</span>
                      {nodeLatencies['ecs'] !== undefined && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${nodeLatencies['ecs'] === -1 ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-pink-500/10 border-pink-500/20 text-pink-400'}`}>
                          {nodeLatencies['ecs'] === -1 ? '不通 / 超时' : nodeLatencies['ecs'] === -2 ? '已连接 (HTTP限制)' : `${nodeLatencies['ecs']}ms`}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500">阿里云服务器代理中转，速度近期较慢</div>
                  </div>
                  <div className="text-pink-500/30 group-hover:text-pink-400 transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </div>
                </button>
              )}

              {/* Cloudflare Workers 边缘代理 (方法1) */}
              {globalDownloadModes?.cf !== 'hidden' && (
                <button
                  onClick={() => {
                    if (globalDownloadModes?.cf === 'disabled') return;
                    setAlistMsg('⏳ 正在连接 cf.ryantan.fun 代理节点...');
                    console.log(`[下载:CF] ${alistDownloadModal!.filePath}`);
                    logUserAction('下载 - Cloudflare 边缘加速', alistDownloadModal!.filePath);
                    fetchAlist({ action: 'get', path: alistDownloadModal!.filePath })
                      .then(r => r.json())
                      .then(data => {
                        if (data.code === 200 && data.data?.raw_url) {
                          const cfUrl = `https://cf.ryantan.fun/?url=${encodeURIComponent(data.data.raw_url)}`;
                          window.location.href = cfUrl;
                        } else setAlistMsg('❌ 获取直链失败');
                      }).catch(() => setAlistMsg('❌ 接口异常'));
                    setAlistDownloadModal(null);
                  }}
                  disabled={globalDownloadModes?.cf === 'disabled'}
                  className={`w-full flex items-center justify-between border rounded-xl px-4 py-3 text-left transition-all duration-300 ${globalDownloadModes?.cf === 'disabled' ? 'opacity-50 cursor-not-allowed grayscale' : 'hover:scale-[1.02] active:scale-[0.98] shadow-sm group'}`}
                  style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(37, 99, 235, 0.05) 100%)', borderColor: 'rgba(59, 130, 246, 0.3)' }}
                >
                  <div>
                    <div className="text-[12px] font-bold pb-1 text-blue-400 group-hover:text-blue-300 transition-colors flex items-center gap-2">
                      <span>Cloudflare 边缘加速 {globalDownloadModes?.cf === 'disabled' && '(已禁用)'}</span>
                      {nodeLatencies['cf'] !== undefined && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${nodeLatencies['cf'] === -1 ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-blue-500/10 border-blue-500/20 text-blue-400'}`}>
                          {nodeLatencies['cf'] === -1 ? '超时丢包' : `${nodeLatencies['cf']}ms`}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500">通过Cloudflare中转，速度中等</div>
                  </div>
                  <div className="text-blue-500/30 group-hover:text-blue-400 transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>
                  </div>
                </button>
              )}

              {/* 复制直链 (方法2) */}
              {globalDownloadModes?.raw !== 'hidden' && (
                <button
                  onClick={() => {
                    if (globalDownloadModes?.raw === 'disabled') return;
                    console.log(`[下载:RAW] ${alistDownloadModal!.filePath}`);
                    logUserAction('下载 - 复制直链', alistDownloadModal!.filePath);
                    fetchAlist({ action: 'get', path: alistDownloadModal!.filePath })
                      .then(r => r.json())
                      .then(data => {
                        let url = '';
                        if (data.code === 200 && data.data?.raw_url) {
                          url = data.data.raw_url;
                        } else {
                          const sign = data.code === 200 ? (data.data?.sign || '') : '';
                          url = sign ? `${getAlistBase()}/d${alistDownloadModal!.filePath}?sign=${sign}` : `${getAlistBase()}/d${alistDownloadModal!.filePath}`;
                        }
                        navigator.clipboard.writeText(url).then(() => {
                          setAlistMsg('✅ 直链已自动复制到剪贴板');
                        }).catch(() => {
                          setAlistMsg('⚠️ 自动复制失败，请手动复制');
                        });
                        setAlistCopyLinkModal({ url, fileName: alistDownloadModal!.name });
                      }).catch(() => {
                        const url = `${getAlistBase()}/d${alistDownloadModal!.filePath}`;
                        navigator.clipboard.writeText(url).catch(() => {});
                        setAlistCopyLinkModal({ url, fileName: alistDownloadModal!.name });
                      });
                    setAlistDownloadModal(null);
                  }}
                  disabled={globalDownloadModes?.raw === 'disabled'}
                  className={`w-full flex items-center justify-between rounded-xl px-4 py-3 text-left transition-all duration-300 border shadow-sm ${globalDownloadModes?.raw === 'disabled' ? 'opacity-50 cursor-not-allowed grayscale' : 'hover:scale-[1.02] active:scale-[0.98] group'}`}
                  style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.05) 100%)', borderColor: 'rgba(16, 185, 129, 0.3)' }}
                >
                  <div>
                    <div className="text-[12px] font-bold text-emerald-200 group-hover:text-emerald-100 transition-colors flex items-center gap-2">
                      <span>复制直链 (迅雷/IDM/NDM) {globalDownloadModes?.raw === 'disabled' && '(已禁用)'}</span>
                      {nodeLatencies['raw'] !== undefined && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${nodeLatencies['raw'] === -1 ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
                          {nodeLatencies['raw'] === -1 ? '超时丢包' : `${nodeLatencies['raw']}ms`}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500">搭配 IDM/NDM 并设置 UA 为 pan.baidu.com </div>
                  </div>
                  <div className="text-emerald-500/30 group-hover:text-emerald-400 transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                  </div>
                </button>
              )}

              {/* 自动加UA直接下载 (方法3 - 可禁用) */}
              {globalDownloadModes?.vercel !== 'hidden' && (
                <button
                  onClick={() => {
                    if (globalDownloadModes?.vercel === 'disabled') return;
                    console.log(`[下载:Vercel] ${alistDownloadModal!.filePath}`);
                    logUserAction('下载 - vercel服务器中转下载', alistDownloadModal!.filePath);
                    let downloadUrl = `/api/alist-download?path=${encodeURIComponent(alistDownloadModal!.filePath)}`;
                    if (userToken) downloadUrl += `&token=${encodeURIComponent(userToken)}`;
                    const ccConfigStr = localStorage.getItem('ALIST_CUSTOM_CONFIG');
                    if (ccConfigStr) {
                      downloadUrl += `&c=${btoa(encodeURIComponent(ccConfigStr))}`;
                    }
                    window.open(downloadUrl, '_blank');
                    setAlistDownloadModal(null);
                  }}
                  disabled={globalDownloadModes?.vercel === 'disabled'}
                  className={`w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all ${globalDownloadModes?.vercel === 'disabled' ? 'bg-[#1a1a1a] border-zinc-800 opacity-60 cursor-not-allowed' : 'border-zinc-700 bg-black/40 hover:border-pink-500/50'}`}
                  style={globalDownloadModes?.vercel !== 'disabled' ? { border: '1px solid var(--border-color)', color: 'var(--text-primary)' } : {}}
                >
                  <div>
                    <div className={`text-[11px] font-bold ${globalDownloadModes?.vercel === 'disabled' ? 'text-zinc-500' : 'text-pink-400'}`}>
                      vercel 服务器中转下载 {globalDownloadModes?.vercel === 'disabled' ? '(已被系统禁用)' : '(备用)'}
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>备用方案消耗服务器流量，仅在失效时使用</div>
                  </div>
                </button>
              )}

              {/* ⚡ 302 直链 (方法4) */}
              {globalDownloadModes?.direct302 !== 'hidden' && (
                <button
                  onClick={() => {
                    if (globalDownloadModes?.direct302 === 'disabled') return;
                    console.log(`[下载:Direct302] ${alistDownloadModal!.filePath}`);
                    logUserAction('下载 - 302 直链跳转', alistDownloadModal!.filePath);
                    // 同步构造直链 URL（sign 已在模态框数据中，无需异步获取）
                    const sign = alistDownloadModal!.sign;
                    const directUrl = sign
                      ? `${getAlistBase()}/p${alistDownloadModal!.filePath}?sign=${sign}`
                      : `${getAlistBase()}/p${alistDownloadModal!.filePath}`;
                    window.open(directUrl, '_blank');
                    setAlistMsg('🚀 已启动直链下载');
                    setAlistDownloadModal(null);
                  }}
                  disabled={globalDownloadModes?.direct302 === 'disabled'}
                  className={`w-full flex items-center justify-between rounded-xl px-4 py-3 text-left transition-all duration-300 border shadow-sm ${globalDownloadModes?.direct302 === 'disabled' ? 'opacity-50 cursor-not-allowed grayscale' : 'hover:scale-[1.02] active:scale-[0.98] group'}`}
                  style={globalDownloadModes?.direct302 !== 'disabled' ? { background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.1) 0%, rgba(8, 145, 178, 0.05) 100%)', borderColor: 'rgba(6, 182, 212, 0.3)' } : {}}
                >
                  <div>
                    <div className="text-[12px] font-bold text-cyan-200 group-hover:text-cyan-100 transition-colors flex items-center gap-2">
                      <span>⚡️ 直链下载{globalDownloadModes?.direct302 === 'disabled' && '(已禁用)'}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500">直连网盘服务器，不消耗中转流量，兼容移动端</div>
                  </div>
                  <div className="text-cyan-500/30 group-hover:text-cyan-400 transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 复制直链弹窗 */}
      {alistCopyLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setAlistCopyLinkModal(null)}>
          <div className="w-full max-w-lg glass-strong rounded-2xl p-5 mx-4 shadow-2xl animate-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-emerald-400">直链已生成</div>
                <div className="text-xs font-mono truncate max-w-[360px] mt-1" style={{ color: 'var(--text-primary)' }}>{alistCopyLinkModal.fileName}</div>
              </div>
              <button onClick={() => setAlistCopyLinkModal(null)} className="hover:opacity-100 opacity-60 text-lg transition-opacity">✕</button>
            </div>
            <div className="relative">
              <textarea
                readOnly
                value={alistCopyLinkModal.url}
                className="w-full rounded-lg px-3 py-2.5 text-xs font-mono break-all resize-none outline-none select-all"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', minHeight: '80px' }}
                onFocus={(e) => { e.target.select(); }}
                onClick={(e) => { (e.target as HTMLTextAreaElement).select(); }}
              />
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(alistCopyLinkModal.url).then(() => {
                    setAlistMsg('✅ 直链已复制到剪贴板');
                  }).catch(() => {
                    setAlistMsg('⚠️ 复制失败，请手动选中上方链接复制');
                  });
                }}
                className="flex-1 rounded-lg px-4 py-2.5 text-xs font-bold transition-all hover:opacity-90 text-white"
                style={{ background: 'var(--accent)' }}
              >
                📋 复制链接
              </button>
              <button
                onClick={() => setAlistCopyLinkModal(null)}
                className="rounded-lg px-4 py-2.5 text-xs font-bold transition-all"
                style={{ border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
              >
                关闭
              </button>
            </div>
            <div className="text-[10px] mt-2 text-center" style={{ color: 'var(--text-muted)' }}>
              如自动复制失败，请手动选中上方链接后 Ctrl+C 复制
            </div>
          </div>
        </div>
      )}

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-4xl mx-auto animate-in">

          {/* 告示板 */}
          {globalAnnouncement && (
            <div className="mb-6 p-5 rounded-2xl border-2 border-blue-200 bg-blue-50 shadow-[0_8px_30px_rgb(0,0,0,0.12)] relative overflow-hidden">
              {/* 背景装饰 */}
              <div className="absolute top-0 right-0 w-48 h-48 bg-blue-200/50 rounded-full -mr-24 -mt-24 blur-3xl"></div>
              
              <div className="flex items-center gap-2 mb-3 relative z-10">
                <span className="flex items-center justify-center w-6 h-6 bg-blue-500 rounded-full text-[12px] shadow-lg shadow-blue-200 text-white">📢</span>
                <span className="text-[12px] font-black text-blue-800 uppercase tracking-[0.2em]">公告</span>
              </div>
              
              <div className="text-[14px] text-zinc-800 font-medium whitespace-pre-wrap leading-relaxed px-1 relative z-10 drop-shadow-sm">
                {globalAnnouncement}
              </div>
            </div>
          )}

          {/* 文件浏览器卡片 */}
          <div className="glass rounded-2xl overflow-hidden relative"
            onDragOver={(e) => { e.preventDefault(); if (canUpload && (currentPathPerms ? currentPathPerms.upload : true)) setIsDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
            onDrop={async (e) => {
              e.preventDefault();
              setIsDragging(false);
              if (!canUpload || (currentPathPerms && !currentPathPerms.upload)) {
                setAlistMsg("❌ 您没有上传权限");
                return;
              }
              const items = e.dataTransfer.items;
              const files: File[] = [];

              const readAllEntries = async (dirReader: any): Promise<any[]> => {
                let entries: any[] = [];
                const readChunk = () => new Promise<any[]>((resolve, reject) => {
                   dirReader.readEntries(resolve, reject);
                });
                let chunk;
                do {
                   chunk = await readChunk();
                   entries = entries.concat(chunk);
                } while (chunk.length > 0);
                return entries;
              };

              const getFileFromEntry = async (entry: any, path = '') => {
                if (entry.isFile) {
                  const file = await new Promise<File>((resolve) => entry.file(resolve));
                  Object.defineProperty(file, 'customPath', { value: path + file.name });
                  files.push(file);
                } else if (entry.isDirectory) {
                  const dirReader = entry.createReader();
                  const entries = await readAllEntries(dirReader);
                  for (const subEntry of entries) {
                    await getFileFromEntry(subEntry, path + entry.name + '/');
                  }
                }
              };

              if (items) {
                for (let i = 0; i < items.length; i++) {
                  const item = items[i];
                  if (item.kind === 'file') {
                    const entry = item.webkitGetAsEntry();
                    if (entry) {
                      await getFileFromEntry(entry, '');
                    }
                  }
                }
              } else if (e.dataTransfer.files) {
                for (let i = 0; i < e.dataTransfer.files.length; i++) {
                  files.push(e.dataTransfer.files[i]);
                }
              }

              if (files.length > 0) {
                setAlistUploadFiles(prev => [...prev, ...files]);
              }
            }}
          >
            {isDragging && canUpload && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm border-2 border-dashed border-pink-500 rounded-2xl pointer-events-none">
                <div className="text-white text-xl font-bold flex flex-col items-center gap-2">
                  <span className="text-5xl shadow-pink-500/50 drop-shadow-2xl">📥</span>
                  <span>松开鼠标添加至上传队列</span>
                </div>
              </div>
            )}

            {/* 头部工具栏 */}
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
              <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
                <span className="text-[10px] font-black tracking-widest uppercase italic" style={{ color: 'var(--text-muted)' }}>Cloud_Drive</span>
                <span className="text-[10px] hidden sm:inline" style={{ color: 'var(--text-faint)' }}>· AList</span>
              </div>
              <div className="flex items-center gap-2">
                {canSearch && (
                  <>
                    <span className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>搜索</span>
                    <input
                      value={alistSearchKeyword}
                      onChange={e => setAlistSearchKeyword(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && alistSearchFast()}
                      placeholder="文件名 / 后缀"
                      className="w-36 md:w-48 rounded px-2 py-1 text-[10px] outline-none"
                      style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    />
                    <button
                      onClick={alistSearchFast}
                      disabled={alistSearchLoading}
                      className="text-[10px] px-2 py-1 rounded font-bold text-white disabled:opacity-50"
                      style={{ background: 'var(--accent)' }}
                      title="搜索文件"
                    >
                      {alistSearchLoading ? '搜索中' : '搜索'}
                    </button>
                    {alistSearchActive && (
                      <button
                        onClick={clearAlistSearch}
                        className="text-[10px] px-2 py-1 rounded transition-opacity hover:opacity-80"
                        style={{ color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}
                        title="清除搜索"
                      >
                        清除
                      </button>
                    )}
                  </>
                )}
                {canUpload && (currentPathPerms ? currentPathPerms.upload : true) && (
                  <>
                    <button onClick={() => setAlistShowMkdir(!alistShowMkdir)}
                      className="text-[10px] px-2 py-1 rounded transition-opacity hover:opacity-80" style={{ color: 'var(--text-muted)', border: '1px solid var(--border-color)' }} title="新建文件夹">
                      + 文件夹
                    </button>
                    <label className="text-[10px] px-2 py-1 rounded cursor-pointer transition-opacity hover:opacity-80" style={{ color: 'var(--text-muted)', border: '1px solid var(--border-color)' }} title="上传文件 (多选)">
                      {alistUploading ? '上传中...' : '↑ 文件'}
                      <input type="file" multiple className="hidden" onChange={e => { const f = Array.from(e.target.files || []); if (f.length) setAlistUploadFiles(prev => [...prev, ...f]); e.target.value = ''; }} />
                    </label>
                    <label className="text-[10px] px-2 py-1 rounded cursor-pointer transition-opacity hover:opacity-80" style={{ color: 'var(--text-muted)', border: '1px solid var(--border-color)' }} title="上传整个文件夹">
                      {alistUploading ? '上传中...' : '↑ 目录'}
                      <input type="file" {...{ webkitdirectory: "", directory: "" } as any} multiple className="hidden" onChange={e => { const f = Array.from(e.target.files || []); if (f.length) setAlistUploadFiles(prev => [...prev, ...f]); e.target.value = ''; }} />
                    </label>
                  </>
                )}
                <button onClick={() => alistListDir(alistPath)} className="hover:opacity-100 opacity-60 transition-opacity" title="刷新">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
            </div>

            {/* 面包屑导航 */}
            <div className="flex items-center gap-1 px-4 py-2 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {alistPath.split('/').filter(Boolean).length === 0 ? (
                <span className="text-[11px] font-mono font-bold text-accent">/ Root</span>
              ) : (
                ['', ...alistPath.split('/').filter(Boolean)].map((seg, idx, arr) => {
                  const crumbPath = '/' + arr.slice(1, idx + 1).join('/');
                  return (
                    <span key={idx} className="flex items-center gap-1">
                      {idx > 0 && <span style={{ color: 'var(--text-faint)' }}>/</span>}
                      <button
                        onClick={() => alistListDir(idx === 0 ? '/' : crumbPath)}
                        className={`text-[11px] font-mono transition-colors whitespace-nowrap ${idx === arr.length - 1 ? 'font-bold text-accent' : ''}`}
                        style={{ color: idx === arr.length - 1 ? 'var(--accent)' : 'var(--text-muted)' }}
                      >
                        {idx === 0 ? 'Root' : seg}
                      </button>
                    </span>
                  );
                })
              )}
            </div>

            {/* 新建文件夹 */}
            {alistShowMkdir && canUpload && (
              <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
                <input value={alistMkdirName} onChange={e => setAlistMkdirName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && alistMkdir()}
                  placeholder="新建文件夹名称..." autoFocus
                  className="flex-1 rounded px-2 py-1 text-[11px] outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                <button onClick={alistMkdir} className="px-2 py-1 text-[10px] bg-accent text-white rounded font-bold hover:opacity-80">创建</button>
                <button onClick={() => { setAlistShowMkdir(false); setAlistMkdirName(''); }} className="px-2 py-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>取消</button>
              </div>
            )}

            {/* 待上传确认 + 进度条 */}
            {alistUploadFiles.length > 0 && canUpload && (
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold" style={{ color: 'var(--text-primary)' }}>
                      📎 待上传 {alistUploadFiles.length} 个文件/文件夹
                      <span className="text-[9px] opacity-60 font-normal ml-2">
                        ({(alistUploadFiles.reduce((acc, f) => acc + f.size, 0) / 1024 / 1024).toFixed(1)} MB)
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      <button onClick={alistUpload} disabled={alistUploading} className="px-3 py-1.5 text-[10px] bg-accent text-white rounded-lg font-bold hover:opacity-80 disabled:opacity-50 transition-all shadow-md active:scale-95">
                        {alistUploading ? '上传中...' : '确认上传全部'}
                      </button>
                      {!alistUploading && <button onClick={() => setAlistUploadFiles([])} className="px-3 py-1.5 text-[10px] rounded-lg transition-all border" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-subtle)', background: 'var(--bg-input)' }}>清空队列</button>}
                    </div>
                  </div>
                  {alistUploading && uploadProgress !== null && (
                    <div className="w-full">
                      <div className="flex justify-between text-[9px] mb-1.5 font-mono">
                        <span style={{ color: 'var(--text-muted)' }} className="truncate max-w-[80%]">{uploadProgressMsg || '上传中...'}</span>
                        <span className="text-accent font-bold">{uploadProgress}%</span>
                      </div>
                      <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: 'var(--bg-input)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${uploadProgress}%`, background: 'linear-gradient(90deg, var(--accent), #f97316)' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 消息提示 */}
            <div className="hidden px-4 py-3 space-y-2" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
              <div className="flex flex-col md:flex-row gap-2">
                <input
                  value={alistSearchKeyword}
                  onChange={e => setAlistSearchKeyword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && alistSearchFast()}
                  placeholder="搜索当前目录中的文件，可输入文件名或后缀，如 text、text.txt、.txt"
                  className="flex-1 rounded-lg px-3 py-2 text-[11px] outline-none"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                />
                <select
                  value={alistSearchScope}
                  onChange={e => setAlistSearchScope(Number(e.target.value) as 0 | 1)}
                  className="rounded-lg px-3 py-2 text-[11px] outline-none"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                >
                  <option value={0}>仅当前目录</option>
                  <option value={1}>包含子目录</option>
                </select>
                <button
                  onClick={alistSearchFast}
                  disabled={alistSearchLoading}
                  className="px-3 py-2 rounded-lg text-[11px] font-bold text-white disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}
                >
                  {alistSearchLoading ? '搜索中...' : '搜索'}
                </button>
                {alistSearchActive && (
                  <button
                    onClick={clearAlistSearch}
                    className="px-3 py-2 rounded-lg text-[11px] font-bold"
                    style={{ color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}
                  >
                    清除
                  </button>
                )}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                “包含子目录”表示会连当前目录下面的所有子文件夹一起递归搜索。
              </div>
            </div>

            {(alistMsg || isCompressing) && (
              <div>
                <div className={`px-4 py-1.5 text-[11px] font-bold flex items-center gap-2 transition-all ${
                  isCompressing
                    ? 'bg-blue-500/10 text-blue-400'
                    : alistMsg?.startsWith('✅')
                    ? 'bg-green-500/10 text-green-400'
                    : alistMsg?.startsWith('❌')
                    ? 'bg-red-500/10 text-red-400'
                    : alistMsg?.startsWith('⚠️')
                    ? 'bg-yellow-500/10 text-yellow-400'
                    : alistMsg?.startsWith('✨')
                    ? 'bg-yellow-500/10 text-yellow-400'
                    : 'bg-yellow-500/10 text-yellow-400'
                }`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {isCompressing && <span className="loading loading-spinner loading-xs"></span>}
                  <span className="flex-1">{isCompressing ? '🔄 正在生成压缩包...' : alistMsg}</span>
                  {!isCompressing && (
                    <button onClick={() => { if (msgTimerRef.current) clearTimeout(msgTimerRef.current); setAlistMsg(null); }}
                      className="shrink-0 opacity-50 hover:opacity-100 transition-opacity text-sm">✕</button>
                  )}
                </div>
              </div>
            )}


            {/* 文件列表 */}
            <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
              {alistLoading ? (
                <div className="space-y-1 p-4">
                  {[...Array(6)].map((_, i) => <div key={i} className="h-9 skeleton rounded" />)}
                </div>
              ) : alistError ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <span className="text-red-400 text-[11px]">{alistError}</span>
                  <button onClick={() => alistListDir(alistPath)} className="text-[10px] text-zinc-500 hover:text-pink-400 border border-zinc-700 px-2 py-1 rounded">重试</button>
                </div>
              ) : alistSearchActive ? (
                alistSearchResults.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <div>没有找到匹配的文件/文件夹</div>
                    <div style={{ color: 'var(--text-faint)' }}>
                      已搜索当前目录下的全部项目
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-800/50">
                    {alistSearchResults.map((item, idx) => {
                      const targetPath = item.path || (item.parent ? getChildPath(item.parent, item.name) : item.name);
                      const parentPath = item.parent || getParentPath(targetPath);
                      return (
                        <div
                          key={`${targetPath}-${idx}`}
                          className="w-full flex items-center gap-2 px-4 py-3 hover:bg-[var(--bg-card-hover)] transition-colors"
                        >
                          <button
                            onClick={() => openAlistItem(item, parentPath, item.provider || alistProvider)}
                            className="flex-1 min-w-0 flex items-center gap-3 text-left"
                          >
                            <span className="text-base shrink-0">{getFileIcon(item)}</span>
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-mono truncate" style={{ color: 'var(--text-primary)' }}>{item.name}</div>
                              <div className="text-[10px] truncate mt-1" style={{ color: 'var(--text-muted)' }}>{targetPath}</div>
                            </div>
                            {!item.is_dir && (
                              <span className="text-[10px] shrink-0 font-bold" style={{ color: 'var(--text-secondary)' }}>
                                {formatSize(item.size || 0)}
                              </span>
                            )}
                            <span className="text-[10px] shrink-0" style={{ color: 'var(--text-faint)' }}>
                              {item.is_dir ? '目录' : '文件'}
                            </span>
                          </button>
                          {!item.is_dir && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                clearAlistSearch();
                                alistListDir(parentPath);
                              }}
                              className="shrink-0 px-2 py-1 rounded text-[10px] font-bold transition-opacity hover:opacity-80"
                              style={{ color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}
                              title="转到目录"
                            >
                              转到目录
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              ) : alistFiles.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-zinc-600 text-xs">📭 空目录</div>
              ) : (
                <div className="divide-y divide-zinc-800/50">
                  {/* 返回上级 */}
                  {alistPath !== '/' && (
                    <button
                      onClick={() => { const parent = alistPath.replace(/\/[^/]+\/?$/, '') || '/'; alistListDir(parent); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-card-hover)] transition-colors text-left"
                    >
                      <span className="text-base">⬆️</span>
                      <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>..</span>
                    </button>
                  )}

                  {alistFiles.map((file: any, idx: number) => {
                    const filePath = `${alistPath.replace(/\/+$/, '')}/${file.name}`;
                    return (
                      <div key={idx} className="flex items-center gap-2 px-4 py-2 hover:bg-[var(--bg-card-hover)] transition-colors group">
                        {/* 复选框 - 支持文件和文件夹 */}
                        <input type="checkbox" checked={alistSelected.has(file.name)} onChange={() => alistToggleSelect(file.name)}
                          className="w-3 h-3 accent-pink-500 shrink-0 cursor-pointer" title={file.is_dir ? '选择文件夹' : '选择文件'} />

                        {/* 图标 */}
                        <span className="text-base shrink-0">{getFileIcon(file)}</span>

                        {/* 重命名 */}
                        {alistRenaming === filePath ? (
                          <div className="flex-1 flex items-center gap-2">
                            <input value={alistNewName} onChange={e => setAlistNewName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') alistRename(filePath); if (e.key === 'Escape') setAlistRenaming(null); }}
                              className="flex-1 rounded px-2 py-0.5 text-[11px] outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} autoFocus />
                            <button onClick={() => alistRename(filePath)} className="text-[10px] font-bold hover:opacity-80 text-accent">✓</button>
                            <button onClick={() => setAlistRenaming(null)} className="text-[10px] hover:opacity-80" style={{ color: 'var(--text-muted)' }}>✕</button>
                          </div>
                        ) : (
                          <>
                            {/* 文件名 */}
                            <button onClick={() => alistNavigate(file)} style={{ color: 'var(--text-primary)' }}
                              className="flex-1 text-left text-[11px] font-mono hover:opacity-70 transition-opacity truncate">
                              {file.name}
                            </button>

                            {/* 文件大小 — 手机端也显示 */}
                            {!file.is_dir && (
                              <span className="text-[10px] shrink-0 font-bold" style={{ color: 'var(--text-secondary)' }}>
                                {formatSize(file.size || 0)}
                              </span>
                            )}

                            {/* 修改时间 */}
                            <span className="text-[10px] shrink-0 ml-2" style={{ color: 'var(--text-muted)' }}>
                              {file.modified ? new Date(file.modified).toLocaleDateString() : ''}
                            </span>

                            {/* 管理操作 */}
                            {(canRename || canDelete || canControlFile) && (
                              <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
                                {canControlFile && (
                                  <button
                                    onClick={() => openFilePermissionPanel(filePath, file.is_dir ? 'dir' : 'file')}
                                    className="text-zinc-600 hover:text-amber-400 transition-colors p-0.5"
                                    title="File permissions"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2h-1V9a5 5 0 10-10 0v2H6a2 2 0 00-2 2v6a2 2 0 002 2zm3-10V9a3 3 0 116 0v2H9z" /></svg>
                                  </button>
                                )}
                                {canRename && (file.perms ? file.perms.rename : true) && (
                                  <button onClick={() => { setAlistRenaming(filePath); setAlistNewName(file.name); }}
                                    className="text-zinc-600 hover:text-blue-400 transition-colors p-0.5" title="重命名">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                  </button>
                                )}
                                {canDelete && (file.perms ? file.perms.delete : true) && (
                                  <button onClick={() => alistRemove(file)}
                                    className="text-zinc-600 hover:text-red-500 transition-colors p-0.5" title="删除">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 底部状态栏 */}
            <div className="px-4 py-2 flex items-center justify-between text-[10px]" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-faint)' }}>
              <div className="flex items-center gap-3">
                <button onClick={alistSelectAll} className="hover:opacity-100 opacity-80 transition-opacity">
                  {alistSelected.size > 0 ? (
                    <>
                      ☑ {alistSelected.size} 个选中项
                      {Array.from(alistSelected).filter(name => alistFiles.find((f: any) => f.name === name)?.is_dir).length > 0 && (
                        <span style={{ color: 'var(--text-muted)' }}> (含 {Array.from(alistSelected).filter(name => alistFiles.find((f: any) => f.name === name)?.is_dir).length} 个文件夹)</span>
                      )}
                    </>
                  ) : (
                    `${alistFiles.length} 个项目`
                  )}
                </button>
                {alistSelected.size > 0 && (
                  <button onClick={alistBatchDownload} className="text-[10px] font-bold flex items-center gap-1 text-accent">
                    ↓ 批量下载
                  </button>
                )}
              </div>
              {!adminSettings.hideAlistButton && (
                <button onClick={() => window.open(getAlistBase(), '_blank')} className="hover:opacity-100 opacity-80 transition-opacity">
                  在 AList 中打开 ↗
                </button>
              )}
            </div>

          </div>
        </div>
      </main>

      {showFilePermPanel && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setShowFilePermPanel(false)}>
          <div className="w-full max-w-4xl glass-strong rounded-2xl p-5 max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>文件控制权限</div>
                <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>可针对单个文件或整个文件夹，为指定用户限制打开、下载、预览、上传、重命名、删除或搜索。</div>
              </div>
              <button onClick={() => setShowFilePermPanel(false)} className="text-lg opacity-60 hover:opacity-100">✕</button>
            </div>

            {filePermMsg && (
              <div className="mb-4 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
                {filePermMsg}
              </div>
            )}

            <div className="grid lg:grid-cols-[1fr_1.2fr] gap-4">
              <div className="rounded-xl p-4 min-w-0" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                <div className="text-[11px] font-bold mb-3" style={{ color: 'var(--text-primary)' }}>规则编辑</div>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      value={filePermDraft.path}
                      onChange={e => { setFilePermDraft(prev => ({ ...prev, path: e.target.value })); setRegexPreview(null); }}
                      placeholder={filePermDraft.pathType === 'regex' ? '例如: 密码|密钥|secret' : '/文件夹/文件'}
                      className="flex-1 rounded px-3 py-2 text-[11px] outline-none"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    />
                    {filePermDraft.pathType === 'regex' && (
                      <button
                        type="button"
                        onClick={async () => {
                          const pattern = filePermDraft.path.trim();
                          if (!pattern) { setFilePermMsg('请先输入匹配表达式'); return; }
                          try { new RegExp(pattern); } catch { setFilePermMsg('正则表达式语法错误，请检查'); return; }
                          setRegexPreview({ loading: true, total: 0, files: [], truncated: false });
                          setFilePermMsg(null);
                          try {
                            const res = await fetch('/api/file-permissions', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
                              body: JSON.stringify({
                                action: 'preview',
                                pattern,
                                scopePath: '/',
                                regexScope: filePermDraft.regexScope || 'path',
                              }),
                            });
                            const data = await res.json();
                            if (!res.ok) { setRegexPreview({ loading: false, total: 0, files: [], truncated: false, error: data.error || '预览失败' }); return; }
                            setRegexPreview({ loading: false, total: data.total, files: data.files, truncated: data.truncated, debug: data.debug });
                          } catch { setRegexPreview({ loading: false, total: 0, files: [], truncated: false, error: '预览接口异常' }); }
                        }}
                        disabled={regexPreview?.loading}
                        className="shrink-0 rounded px-3 py-2 text-[11px] font-bold transition-all hover:opacity-90 text-white disabled:opacity-50"
                        style={{ background: 'var(--accent)' }}
                      >
                        {regexPreview?.loading ? '⏳ 搜索中...' : '🔍 预览匹配'}
                      </button>
                    )}
                  </div>
                  {filePermDraft.pathType === 'regex' && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>匹配范围：</span>
                      <select
                        value={filePermDraft.regexScope || 'path'}
                        onChange={e => { setFilePermDraft(prev => ({ ...prev, regexScope: e.target.value as 'name' | 'path' })); setRegexPreview(null); }}
                        className="rounded px-2 py-1 text-[10px] outline-none"
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                      >
                        <option value="path">完整路径</option>
                        <option value="name">仅文件名</option>
                      </select>
                    </div>
                  )}
                  {/* 预览结果 */}
                  {regexPreview && !regexPreview.loading && (
                    <div className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                      {regexPreview.error ? (
                        <div className="text-[11px] text-red-400">{regexPreview.error}</div>
                      ) : (
                        <>
                          <div className="text-[11px] font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                            📊 匹配到 <span style={{ color: 'var(--accent)' }}>{regexPreview.total}</span> 个文件/文件夹
                            {regexPreview.truncated && <span className="text-[10px] text-orange-400 ml-1">（仅显示前 2000 条，请细化表达式）</span>}
                          </div>
                          {regexPreview.debug && (
                            <div className="text-[10px] mb-2 flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: 'var(--text-faint)' }}>
                              <span>🔍 搜索候选 {regexPreview.debug.alistTotal} 条</span>
                              {(regexPreview.debug.listedDirs || 0) > 0 && <span>📂 深入 {regexPreview.debug.listedDirs} 个目录</span>}
                              <span>✅ 匹配 {regexPreview.total} 条</span>
                              <span>⏱ {regexPreview.debug.elapsedMs}ms</span>
                            </div>
                          )}
                          {regexPreview.files.length > 0 && (
                            <div className="max-h-[200px] overflow-y-auto overflow-x-hidden space-y-1 custom-scrollbar">
                              {regexPreview.files.map((f, i) => (
                                <div key={i} className="text-[10px] font-mono flex items-center gap-1 min-w-0" style={{ color: 'var(--text-muted)' }}>
                                  <span className="shrink-0">{f.is_dir ? '📁' : '📄'}</span>
                                  <span className="truncate min-w-0" title={f.path}>{f.path}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {regexPreview.files.length === 0 && (
                            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>未找到匹配项，请尝试其他表达式</div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  <div className="grid md:grid-cols-2 gap-3">
                    <select
                      value={filePermDraft.pathType}
                      onChange={e => setFilePermDraft(prev => {
                        const nextType = e.target.value as 'file' | 'dir' | 'regex';
                        const nextDeny = nextType === 'file'
                          ? Object.fromEntries(Object.entries(prev.deny).filter(([key, value]) => key !== 'upload' && value)) as Partial<Record<FilePermissionAction, boolean>>
                          : prev.deny;
                        return { ...prev, pathType: nextType, deny: nextDeny, regexScope: (prev.regexScope || 'path') as 'name' | 'path' };
                      })}
                      disabled={filePermTypeLocked}
                      className="rounded px-3 py-2 text-[11px] outline-none"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    >
                      <option value="file">单独文件</option>
                      <option value="dir">文件夹及子目录</option>
                      <option value="regex">正则表达式匹配</option>
                    </select>
                    <input
                      value={filePermDraft.groupName || ''}
                      onChange={e => setFilePermDraft(prev => ({ ...prev, groupName: e.target.value }))}
                      placeholder="分组名（可选）"
                      className="rounded px-3 py-2 text-[11px] outline-none"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div>
                    <div className="text-[10px] mb-2" style={{ color: 'var(--text-muted)' }}>适用用户</div>
                    <div className="flex flex-wrap gap-2">
                      {filePermUsers.map(userItem => {
                        const active = filePermDraft.users.includes(userItem.username);
                        return (
                          <button
                            key={userItem.username}
                            type="button"
                            onClick={() => setFilePermDraft(prev => ({
                              ...prev,
                              users: active
                                ? prev.users.filter(name => name !== userItem.username)
                                : [...prev.users, userItem.username]
                            }))}
                            className="px-2.5 py-1 rounded-full text-[10px] font-bold transition-opacity hover:opacity-80"
                            style={{
                              background: active ? 'var(--accent)' : 'var(--bg-card)',
                              color: active ? '#fff' : 'var(--text-muted)',
                              border: '1px solid var(--border-color)'
                            }}
                          >
                            {userItem.username} {userItem.role === 'admin' ? '(超级管理员)' : userItem.role === 'manager' ? '(管理员)' : '(guest)'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] mb-2" style={{ color: 'var(--text-muted)' }}>禁止操作</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {[
                        ['view', '打开'],
                        ['download', '下载'],
                        ['preview', '预览'],
                        ...(filePermDraft.pathType !== 'file' ? [['upload', '上传']] as const : []),
                        ['rename', '重命名'],
                        ['delete', '删除'],
                        ['search', '搜索'],
                      ].map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          <input
                            type="checkbox"
                            checked={Boolean(filePermDraft.deny[key as FilePermissionAction])}
                            onChange={e => setFilePermDraft(prev => ({
                              ...prev,
                              deny: { ...prev.deny, [key]: e.target.checked }
                            }))}
                            className="w-3 h-3 accent-pink-500"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={submitFilePermissionDraft} className="px-4 py-2 rounded-lg text-[11px] font-bold text-white" style={{ background: 'var(--accent)' }}>
                      保存规则
                    </button>
                    <button onClick={() => { setFilePermTypeLocked(false); setFilePermDraft(createDefaultFileRule(alistPath, 'dir')); }} className="px-4 py-2 rounded-lg text-[11px] font-bold" style={{ color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
                      新建规则
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-xl p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] font-bold" style={{ color: 'var(--text-primary)' }}>已有规则</div>
                  <button onClick={fetchFilePermissionsData} className="text-[10px]" style={{ color: 'var(--accent)' }}>刷新</button>
                </div>
                <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                  {filePermRules.length === 0 && (
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>当前还没有路径级规则。</div>
                  )}
                  {filePermRules.map(rule => (
                    <div key={rule.id} className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-mono break-all" style={{ color: 'var(--text-primary)' }}>{rule.path}</div>
                          <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                            {rule.pathType === 'dir' ? '文件夹及子目录' : rule.pathType === 'regex' ? `正则表达式匹配 · ${rule.regexScope === 'name' ? '仅文件名' : '完整路径'}` : '单独文件'}
                            {rule.groupName ? ` · 分组 ${rule.groupName}` : ' · 单项规则'}
                          </div>
                          <div className="text-[10px] mt-1" style={{ color: 'var(--text-faint)' }}>
                            用户: {rule.users.join(', ')}
                          </div>
                          <div className="text-[10px] mt-1" style={{ color: 'var(--text-faint)' }}>
                            禁止: {Object.keys(rule.deny || {}).filter(key => rule.deny[key as FilePermissionAction]).join(', ') || '无'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => { setFilePermTypeLocked(false); setFilePermDraft(rule); }}
                            className="text-[10px] px-2 py-1 rounded"
                            style={{ color: 'var(--accent)', border: '1px solid var(--border-color)' }}
                          >
                            编辑
                          </button>
                          <button
                            onClick={async () => {
                              const ok = await saveFilePermissionRules(filePermRules.filter(item => item.id !== rule.id));
                              if (ok) {
                                logUserAction('文件权限 - 删除规则', `[${rule.pathType}] ${rule.path}`);
                                if (filePermDraft.id === rule.id) {
                                  setFilePermTypeLocked(false);
                                  setFilePermDraft(createDefaultFileRule(alistPath, 'dir'));
                                }
                              }
                            }}
                            className="text-[10px] px-2 py-1 rounded"
                            style={{ color: '#ef4444', border: '1px solid var(--border-color)' }}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 文件夹删除二次确认弹窗 */}
      {alistDeleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-md" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setAlistDeleteConfirm(null)}>
          <div className="w-full max-w-sm glass-strong rounded-2xl p-6 shadow-2xl animate-in border border-red-500/20" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center text-2xl mx-auto mb-3">⚠️</div>
              <h3 className="text-sm font-bold text-white">确认要删除文件夹吗？</h3>
              <p className="text-[11px] text-zinc-400 mt-2 leading-relaxed">
                删除文件夹 <span className="text-red-400 font-mono font-bold">"{alistDeleteConfirm.name}"</span> 将导致其中所有内容被彻底抹除且<span className="text-white font-bold">无法找回</span>。
              </p>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">请输入以下内容以确认：</label>
                <div className="bg-black/40 border border-white/10 rounded-lg p-2 text-center select-none text-[11px] font-mono text-zinc-300">
                  我确认要删除 {alistDeleteConfirm.name}
                </div>
                <input
                  value={alistDeleteInput}
                  onChange={e => setAlistDeleteInput(e.target.value)}
                  placeholder="在此输入上述文字"
                  className="w-full rounded-lg px-3 py-2 text-xs outline-none transition-all focus:ring-1 focus:ring-red-500/50"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  autoFocus
                />
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setAlistDeleteConfirm(null)}
                  className="flex-1 py-2 rounded-lg text-xs font-bold transition-opacity hover:opacity-100 opacity-60"
                  style={{ color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}
                >
                  取消
                </button>
                <button
                  disabled={alistDeleteInput !== `我确认要删除 ${alistDeleteConfirm.name}`}
                  onClick={() => executeRemove(alistDeleteConfirm.name)}
                  className="flex-1 py-2 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  确认删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 底部版权 */}
      <footer className="text-center py-4 text-[9px]" style={{ color: 'var(--text-faint)' }}>
        <div className="flex items-center justify-center gap-2 mb-2 text-[10px]">
          <span className="font-mono text-pink-500 font-bold">v{CHANGELOG_DATA[0].version}</span>
          <span className="opacity-30">|</span>
          <span style={{ color: 'var(--text-muted)' }}>更新时间: {CHANGELOG_DATA[0].date.split(' ')[0]}</span>
          <span className="opacity-30">|</span>
          <button onClick={() => setShowChangelog(true)} className="hover:text-pink-400 transition-colors underline decoration-dotted underline-offset-2">
            👀 更新日志
          </button>
        </div>
        <div>© {new Date().getFullYear()} 成都七中科学技术协会 (STA)</div>
        <div className="mt-1 opacity-80">本网站由25级网络部搭建运营。</div>
      </footer>
    </div>
  );
}
