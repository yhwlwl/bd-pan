import { pgClient, pgUpsert, pgInsert, pgDelete, pgUpdate, pgFetch } from './pg-adapter';

export type Role = 'admin' | 'manager' | 'guest';

export interface User {
    username: string;
    password: string;
    role: Role;
}

export interface MgSectionPermission {
    view: number;   // 0=隐藏 1-6=可见最高风险等级
    modify: number; // 0=只读 1-6=可修改最高风险等级
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
    mgAccess?: boolean; // 主站显示管理按钮，可进入 /mg
    viewStats?: boolean;
    viewActionLogs?: boolean;
    viewIpStats?: boolean;
    viewDownloadLogs?: boolean;
    // 管理后台板块权限（v2 风险分级）
    mgPermissions?: Record<string, MgSectionPermission>;
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

export interface DenyTrackingConfig {
    enabled?: boolean;
    warnThreshold?: number;
    deviceBanThreshold?: number;
    ipBanThreshold?: number;
    banDurationHours?: number;
    scoreMap?: Record<string, number>;
    decayWindowHours?: number;
    dedupWindowMinutes?: number;
    devicePostBanScore?: number;
    ipPostBanScore?: number;
    firstBanMinutes?: number;
    secondBanHours?: number;
    thirdBanHours?: number;
    banEscalationThreshold?: number;
}

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
    refreshInterval?: number;
    // 站点外观
    siteTitle?: string;
    siteSubtitle?: string;
    siteFooter?: string;
    defaultViewMode?: 'grid' | 'list';
    textPreviewMaxMB?: number;
    // 文件操作限制
    maxBatchDownload?: number;
    maxUploadSizeMB?: number;
    // 登录与频率限制
    maxFailedLogins?: number;
    failedLoginWindowMinutes?: number;
    maxConcurrentSessions?: number;
    // 数据保留（天，0=永久）
    actionLogRetentionDays?: number;
    denyEventRetentionDays?: number;
    visitLogRetentionDays?: number;
    // 公告系统（多公告支持）
    announcements?: { id: string; content: string; active: boolean; targetAudience: 'all' | 'guest' | 'user'; scheduledAt: string | null; publishedAt: string | null; createdAt: string; updatedAt: string }[];
    // 风控详细配置
    denyTracking?: DenyTrackingConfig;
    // 应急/维护
    maintenanceMode?: boolean;
    tokenInvalidBefore?: number;
    maintenanceSnapshot?: any;
    // 风险标签配置
    mgRiskLabels?: Record<string, number>;
}

export type UserWithPermissions = Omit<User, 'password'> & { permissions: UserPermissions };

const db = pgClient();

// 表名前缀（多站数据隔离，在 .env.local 设 DB_TABLE_PREFIX=wlm_）
const PREFIX = process.env.DB_TABLE_PREFIX || '';
const TABLE_USERS = `${PREFIX}bdpan_users`;
const TABLE_SETTINGS = `${PREFIX}bdpan_settings`;

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

    const { data: rows, error } = await pgFetch<{ value: any }>('GET', `${TABLE_SETTINGS}?select=value&key=eq.global&limit=1`);
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
        refreshInterval: typeof val.refreshInterval === 'number' ? val.refreshInterval : 60,
        // 站点外观
        siteTitle: typeof val.siteTitle === 'string' ? val.siteTitle : undefined,
        siteSubtitle: typeof val.siteSubtitle === 'string' ? val.siteSubtitle : undefined,
        siteFooter: typeof val.siteFooter === 'string' ? val.siteFooter : undefined,
        defaultViewMode: (val.defaultViewMode === 'grid' || val.defaultViewMode === 'list') ? val.defaultViewMode : undefined,
        textPreviewMaxMB: typeof val.textPreviewMaxMB === 'number' ? val.textPreviewMaxMB : 2,
        // 文件操作限制
        maxBatchDownload: typeof val.maxBatchDownload === 'number' ? val.maxBatchDownload : 0,
        maxUploadSizeMB: typeof val.maxUploadSizeMB === 'number' ? val.maxUploadSizeMB : 0,
        // 登录与频率限制
        maxFailedLogins: typeof val.maxFailedLogins === 'number' ? val.maxFailedLogins : 0,
        failedLoginWindowMinutes: typeof val.failedLoginWindowMinutes === 'number' ? val.failedLoginWindowMinutes : 15,
        maxConcurrentSessions: typeof val.maxConcurrentSessions === 'number' ? val.maxConcurrentSessions : 0,
        // 数据保留
        actionLogRetentionDays: typeof val.actionLogRetentionDays === 'number' ? val.actionLogRetentionDays : 0,
        denyEventRetentionDays: typeof val.denyEventRetentionDays === 'number' ? val.denyEventRetentionDays : 0,
        visitLogRetentionDays: typeof val.visitLogRetentionDays === 'number' ? val.visitLogRetentionDays : 0,
        // 风控详细配置
        denyTracking: (val.denyTracking || {}) as DenyTrackingConfig,
        // 公告系统（向后兼容：旧 announcement 字符串自动迁移）
        announcements: Array.isArray(val.announcements) ? (val.announcements as GlobalSettings['announcements']) : [],
        // 应急/维护
        maintenanceMode: typeof val.maintenanceMode === 'boolean' ? val.maintenanceMode : false,
        tokenInvalidBefore: typeof val.tokenInvalidBefore === 'number' ? val.tokenInvalidBefore : 0,
        maintenanceSnapshot: (val.maintenanceSnapshot || undefined) as any,
        mgRiskLabels: (val.mgRiskLabels || undefined) as Record<string, number> | undefined,
    };
}

export async function updateSettings(patch: Partial<GlobalSettings>): Promise<void> {
    if (!db) return;
    const current = await getSettings();
    const merged = { ...current, ...patch };
    await pgUpsert(TABLE_SETTINGS, { key: 'global', value: merged });
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
        mgAccess: false,
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
        mgAccess: false,
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
            mgAccess: true,
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

    const { data: users, error } = await pgFetch<Omit<User, 'password'>>('GET', `${TABLE_USERS}?select=username,role&order=id.asc`);
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
    const { data: rows, error } = await pgFetch<Omit<User, 'password'>>('GET', `${TABLE_USERS}?select=username,role&username=eq.${enc(username)}&password=eq.${enc(password)}&limit=1`);
    if (error || !rows || rows.length === 0) return null;
    return rows[0];
}

export async function addUser(username: string, password: string, role: Role): Promise<{ ok: boolean; error?: string }> {
    if (!db) return { ok: false, error: 'Supabase 未配置' };
    if (!username || !password) return { ok: false, error: '用户名和密码不能为空' };

    const { data: existing } = await pgFetch('GET', `${TABLE_USERS}?select=username&username=eq.${encodeURIComponent(username)}&limit=1`);
    if (existing && existing.length > 0) return { ok: false, error: '用户名已存在' };

    const { error } = await pgInsert(TABLE_USERS, { username, password, role });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

export async function removeUser(username: string): Promise<{ ok: boolean; error?: string }> {
    if (!db) return { ok: false, error: 'Supabase 未配置' };
    if (username === 'admin' || username === 'guest') {
        return { ok: false, error: `不能删除内置账号：${username}` };
    }

    const { error } = await pgDelete(TABLE_USERS, 'username', username);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

export async function updateUserRole(username: string, role: Role): Promise<{ ok: boolean; error?: string }> {
    if (!db) return { ok: false, error: 'Supabase 未配置' };
    if (username === 'admin' || username === 'guest') {
        return { ok: false, error: `不能修改内置账号角色：${username}` };
    }

    const { error } = await pgUpdate(TABLE_USERS, 'username', username, { role });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

export async function updateAdminPassword(newPassword: string): Promise<{ ok: boolean; error?: string }> {
    if (!db) return { ok: false, error: 'PG_URL 未配置' };
    if (!newPassword) return { ok: false, error: '密码不能为空' };

    const { error } = await pgUpdate(TABLE_USERS, 'username', 'admin', { password: newPassword });
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

/** 检查设备码是否被封禁（从 bdpan_risk_scores 表查询） */
export async function checkDeviceBanned(deviceCodeHash: string | null | undefined): Promise<boolean> {
    if (!deviceCodeHash) return false;
    try {
        const now = new Date().toISOString();
        const { data } = await pgFetch<{ id: number }>(
            'GET',
            `bdpan_risk_scores?select=id&entity_type=eq.device_code&entity_value=eq.${encodeURIComponent(deviceCodeHash)}&is_banned=eq.true&ban_expiry=gt.${encodeURIComponent(now)}&limit=1`
        );
        return !!(data && data.length > 0);
    } catch {
        return false;
    }
}
