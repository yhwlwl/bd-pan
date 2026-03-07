// 用户管理模块 — 基于 Supabase 持久化存储

import { createClient } from '@supabase/supabase-js';

export type Role = 'admin' | 'manager' | 'guest';

export interface User {
    username: string;
    password: string;
    role: Role;
}

export interface UserPermissions {
    view: boolean;
    download: boolean;
    upload: boolean;
    delete: boolean;
    rename: boolean;
    preview: boolean;
}

export interface GlobalSettings {
    enableGuestMode: boolean;
    permissions?: Record<string, UserPermissions>;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️ [users] Supabase 环境变量缺失，功能将受限');
}

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// === 获取权限 ===
export async function getUserPermissions(username: string, role: Role): Promise<UserPermissions> {
    const defaultManager: UserPermissions = { view: true, download: true, upload: true, delete: true, rename: true, preview: true };
    
    const settings = await getSettings();
    const defaultGuest: UserPermissions = { view: true, download: true, upload: false, delete: false, rename: false, preview: true };

    if (role === 'admin') {
        return { view: true, download: true, upload: true, delete: true, rename: true, preview: true };
    }

    const defaultPerms = role === 'manager' ? defaultManager : defaultGuest;
    const customPerms = settings.permissions?.[username];

    if (!customPerms) return defaultPerms;

    return { ...defaultPerms, ...customPerms };
}

// === 用户 CRUD ===

export type UserWithPermissions = Omit<User, 'password'> & { permissions: UserPermissions };

export async function getUsers(): Promise<UserWithPermissions[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('bdpan_users')
        .select('username, role')
        .order('id', { ascending: true });
    
    if (error) { console.error('[users] getUsers error:', error); return []; }
    
    // 获取对应的权限
    const users = (data || []) as Omit<User, 'password'>[];
    const result: UserWithPermissions[] = [];
    for (const u of users) {
        result.push({
            ...u,
            permissions: await getUserPermissions(u.username, u.role)
        });
    }

    // 内置一个游客账号，供全局配置统一的游客权限
    result.push({
        username: 'guest',
        role: 'guest',
        permissions: await getUserPermissions('guest', 'guest')
    });

    return result;
}

export async function findUser(username: string, password: string): Promise<Omit<User, 'password'> | null> {
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('bdpan_users')
        .select('username, role')
        .eq('username', username)
        .eq('password', password)
        .single();
    if (error || !data) return null;
    return data as Omit<User, 'password'>;
}

export async function addUser(username: string, password: string, role: Role): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: 'Supabase 未配置' };
    if (!username || !password) return { ok: false, error: '用户名和密码不能为空' };
    if (role === 'admin') return { ok: false, error: '不允许创建额外的 admin 账号' };

    // 检查用户名是否已存在
    const { data: existing } = await supabase
        .from('bdpan_users')
        .select('username')
        .eq('username', username)
        .single();
    if (existing) return { ok: false, error: '用户名已存在' };

    const { error } = await supabase
        .from('bdpan_users')
        .insert({ username, password, role });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

export async function removeUser(username: string): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: 'Supabase 未配置' };
    if (username === 'admin' || username === 'guest') return { ok: false, error: `不允许删除 ${username} 账号` };

    const { error, count } = await supabase
        .from('bdpan_users')
        .delete({ count: 'exact' })
        .eq('username', username);
    if (error) return { ok: false, error: error.message };
    if (count === 0) return { ok: false, error: '用户不存在' };
    return { ok: true };
}

export async function updateUserRole(username: string, role: Role): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: 'Supabase 未配置' };
    if (username === 'admin' || username === 'guest') return { ok: false, error: `不允许修改 ${username} 角色` };
    if (role === 'admin') return { ok: false, error: '不允许授予 admin 角色' };

    const { error, count } = await supabase
        .from('bdpan_users')
        .update({ role })
        .eq('username', username);
    if (error) return { ok: false, error: error.message };
    if (count === 0) return { ok: false, error: '用户不存在' };
    return { ok: true };
}

export async function updateAdminPassword(newPassword: string): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: 'Supabase 未配置' };
    if (!newPassword) return { ok: false, error: '密码不能为空' };

    const { error, count } = await supabase
        .from('bdpan_users')
        .update({ password: newPassword })
        .eq('username', 'admin');
    
    if (error) return { ok: false, error: error.message };
    if (count === 0) return { ok: false, error: '未能找到 admin 账号' };
    return { ok: true };
}

// === 全局设置 ===

export async function getSettings(): Promise<GlobalSettings> {
    const defaults: GlobalSettings = { enableGuestMode: true, permissions: {} };
    if (!supabase) return defaults;

    const { data, error } = await supabase
        .from('bdpan_settings')
        .select('value')
        .eq('key', 'global')
        .single();
    if (error || !data) return defaults;
    const val = data.value as Record<string, unknown>;
    return {
        enableGuestMode: typeof val.enableGuestMode === 'boolean' ? val.enableGuestMode : (typeof val.allowGuestDownload === 'boolean' ? val.allowGuestDownload : true),
        permissions: (val.permissions || {}) as Record<string, UserPermissions>,
    };
}

export async function updateSettings(patch: Partial<GlobalSettings>): Promise<void> {
    if (!supabase) return;

    const current = await getSettings();
    const merged = { ...current, ...patch };

    await supabase
        .from('bdpan_settings')
        .upsert({ key: 'global', value: merged });
}
