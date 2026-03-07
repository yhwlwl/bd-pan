// 用户管理模块 — 基于内存存储（Serverless 冷启动会重置，admin 账号从 env 恢复）

export type Role = 'admin' | 'manager' | 'guest';

export interface User {
    username: string;
    password: string;
    role: Role;
}

export interface GlobalSettings {
    allowGuestDownload: boolean;
}

interface Store {
    users: User[];
    settings: GlobalSettings;
}

// 全局内存存储（进程级，Serverless 实例间不共享）
const store: Store = {
    users: [],
    settings: {
        allowGuestDownload: true,
    },
};

let initialized = false;

function ensureInit() {
    if (initialized) return;
    initialized = true;

    const adminPwd = process.env.ADMIN_PASSWORD || 'admin';
    // 默认 admin 用户
    store.users.push({
        username: 'admin',
        password: adminPwd,
        role: 'admin',
    });
}

// === 用户 CRUD ===

export function getUsers(): Omit<User, 'password'>[] {
    ensureInit();
    return store.users.map(u => ({ username: u.username, role: u.role }));
}

export function findUser(username: string, password: string): Omit<User, 'password'> | null {
    ensureInit();
    const u = store.users.find(u => u.username === username && u.password === password);
    return u ? { username: u.username, role: u.role } : null;
}

export function addUser(username: string, password: string, role: Role): { ok: boolean; error?: string } {
    ensureInit();
    if (!username || !password) return { ok: false, error: '用户名和密码不能为空' };
    if (store.users.some(u => u.username === username)) return { ok: false, error: '用户名已存在' };
    if (role === 'admin') return { ok: false, error: '不允许创建额外的 admin 账号' };
    store.users.push({ username, password, role });
    return { ok: true };
}

export function removeUser(username: string): { ok: boolean; error?: string } {
    ensureInit();
    if (username === 'admin') return { ok: false, error: '不允许删除 admin 账号' };
    const idx = store.users.findIndex(u => u.username === username);
    if (idx === -1) return { ok: false, error: '用户不存在' };
    store.users.splice(idx, 1);
    return { ok: true };
}

export function updateUserRole(username: string, role: Role): { ok: boolean; error?: string } {
    ensureInit();
    if (username === 'admin') return { ok: false, error: '不允许修改 admin 角色' };
    if (role === 'admin') return { ok: false, error: '不允许授予 admin 角色' };
    const u = store.users.find(u => u.username === username);
    if (!u) return { ok: false, error: '用户不存在' };
    u.role = role;
    return { ok: true };
}

// === 全局设置 ===

export function getSettings(): GlobalSettings {
    ensureInit();
    return { ...store.settings };
}

export function updateSettings(patch: Partial<GlobalSettings>): void {
    ensureInit();
    if (typeof patch.allowGuestDownload === 'boolean') {
        store.settings.allowGuestDownload = patch.allowGuestDownload;
    }
}
