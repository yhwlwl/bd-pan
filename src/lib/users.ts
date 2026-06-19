import { pgClient, pgUpsert, pgInsert, pgDelete, pgUpdate, pgFetch } from './pg-adapter';

export type Role = 'admin' | 'manager' | 'guest';

export interface User {
    username: string;
    password: string;
    role: Role;
}

export interface UserPermissions {
    view: boolean;
    search: boolean;
    download: boolean;
    upload: boolean;
    delete: boolean;
    rename: boolean;
    preview: boolean;
    setting: boolean;
    controlFile?: boolean;
    basePath?: string;
    viewStats?: boolean;
    viewActionLogs?: boolean;
    viewIpStats?: boolean;
    viewDownloadLogs?: boolean;
}

export type FilePermissionAction = 'view' | 'search' | 'download' | 'upload' | 'delete' | 'rename' | 'preview';

export interface FilePermissionRule {
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

export type UserWithPermissions = Omit<User, 'password'> & { permissions: UserPermissions };

const db = pgClient();

function normalizePath(path: string | undefined): string {
    const raw = (path || '/').trim();
    if (!raw || raw === '/') return '/';
    const normalized = raw.startsWith('/') ? raw : `/${raw}`;
    return normalized.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

// Export for use in route handlers
export { normalizePath };

export function applyBasePathForPermissions(path: string | undefined, basePath?: string): string {
    const normalizedPath = normalizePath(path);
    const normalizedBase = normalizePath(basePath || '/');
    if (normalizedBase === '/') return normalizedPath;
    if (normalizedPath === '/') return normalizedBase;
    // 防止重复前缀：如果已经包含 basePath，直接返回
    if (normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`)) {
        return normalizedPath;
    }
    return `${normalizedBase}${normalizedPath}`.replace(/\/+/g, '/');
}

function ruleMatchesTarget(rule: FilePermissionRule, targetPath: string): boolean {
    const rulePath = normalizePath(rule.path);
    const normalizedTarget = normalizePath(targetPath);
    if (rule.pathType === 'file') return normalizedTarget === rulePath;
    if (rule.pathType === 'dir') return normalizedTarget === rulePath || normalizedTarget.startsWith(`${rulePath}/`);
    if (rule.pathType === 'regex') {
        try {
            const regex = new RegExp(rule.path, 'i');
            if (rule.regexScope === 'name') {
                const name = normalizedTarget.split('/').pop() || '';
                return regex.test(name);
            }
            return regex.test(normalizedTarget);
        } catch {
            return false;
        }
    }
    return false;
}

// Export for use in route handlers
export { ruleMatchesTarget };

export async function getSettings(): Promise<GlobalSettings> {
    const defaults: GlobalSettings = {
        enableGuestMode: true,
        permissions: {},
        filePermissionRules: [],
        disableThirdDownload: false,
        hideAlistButton: true,
        sessionDurationHours: 8,
        downloadChannel: 'ecs',
        downloadModes: {
            ecs: 'enabled',
            cf: 'enabled',
            raw: 'enabled',
            vercel: 'disabled',
            direct302: 'enabled',
        },
    };

    if (!db) return defaults;

    const { data: rows, error } = await pgFetch<{ value: any }>('GET', 'bdpan_settings?select=value&key=eq.global&limit=1');
    if (error || !rows || rows.length === 0) return defaults;

    const val = (rows[0].value || {}) as Record<string, unknown>;
    const legacyDisableThird = typeof val.disableThirdDownload === 'boolean' ? val.disableThirdDownload : false;
    const dlModes = (val.downloadModes || {}) as Partial<Record<keyof NonNullable<GlobalSettings['downloadModes']>, DownloadModeState>>;

    return {
        enableGuestMode: typeof val.enableGuestMode === 'boolean'
            ? val.enableGuestMode
            : (typeof val.allowGuestDownload === 'boolean' ? val.allowGuestDownload : true),
        permissions: (val.permissions || {}) as Record<string, UserPermissions>,
        filePermissionRules: Array.isArray(val.filePermissionRules) ? (val.filePermissionRules as FilePermissionRule[]) : [],
        disableThirdDownload: legacyDisableThird,
        hideAlistButton: typeof val.hideAlistButton === 'boolean' ? val.hideAlistButton : true,
        downloadChannel: val.downloadChannel === 'frp' ? 'frp' : 'ecs',
        downloadModes: {
            ecs: dlModes.ecs || 'enabled',
            cf: dlModes.cf || 'enabled',
            raw: dlModes.raw || 'enabled',
            vercel: dlModes.vercel || (legacyDisableThird ? 'hidden' : 'enabled'),
            direct302: dlModes.direct302 || 'enabled',
        },
        bannedIps: (val.bannedIps || {}) as Record<string, number>,
        announcement: typeof val.announcement === 'string' ? val.announcement : '',
        sessionDurationHours: typeof val.sessionDurationHours === 'number' ? val.sessionDurationHours : 8,
    };
}

export async function updateSettings(patch: Partial<GlobalSettings>): Promise<void> {
    if (!db) return;
    const current = await getSettings();
    const merged = { ...current, ...patch };
    await pgUpsert('bdpan_settings', { key: 'global', value: merged });
}

export async function getUserPermissions(username: string, role: Role): Promise<UserPermissions> {
    const settings = await getSettings();

    const defaultManager: UserPermissions = {
        view: true,
        search: true,
        download: true,
        upload: true,
        delete: true,
        rename: true,
        preview: true,
        setting: false,
        controlFile: true,
        basePath: '/',
        viewStats: false,
        viewActionLogs: false,
        viewIpStats: false,
        viewDownloadLogs: false,
    };

    const defaultGuest: UserPermissions = {
        view: true,
        search: true,
        download: true,
        upload: false,
        delete: false,
        rename: false,
        preview: true,
        setting: false,
        controlFile: false,
        basePath: '/',
        viewStats: false,
        viewActionLogs: false,
        viewIpStats: false,
        viewDownloadLogs: false,
    };

    if (role === 'admin') {
        return {
            view: true,
            search: true,
            download: true,
            upload: true,
            delete: true,
            rename: true,
            preview: true,
            setting: true,
            controlFile: true,
            basePath: '/',
        };
    }

    const defaultPerms = role === 'manager' ? defaultManager : defaultGuest;
    const customPerms = settings.permissions?.[username];
    if (!customPerms) return defaultPerms;
    return { ...defaultPerms, ...customPerms };
}

export async function getUsers(): Promise<UserWithPermissions[]> {
    if (!db) return [];

    const { data: users, error } = await pgFetch<Omit<User, 'password'>>('GET', 'bdpan_users?select=username,role&order=id.asc');
    if (error) { console.error('[users] getUsers error:', error); return []; }
    const result: UserWithPermissions[] = [];

    for (const user of (users || [])) {
        result.push({
            ...user,
            permissions: await getUserPermissions(user.username, user.role),
        });
    }

    result.push({
        username: 'guest',
        role: 'guest',
        permissions: await getUserPermissions('guest', 'guest'),
    });

    return result;
}

export async function findUser(username: string, password: string): Promise<Omit<User, 'password'> | null> {
    if (!db) return null;

    const enc = encodeURIComponent;
    const { data: rows, error } = await pgFetch<Omit<User, 'password'>>('GET', `bdpan_users?select=username,role&username=eq.${enc(username)}&password=eq.${enc(password)}&limit=1`);
    if (error || !rows || rows.length === 0) return null;
    return rows[0];
}

export async function addUser(username: string, password: string, role: Role): Promise<{ ok: boolean; error?: string }> {
    if (!db) return { ok: false, error: 'Supabase 未配置' };
    if (!username || !password) return { ok: false, error: '用户名和密码不能为空' };

    const { data: existing } = await pgFetch('GET', `bdpan_users?select=username&username=eq.${encodeURIComponent(username)}&limit=1`);
    if (existing && existing.length > 0) return { ok: false, error: '用户名已存在' };

    const { error } = await pgInsert('bdpan_users', { username, password, role });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

export async function removeUser(username: string): Promise<{ ok: boolean; error?: string }> {
    if (!db) return { ok: false, error: 'Supabase 未配置' };
    if (username === 'admin' || username === 'guest') {
        return { ok: false, error: `不能删除内置账号：${username}` };
    }

    const { error } = await pgDelete('bdpan_users', 'username', username);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

export async function updateUserRole(username: string, role: Role): Promise<{ ok: boolean; error?: string }> {
    if (!db) return { ok: false, error: 'Supabase 未配置' };
    if (username === 'admin' || username === 'guest') {
        return { ok: false, error: `不能修改内置账号角色：${username}` };
    }

    const { error } = await pgUpdate('bdpan_users', 'username', username, { role });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

export async function updateAdminPassword(newPassword: string): Promise<{ ok: boolean; error?: string }> {
    if (!db) return { ok: false, error: 'PG_URL 未配置' };
    if (!newPassword) return { ok: false, error: '密码不能为空' };

    const { error } = await pgUpdate('bdpan_users', 'username', 'admin', { password: newPassword });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

export async function getEffectivePermissionsForPath(username: string, role: Role, targetPath?: string): Promise<UserPermissions> {
    const basePermissions = await getUserPermissions(username, role);
    if (!targetPath || role === 'admin') return basePermissions;

    const settings = await getSettings();
    const rules = settings.filePermissionRules || [];
    const normalizedTarget = normalizePath(targetPath);
    const effective = { ...basePermissions };

    for (const rule of rules) {
        if (!Array.isArray(rule.users) || !rule.users.includes(username)) continue;
        if (!ruleMatchesTarget(rule, normalizedTarget)) continue;
        for (const action of Object.keys(rule.deny || {}) as FilePermissionAction[]) {
            if (rule.deny[action]) {
                effective[action] = false as never;
            }
        }
    }

    return effective;
}

export async function canManageFilePermissions(username: string, role: Role): Promise<boolean> {
    if (role === 'admin') return true;
    const permissions = await getUserPermissions(username, role);
    return permissions.controlFile === true;
}

export function canAssignFilePermissionTarget(actorRole: Role, targetRole: Role, targetUsername: string): boolean {
    if (targetUsername === 'admin') return false;
    if (actorRole === 'admin') return targetRole === 'manager' || targetRole === 'guest';
    if (actorRole === 'manager') return targetRole === 'guest';
    return false;
}

export function filterRuleUsersByActor(rule: FilePermissionRule, actorRole: Role, users: Array<{ username: string; role: Role }>): FilePermissionRule | null {
    const allowedUsers = rule.users.filter((username) => {
        const target = users.find((item) => item.username === username);
        if (!target) return false;
        return canAssignFilePermissionTarget(actorRole, target.role, target.username);
    });

    if (allowedUsers.length === 0) return null;
    return { ...rule, users: allowedUsers };
}

export async function checkIpBanned(ip: string | null): Promise<boolean> {
    if (!ip) return false;

    const settings = await getSettings();
    if (!settings.bannedIps || !settings.bannedIps[ip]) return false;

    const expiry = settings.bannedIps[ip];
    if (Date.now() > expiry) {
        delete settings.bannedIps[ip];
        await updateSettings({ bannedIps: settings.bannedIps });
        return false;
    }

    return true;
}
