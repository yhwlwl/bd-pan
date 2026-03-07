"use client";
import { useState, useEffect } from 'react';
import CHANGELOG_DATA from '@/data/changelog.json';

const ALIST_BASE_DEFAULT = (process.env.NEXT_PUBLIC_ALIST_URL || 'https://frp-gap.com:37492').replace(/\/+$/, '');
const SIZE_THRESHOLD = 20 * 1024 * 1024; // 20MB

type Role = 'admin' | 'manager' | 'guest';
type Theme = 'light' | 'dark';

export interface UserPermissions {
  view: boolean;
  download: boolean;
  upload: boolean;
  delete: boolean;
  rename: boolean;
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
  const [alistSelected, setAlistSelected] = useState<Set<string>>(new Set());
  const [alistProvider, setAlistProvider] = useState<string>('');

  // 文件操作
  const [alistShowMkdir, setAlistShowMkdir] = useState(false);
  const [alistMkdirName, setAlistMkdirName] = useState('');
  const [alistUploadFile, setAlistUploadFile] = useState<File | null>(null);
  const [alistUploading, setAlistUploading] = useState(false);
  const [alistRenaming, setAlistRenaming] = useState<string | null>(null);
  const [alistNewName, setAlistNewName] = useState('');
  const [alistDownloadModal, setAlistDownloadModal] = useState<{ name: string; filePath: string; sign?: string } | null>(null);

  // 更新日志弹窗
  const [showChangelog, setShowChangelog] = useState(false);
  // 使用手册弹窗
  const [showManual, setShowManual] = useState(false);

  // 管理面板
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminUsers, setAdminUsers] = useState<{ username: string; role: Role; permissions: UserPermissions }[]>([]);
  const [adminSettings, setAdminSettings] = useState<{ enableGuestMode: boolean; permissions?: Record<string, UserPermissions> }>({ enableGuestMode: true, permissions: {} });
  const [newUserName, setNewUserName] = useState('');
  const [newUserPass, setNewUserPass] = useState('');
  const [newUserRole, setNewUserRole] = useState<'manager' | 'guest'>('manager');
  const [adminMsg, setAdminMsg] = useState<string | null>(null);

  // === 远端 AList 设置（仅本地生效） ===
  const [showSettings, setShowSettings] = useState(false);
  const [customUrl, setCustomUrl] = useState('');
  const [customUser, setCustomUser] = useState('');
  const [customPass, setCustomPass] = useState('');

  const isAdmin = userRole === 'admin';
  const canDownload = userPerms ? userPerms.download : false;
  const canUpload = userPerms ? userPerms.upload : false;
  const canDelete = userPerms ? userPerms.delete : false;
  const canRename = userPerms ? userPerms.rename : false;
  const canView = userPerms ? userPerms.view : false;

  const getCustomConfig = () => {
    if (typeof window !== 'undefined') {
      try {
        const str = localStorage.getItem('ALIST_CUSTOM_CONFIG');
        if (str) return JSON.parse(str);
      } catch (e) { }
    }
    return null;
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
            body: JSON.stringify({ time: new Date().toISOString(), device: navigator.userAgent, source: 'pan' })
          }).catch(() => { });
        });
    }
  }, []);

  // Token 存在时自动加载目录
  useEffect(() => {
    if (userToken) {
      alistListDir('/');
    }
  }, [userToken]);

  // 自动清除消息
  useEffect(() => {
    if (alistMsg) {
      const t = setTimeout(() => setAlistMsg(null), 3000);
      return () => clearTimeout(t);
    }
  }, [alistMsg]);

  // === 登录 ===
  const handleLogin = async () => {
    const uname = loginUsername.trim();
    const pwd = loginPassword.trim();
    if (!uname || !pwd) { setAuthError('请填写用户名和密码'); return; }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uname, password: pwd }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) { setAuthError(data.error || '登录失败'); return; }
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
    } catch { setAuthError('登录接口异常'); }
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
      if (!res.ok || !data.token) { setAuthError(data.error || '游客模式不可用'); return; }
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
    } catch { setAuthError('登录接口异常'); }
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
        setAlistSelected(new Set());
      } else {
        setAlistError(data.message || '加载失败');
        if (data.code === 401 || data.code === 403) setAlistFiles([]);
      }
    } catch { setAlistError('网盘接口异常'); }
    finally { setAlistLoading(false); }
  };

  // === 下载逻辑 ===
  const alistDirectDownload = (filePath: string, fileSign?: string) => {
    const url = fileSign ? `${getAlistBase()}/d${filePath}?sign=${fileSign}` : `${getAlistBase()}/d${filePath}`;
    window.open(url, '_blank');
  };

  const alistProxyDownload = (filePath: string, fileName: string) => {
    let downloadUrl = `/api/alist-download?path=${encodeURIComponent(filePath)}`;
    if (userToken) downloadUrl += `&token=${encodeURIComponent(userToken)}`;
    const ccConfigStr = localStorage.getItem('ALIST_CUSTOM_CONFIG');
    if (ccConfigStr) {
      downloadUrl += `&c=${btoa(encodeURIComponent(ccConfigStr))}`;
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
    }
    if (!item.is_dir && !canDownload) { setAlistMsg('❌ 无下载权限'); return; }

    if (item.is_dir) {
      const newPath = `${alistPath.replace(/\/+$/, '')}/${item.name}`;
      setAlistSelected(new Set());
      alistListDir(newPath);
    } else {
      const filePath = `${alistPath.replace(/\/+$/, '')}/${item.name}`;
      // Use directory-level provider from AList API (data.data.provider)
      const prov = alistProvider.toLowerCase();
      const isBaidu = prov.includes('baidu') || alistPath.startsWith('/百度网盘') || alistPath.startsWith('/baidu');
      const isAliyun = prov.includes('aliyun') || alistPath.startsWith('/阿里云盘') || alistPath.startsWith('/aliyun');
      
      if (isBaidu && (item.size || 0) >= SIZE_THRESHOLD) {
        setAlistDownloadModal({ name: item.name, filePath, sign: item.sign });
      } else if (isBaidu) {
        // 百度网盘小文件也走代理下载（需要 UA: pan.baidu.com）
        alistProxyDownload(filePath, item.name);
      } else if (isAliyun) {
        alistProxyDownload(filePath, item.name);
      } else {
        alistDirectDownload(filePath, item.sign);
      }
    }
  };

  const alistBatchDownload = () => {
    const prov = alistProvider.toLowerCase();
    const isBaidu = prov.includes('baidu') || alistPath.startsWith('/百度网盘') || alistPath.startsWith('/baidu');
    const isAliyun = prov.includes('aliyun') || alistPath.startsWith('/阿里云盘') || alistPath.startsWith('/aliyun');
    
    alistSelected.forEach(name => {
      const file = alistFiles.find((f: any) => f.name === name);
      const filePath = `${alistPath.replace(/\/+$/, '')}/${name}`;
      if (isBaidu || isAliyun) {
        // 百度和阿里云盘都走代理下载
        alistProxyDownload(filePath, name);
      } else {
        alistDirectDownload(filePath, file?.sign);
      }
    });
    setAlistSelected(new Set());
  };

  const alistToggleSelect = (name: string) => {
    setAlistSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const alistSelectAll = () => {
    const fileNames = alistFiles.filter((f: any) => !f.is_dir).map((f: any) => f.name);
    if (alistSelected.size === fileNames.length) setAlistSelected(new Set());
    else setAlistSelected(new Set(fileNames));
  };

  // === 文件管理操作 ===
  const alistMkdir = async () => {
    if (!alistMkdirName.trim()) return;
    setAlistMsg(null);
    try {
      const res = await fetchAlist({ action: 'mkdir', path: alistPath, dir_name: alistMkdirName.trim() });
      const data = await res.json();
      if (data.code === 200) { setAlistMsg('✅ 文件夹创建成功'); setAlistMkdirName(''); setAlistShowMkdir(false); alistListDir(alistPath); }
      else setAlistMsg(`❌ ${data.message}`);
    } catch { setAlistMsg('❌ 接口异常'); }
  };

  const alistRemove = async (name: string) => {
    if (!confirm(`确认删除 ${name} 吗？`)) return;
    setAlistMsg(null);
    try {
      const res = await fetchAlist({ action: 'remove', path: alistPath, names: [name] });
      const data = await res.json();
      if (data.code === 200) { setAlistMsg('✅ 删除成功'); alistListDir(alistPath); }
      else setAlistMsg(`❌ ${data.message}`);
    } catch { setAlistMsg('❌ 接口异常'); }
  };

  const alistRename = async (filePath: string) => {
    if (!alistNewName.trim()) return;
    setAlistMsg(null);
    try {
      const res = await fetchAlist({ action: 'rename', path: filePath, newName: alistNewName.trim() });
      const data = await res.json();
      if (data.code === 200) { setAlistMsg('✅ 重命名成功'); setAlistRenaming(null); setAlistNewName(''); alistListDir(alistPath); }
      else setAlistMsg(`❌ ${data.message}`);
    } catch { setAlistMsg('❌ 接口异常'); }
  };

  const alistUpload = async () => {
    if (!alistUploadFile || !userToken) return;
    setAlistUploading(true);
    setAlistMsg(null);
    try {
      const uploadPath = alistPath.replace(/\/+$/, '') + '/' + alistUploadFile.name;
      const encodedFilePath = uploadPath.split('/').map(encodeURIComponent).join('/');

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${userToken}`,
        'File-Path': encodedFilePath,
        'Content-Type': alistUploadFile.type || 'application/octet-stream',
        'Content-Length': String(alistUploadFile.size),
      };

      const cc = getCustomConfig();
      if (cc) {
        if (cc.url) headers['x-alist-url'] = cc.url;
        if (cc.user) headers['x-alist-username'] = cc.user;
        if (cc.pass) headers['x-alist-password'] = cc.pass;
      }

      const uploadRes = await fetch('/api/alist-upload', {
        method: 'PUT',
        headers,
        body: alistUploadFile,
      });

      const uploadData = await uploadRes.json();
      if (uploadData.code === 200) { setAlistMsg('✅ 上传成功'); setAlistUploadFile(null); alistListDir(alistPath); }
      else setAlistMsg(`❌ ${uploadData.message}`);
    } catch (e: any) { setAlistMsg(`❌ 上传失败: ${e.message}`); }
    finally { setAlistUploading(false); }
  };

  // === 管理面板操作 ===
  const fetchAdminData = async () => {
    if (!userToken || userRole !== 'admin') return;
    try {
      const res = await fetch('/api/users', {
        headers: { 'Authorization': `Bearer ${userToken}` },
      });
      const data = await res.json();
      if (data.users) setAdminUsers(data.users);
      if (data.settings) setAdminSettings(data.settings);
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
      if (data.settings) setAdminSettings(data.settings);
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
            <p className="text-[9px]" style={{ color: 'var(--text-faint)' }}>© 成都七中学生科技协会</p>
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
          {isAdmin && (
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
                <span className="text-lg">👑</span>
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>管理面板</h3>
              </div>
              <button onClick={() => setShowAdminPanel(false)} className="text-lg hover:opacity-100 opacity-60 transition-opacity">✕</button>
            </div>

            {adminMsg && (
              <div className={`mb-3 px-3 py-1.5 rounded text-[11px] font-bold ${adminMsg.startsWith('✅') ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                {adminMsg}
              </div>
            )}

            {/* 安全设置：超管密码 */}
            <div className="mb-5 rounded-xl p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
              <div className="text-[10px] uppercase font-bold tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>安全设置</div>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  placeholder="新超级管理员密码"
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
                  修改密码
                </button>
              </div>
            </div>

            {/* 全局设置 */}
            <div className="mb-5 rounded-xl p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
              <div className="text-[10px] uppercase font-bold tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>全局设置</div>
              <div className="flex items-center justify-between">
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>启用游客模式 · {adminSettings.enableGuestMode ? '已开启' : '已关闭'}</span>
                <button
                  onClick={() => adminAction('updateSettings', { settings: { enableGuestMode: !adminSettings.enableGuestMode } })}
                  className={`w-10 h-5 rounded-full transition-colors relative ${adminSettings.enableGuestMode ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all ${adminSettings.enableGuestMode ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>
            </div>

            {/* 用户列表 */}
            <div className="mb-5 rounded-xl p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
              <div className="text-[10px] uppercase font-bold tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>用户列表</div>
              <div className="space-y-2">
                {adminUsers.map((u) => (
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
                      <div className="pt-2 mt-1 border-t grid grid-cols-2 md:grid-cols-5 gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
                        {[
                          { key: 'view', label: '👀 浏览' },
                          { key: 'download', label: '⬇️ 下载' },
                          { key: 'upload', label: '⬆️ 上传' },
                          { key: 'delete', label: '🗑️ 删除' },
                          { key: 'rename', label: '📝 重命名' }
                        ].map(perm => {
                          const uPerms = u.permissions as any || {};
                          const isOn = uPerms[perm.key] === true;
                          const viewOff = perm.key !== 'view' && !uPerms.view;
                          return (
                            <label key={perm.key} className={`flex items-center gap-1.5 cursor-pointer ${viewOff ? 'opacity-30 pointer-events-none' : 'hover:opacity-80'}`}>
                              <input 
                                type="checkbox" 
                                checked={isOn}
                                disabled={viewOff}
                                onChange={(e) => {
                                  let newPerms = { ...uPerms, [perm.key]: e.target.checked };
                                  // 关闭浏览时，其他权限也全部关闭
                                  if (perm.key === 'view' && !e.target.checked) {
                                    newPerms = { view: false, download: false, upload: false, delete: false, rename: false };
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
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 添加用户 */}
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
                    placeholder="密码" className="flex-1 rounded px-2.5 py-2 text-[11px] outline-none" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="flex gap-2">
                  <select
                    value={newUserRole} onChange={e => setNewUserRole(e.target.value as 'manager' | 'guest')}
                    className="flex-1 rounded px-2.5 py-2 text-[11px] outline-none border-accent" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  >
                    <option value="manager">管理员（可上传/管理）</option>
                    <option value="guest">游客（仅浏览/下载）</option>
                  </select>
                  <button
                    onClick={() => {
                      if (!newUserName.trim() || !newUserPass.trim()) { setAdminMsg('❌ 用户名和密码不能为空'); return; }
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
                <input type="text" value={customUrl} onChange={e => setCustomUrl(e.target.value)} placeholder="如: https://frp-gap.com:37492" className="w-full rounded px-2.5 py-2 text-[11px] outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-md" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowManual(false)}>
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
              {/* 下载方式对比 */}
              <section className="space-y-3">
                <h4 className="text-[11px] font-black uppercase tracking-wider text-accent border-l-2 border-accent pl-2">1. 下载方式详细原理</h4>
                <div className="grid grid-cols-1 gap-3">
                  <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-bold text-blue-400">☁️ Cloudflare 边缘加速</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-zinc-400">
                      通过我们在海外部署的 CF Workers 节点中转请求。
                      <span className="block mt-1 text-white/80">✅ 推荐度：⭐⭐⭐⭐⭐ (普通同学首选)</span>
                      <span className="block text-zinc-500">优点：不消耗服务器流量，无需配置代理，兼容性好。</span>
                    </p>
                  </div>
                  
                  <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-bold text-emerald-400">🚀 复制直链 (搭配 IDM/迅雷)</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-zinc-400">
                      直接获取百度网盘 CDN 的原始链接。
                      <span className="block mt-1 text-white/80">✅ 推荐度：⭐⭐⭐⭐⭐ (有条件同学首选，极速)</span>
                      <span className="block text-zinc-500">优点：单线程可达 5MB/s，多线程（IDM）可刷满 50MB/s。</span>
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-pink-500/5 border border-pink-500/20">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-bold text-pink-400">🔥 服务器中转下载</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-zinc-400">
                      通过 STA 核心服务器代理下载并转发给你。
                      <span className="block mt-1 text-white/80">⚠️ 推荐度：⭐ (作为备用方案)</span>
                      <span className="block text-zinc-500">缺点：消耗服务器昂贵的出站流量（Vercel 额度有限），请大家尽量通过前两种方式下载。</span>
                    </p>
                  </div>
                </div>
              </section>

              {/* IDM 配置指南 */}
              <section className="space-y-3">
                <h4 className="text-[11px] font-black uppercase tracking-wider text-accent border-l-2 border-accent pl-2">2. IDM 满速配置教程 (极速 50MB/s)</h4>
                <div className="p-4 rounded-2xl bg-zinc-800/20 border border-white/5 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent shrink-0 mt-0.5">1</div>
                    <p className="text-[11px] text-zinc-400">下载并安装 <a href="https://www.internetdownloadmanager.com/" target="_blank" className="text-accent underline">IDM (Internet Download Manager)</a>。</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent shrink-0 mt-0.5">2</div>
                    <p className="text-[11px] text-zinc-400">
                      打开 IDM 菜单：<span className="text-white/80">选项 (Options) -&gt; 下载 (Downloads)</span>。
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent shrink-0 mt-0.5">3</div>
                    <div className="flex-1 space-y-2">
                       <p className="text-[11px] text-zinc-400">在最下方找到 <span className="text-white/80">“手动添加下载任务时使用的用户代理 (User-Agent)”</span>，填入：</p>
                       <code className="block p-2 rounded bg-black/40 border border-white/5 text-[11px] font-mono text-pink-400 select-all">pan.baidu.com</code>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent shrink-0 mt-0.5">4</div>
                    <p className="text-[11px] text-zinc-400">回到网盘，点击 <span className="text-emerald-400">复制直链</span>，并在 IDM 中 <span className="text-white/80">新建任务</span> 粘贴即可。</p>
                  </div>
                </div>
              </section>

              {/* 温馨提示 */}
              <div className="p-4 rounded-2xl bg-pink-500/5 border border-pink-500/10 text-center">
                <p className="text-[11px] text-zinc-400">
                  💖 每一份服务器流量都来之不易。<br/>
                  <span className="text-white/80 font-bold">推荐有条件的同学优先使用 IDM + 直链</span>，<br/>
                  让服务器把有限的带宽留给更需要的手机端同学。
                </p>
              </div>
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

      {/* 大文件下载方式选择弹窗 */}
      {alistDownloadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setAlistDownloadModal(null)}>
          <div className="w-full max-w-sm glass-strong rounded-2xl p-4 mx-4 glow-accent animate-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'var(--text-muted)' }}>大文件下载 ≥20MB</div>
                <div className="text-xs font-mono truncate max-w-[260px] mt-1" style={{ color: 'var(--text-primary)' }}>{alistDownloadModal.name}</div>
              </div>
              <button onClick={() => setAlistDownloadModal(null)} className="hover:opacity-100 opacity-60 text-lg transition-opacity">✕</button>
            </div>
            <div className="space-y-2">
              {/* Cloudflare Workers 边缘代理 (首选) */}
              <button
                onClick={() => {
                  setAlistMsg('⏳ 正在连接 cf.ryantan.fun 代理节点，请稍候...');
                  fetchAlist({ action: 'get', path: alistDownloadModal!.filePath })
                    .then(r => r.json())
                    .then(data => {
                      if (data.code === 200 && data.data?.raw_url) {
                        const cfUrl = `https://cf.ryantan.fun/?url=${encodeURIComponent(data.data.raw_url)}`;
                        setAlistMsg('✅ 获取直链成功，正在跳转下载...');
                        window.location.href = cfUrl;
                      } else {
                        setAlistMsg('❌ 获取直链失败，无法走 CF 代理');
                      }
                    }).catch(() => setAlistMsg('❌ 接口异常'));
                  setAlistDownloadModal(null);
                }}
                className="w-full flex items-center justify-between border rounded-lg px-3 py-2.5 text-left border-accent bg-accent-bg"
              >
                <div>
                  <div className="text-[11px] font-bold text-blue-400">🌟 Cloudflare 边缘加速 (强烈推荐)</div>
                  <div className="text-[10px] text-zinc-500">通过海外节点无痕中转，不消耗公益服务器流量</div>
                </div>
              </button>

              {/* 复制直链 */}
              <button
                onClick={() => {
                  fetchAlist({ action: 'get', path: alistDownloadModal.filePath })
                    .then(r => r.json())
                    .then(data => {
                      const sign = data.code === 200 ? (data.data?.sign || '') : '';
                      const url = sign ? `${getAlistBase()}/d${alistDownloadModal!.filePath}?sign=${sign}` : `${getAlistBase()}/d${alistDownloadModal!.filePath}`;
                      navigator.clipboard.writeText(url);
                      setAlistMsg('✅ 直链已复制！粘贴到迅雷/IDM即可满速下载');
                    }).catch(() => {
                      navigator.clipboard.writeText(`${getAlistBase()}/d${alistDownloadModal!.filePath}`);
                      setAlistMsg('✅ 链接已复制');
                    });
                  setAlistDownloadModal(null);
                }}
                className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-left" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              >
                <div>
                  <div className="text-[11px] font-bold text-emerald-400">🚀 复制直链（迅雷/IDM）</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>适合超大文件，下载速度最快（搭配idm可达到50mb/s）且不消耗服务器流量。真心希望有条件的同学使用此方法，把服务器流量留给有需要的同学</div>
                </div>
              </button>

              {/* 自动加UA直接下载 */}
              <button
                onClick={() => {
                  let downloadUrl = `/api/alist-download?path=${encodeURIComponent(alistDownloadModal.filePath)}`;
                  if (userToken) downloadUrl += `&token=${encodeURIComponent(userToken)}`;
                  const ccConfigStr = localStorage.getItem('ALIST_CUSTOM_CONFIG');
                  if (ccConfigStr) {
                    downloadUrl += `&c=${btoa(encodeURIComponent(ccConfigStr))}`;
                  }
                  window.open(downloadUrl, '_blank');
                  setAlistDownloadModal(null);
                }}
                className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-left" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              >
                <div>
                  <div className="text-[11px] font-bold text-pink-400">🔥 服务器中转下载 (备用)</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>消耗服务器流量，仅在方案一失效时使用</div>
                </div>
              </button>

              {/* ⚡ 302 直链 */}
              <button
                onClick={() => { alistDirectDownload(alistDownloadModal.filePath, alistDownloadModal.sign); setAlistDownloadModal(null); }}
                className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-left" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              >
                <div>
                  <div className="text-[11px] font-bold" style={{ color: 'var(--text-primary)' }}>⚡ 302直链跳转（不加UA）</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>直接跳转百度CDN，大文件可能被拦截阻断</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-4xl mx-auto animate-in">

          {/* 文件浏览器卡片 */}
          <div className="glass rounded-2xl overflow-hidden">

            {/* 头部工具栏 */}
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black tracking-widest uppercase italic" style={{ color: 'var(--text-muted)' }}>Cloud_Drive</span>
                <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>· AList</span>
              </div>
              <div className="flex items-center gap-2">
                {canUpload && (
                  <>
                    <button onClick={() => setAlistShowMkdir(!alistShowMkdir)}
                      className="text-[10px] px-2 py-1 rounded transition-opacity hover:opacity-80" style={{ color: 'var(--text-muted)', border: '1px solid var(--border-color)' }} title="新建文件夹">
                      + 文件夹
                    </button>
                    <label className="text-[10px] px-2 py-1 rounded cursor-pointer transition-opacity hover:opacity-80" style={{ color: 'var(--text-muted)', border: '1px solid var(--border-color)' }} title="上传文件">
                      {alistUploading ? '上传中...' : '↑ 上传'}
                      <input type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setAlistUploadFile(f); }} />
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

            {/* 待上传确认 */}
            {alistUploadFile && canUpload && (
              <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
                <span className="text-[11px] flex-1 truncate" style={{ color: 'var(--text-muted)' }}>📎 {alistUploadFile.name}</span>
                <button onClick={alistUpload} disabled={alistUploading} className="px-2 py-1 text-[10px] bg-accent text-white rounded font-bold hover:opacity-80 disabled:opacity-50">
                  {alistUploading ? '上传中...' : '确认上传'}
                </button>
                <button onClick={() => setAlistUploadFile(null)} className="px-2 py-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>取消</button>
              </div>
            )}

            {/* 消息提示 */}
            {alistMsg && (
              <div className={`px-4 py-1.5 text-[11px] font-bold ${alistMsg.startsWith('✅') ? 'bg-green-500/10 text-green-500' : alistMsg.startsWith('🚀') ? 'bg-blue-500/10 text-blue-500' : 'bg-yellow-500/10 text-yellow-500'}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {alistMsg}
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
                        {/* 复选框 */}
                        {!file.is_dir ? (
                          <input type="checkbox" checked={alistSelected.has(file.name)} onChange={() => alistToggleSelect(file.name)}
                            className="w-3 h-3 accent-pink-500 shrink-0 cursor-pointer" />
                        ) : <span className="w-3 shrink-0" />}

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
                            {(canRename || canDelete) && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                {canRename && (
                                  <button onClick={() => { setAlistRenaming(filePath); setAlistNewName(file.name); }}
                                    className="text-zinc-600 hover:text-blue-400 transition-colors p-0.5" title="重命名">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                  </button>
                                )}
                                {canDelete && (
                                  <button onClick={() => alistRemove(file.name)}
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
                  {alistSelected.size > 0 ? `☑ ${alistSelected.size} 个文件` : `${alistFiles.length} 个项目`}
                </button>
                {alistSelected.size > 0 && (
                  <button onClick={alistBatchDownload} className="text-[10px] font-bold flex items-center gap-1 text-accent">
                    ↓ 批量下载
                  </button>
                )}
              </div>
              <button onClick={() => window.open(getAlistBase(), '_blank')} className="hover:opacity-100 opacity-80 transition-opacity">
                在 AList 中打开 ↗
              </button>
            </div>

          </div>
        </div>
      </main>

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
