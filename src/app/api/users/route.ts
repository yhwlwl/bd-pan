import { NextResponse } from 'next/server';
import { getMgAuthContext, canMgModify, canMgView } from '../_mg-auth';
import { getUsers, addUser, removeUser, updateUserRole, getSettings, getUserPermissions, updateSettings, updateAdminPassword } from '../../../lib/users';
import type { FilePermissionRule, GlobalSettings, Role, UserPermissions } from '../../../lib/users';
import { hasAnyMgViewPermission } from '../../../lib/mg-permissions';
import { canAssignFilePermissionTarget, filterRuleUsersByActor } from '../../../lib/users';

function errorResponse(message: string, status = 403) {
    return NextResponse.json({ error: message }, { status });
}
function sameValue(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left)) {
        if ((left as unknown[]).length !== (right as unknown[]).length) return false;
        return (left as unknown[]).every((item, index) => sameValue(item, (right as unknown[])[index]));
    }
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
    return [...keys].every((key) => sameValue(leftRecord[key], rightRecord[key]));
}

const SETTING_FIELD_OPERATIONS: Record<string, string[]> = {
    enableGuestMode: ['settings.global'],
    hideAlistButton: ['settings.global'],
    sessionDurationHours: ['settings.global'],
    refreshInterval: ['settings.global'],
    downloadChannel: ['settings.global'],
    downloadModes: ['settings.global'],
    disableThirdDownload: ['settings.global'],
    siteTitle: ['settings.appearance'],
    siteSubtitle: ['settings.appearance'],
    siteFooter: ['settings.appearance'],
    defaultViewMode: ['settings.appearance'],
    textPreviewMaxMB: ['settings.appearance'],
    maxFailedLogins: ['settings.loginLimits'],
    failedLoginWindowMinutes: ['settings.loginLimits'],
    maxConcurrentSessions: ['settings.loginLimits'],
    maxBatchDownload: ['settings.fileLimits'],
    maxUploadSizeMB: ['settings.fileLimits'],
    actionLogRetentionDays: ['settings.dataRetention'],
    denyEventRetentionDays: ['settings.dataRetention'],
    visitLogRetentionDays: ['settings.dataRetention'],
    denyTracking: ['settings.denyConfig'],
    mgRiskLabels: ['settings.riskLabels'],
    filePermissionRules: ['fileperms.editRules'],
};

function sanitizeSettings(
    auth: NonNullable<Awaited<ReturnType<typeof getMgAuthContext>>>,
    settings: GlobalSettings,
): Partial<GlobalSettings> {
    if (auth.user.role === 'admin') return settings;

    const visible: Partial<GlobalSettings> = {};
    const copy = (keys: string[]) => {
        for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(settings, key)) {
                (visible as Record<string, unknown>)[key] = (settings as unknown as Record<string, unknown>)[key];
            }
        }
    };

    if (canMgView(auth, 'settings.global')) {
        copy(['enableGuestMode', 'hideAlistButton', 'sessionDurationHours', 'refreshInterval', 'downloadChannel', 'downloadModes', 'disableThirdDownload']);
    }
    if (canMgView(auth, 'downloads.viewChannels')) copy(['downloadChannel', 'downloadModes']);
    if (canMgView(auth, 'settings.appearance')) copy(['siteTitle', 'siteSubtitle', 'siteFooter', 'defaultViewMode', 'textPreviewMaxMB']);
    if (canMgView(auth, 'settings.loginLimits')) copy(['maxFailedLogins', 'failedLoginWindowMinutes', 'maxConcurrentSessions']);
    if (canMgView(auth, 'settings.fileLimits')) copy(['maxBatchDownload', 'maxUploadSizeMB']);
    if (canMgView(auth, 'settings.dataRetention')) copy(['actionLogRetentionDays', 'denyEventRetentionDays', 'visitLogRetentionDays']);
    if (canMgView(auth, 'settings.denyConfig')) copy(['denyTracking']);
    if (canMgView(auth, 'settings.riskLabels')) copy(['mgRiskLabels']);
    if (canMgView(auth, 'announcements.viewHistory')) {
        copy(['announcement', 'announcements']);
    } else if (canMgView(auth, 'announcements.viewStatus')) {
        copy(['announcement']);
        if (Array.isArray(settings.announcements)) {
            visible.announcements = settings.announcements.filter((item) => item.active);
        }
    }
    if (canMgView(auth, 'visits.viewIPs') || canMgView(auth, 'emergency.view')) copy(['bannedIps']);
    if (canMgView(auth, 'emergency.view')) {
        copy(['maintenanceMode', 'tokenInvalidBefore']);
        if (settings.maintenanceSnapshot) visible.maintenanceSnapshot = { available: true };
    }

    return visible;
}

async function getUsersResponse(
    auth: NonNullable<Awaited<ReturnType<typeof getMgAuthContext>>>,
    settings: GlobalSettings,
) {
    const canList = auth.user.role === 'admin'
        || canMgView(auth, 'users.viewList')
        || canMgView(auth, 'users.viewPerms')
        || canMgModify(auth, 'users.changePerms')
        || canMgModify(auth, 'users.editBasePath');
    const canSeePermissions = auth.user.role === 'admin'
        || canMgView(auth, 'users.viewPerms')
        || canMgModify(auth, 'users.changePerms')
        || canMgModify(auth, 'users.editBasePath');
    const users = canList
        ? (await getUsers()).map((item) => {
            const result: Record<string, unknown> = { username: item.username, role: item.role };
            if (canSeePermissions) {
                result.permissions = { ...item.permissions };
                if (!auth.user || (!canMgView(auth, 'users.viewPerms') && auth.user.role !== 'admin')) {
                    delete (result.permissions as Record<string, unknown>).mgPermissions;
                    delete (result.permissions as Record<string, unknown>).controlFile;
                    delete (result.permissions as Record<string, unknown>).basePath;
                }
            }
            return result;
        })
        : [];

    return { users, settings: sanitizeSettings(auth, settings) };
}

function hasAllowedSettingChange(
    auth: NonNullable<Awaited<ReturnType<typeof getMgAuthContext>>>,
    key: string,
    claimedOperation: unknown,
): boolean {
    if (auth.user.role === 'admin') return true;
    const operations = SETTING_FIELD_OPERATIONS[key];
    if (!operations) return false;
    if (typeof claimedOperation === 'string' && operations.includes(claimedOperation)) {
        return canMgModify(auth, claimedOperation);
    }
    return operations.some((operation) => canMgModify(auth, operation));
}

function announcementOperations(current: unknown, next: unknown): string[] {
    const oldItems = Array.isArray(current) ? current : [];
    const newItems = Array.isArray(next) ? next : [];
    const oldById = new Map(oldItems.filter((item: any) => item?.id).map((item: any) => [item.id, item]));
    const newById = new Map(newItems.filter((item: any) => item?.id).map((item: any) => [item.id, item]));
    const required = new Set<string>();

    for (const id of oldById.keys()) if (!newById.has(id)) required.add('announcements.delete');
    for (const [id, item] of newById.entries()) {
        const previous = oldById.get(id);
        if (!previous) {
            required.add('announcements.publish');
            continue;
        }
        const oldWithoutActive = { ...previous };
        const newWithoutActive = { ...item };
        delete oldWithoutActive.active;
        delete newWithoutActive.active;
        if (!sameValue(oldWithoutActive, newWithoutActive)) required.add('announcements.publish');
        else if (previous.active !== item.active) required.add('announcements.toggle');
    }
    return [...required];
}

async function applyMaintenance(auth: NonNullable<Awaited<ReturnType<typeof getMgAuthContext>>>) {
    const current = auth.settings;
    const snapshot = JSON.parse(JSON.stringify(current));
    delete snapshot.maintenanceSnapshot;
    delete snapshot.tokenInvalidBefore;
    delete snapshot.maintenanceMode;
    const now = new Date().toISOString();
    const maintenanceAnnouncement = {
        id: `maintenance-${Date.now()}`,
        content: '站点维护中，请稍后再试',
        active: true,
        targetAudience: 'all' as const,
        displayLocation: 'all' as const,
        scheduledAt: null,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
    };
    await updateSettings({
        maintenanceMode: true,
        tokenInvalidBefore: Date.now(),
        enableGuestMode: false,
        maxUploadSizeMB: 0,
        maxBatchDownload: 0,
        downloadModes: { ecs: 'disabled', cf: 'disabled', raw: 'disabled', vercel: 'disabled', direct302: 'disabled' },
        maintenanceSnapshot: snapshot,
        announcements: [maintenanceAnnouncement, ...(current.announcements || [])],
    });
}

async function applyRestore(auth: NonNullable<Awaited<ReturnType<typeof getMgAuthContext>>>) {
    const snapshot = auth.settings.maintenanceSnapshot;
    if (!snapshot || typeof snapshot !== 'object') return false;
    const restored = { ...(snapshot as Record<string, unknown>) } as Partial<GlobalSettings>;
    const announcements = Array.isArray(restored.announcements)
        ? restored.announcements.map((item: any) => item.content === '站点维护中，请稍后再试' ? { ...item, active: false } : item)
        : restored.announcements;
    await updateSettings({
        ...restored,
        announcements,
        maintenanceMode: false,
        tokenInvalidBefore: 0,
        maintenanceSnapshot: undefined,
    });
    return true;
}

// GET: 返回当前操作者有权查看的用户和设置，禁止把全量后台配置泄露给普通经理
export async function GET(request: Request) {
    const auth = await getMgAuthContext(request);
    if (!auth) return errorResponse('权限不足', 401);
    if (auth.user.role !== 'admin' && !hasAnyMgViewPermission(auth.user.role, auth.permissions, auth.settings.mgRiskLabels)) {
        return errorResponse('权限不足', 403);
    }
    return NextResponse.json(await getUsersResponse(auth, auth.settings));
}

// POST: 每个管理动作都必须通过对应的 mgPermissions 修改权限
export async function POST(request: Request) {
    const auth = await getMgAuthContext(request);
    if (!auth) return errorResponse('权限不足', 401);

    try {
        const body = await request.json();
        const { action, mgOperation } = body as { action?: string; mgOperation?: string };
        const requireModify = (operation: string) => {
            if (auth.user.role === 'admin' || canMgModify(auth, operation)) return true;
            return false;
        };

        switch (action) {
            case 'add': {
                if (!requireModify('users.addUser')) return errorResponse('无添加用户权限');
                const { username, password, role } = body as { username: string; password: string; role: Role };
                if (!['admin', 'manager', 'guest'].includes(role)) return NextResponse.json({ error: '角色无效' }, { status: 400 });
                if (role === 'admin' && auth.user.role !== 'admin') return errorResponse('无权创建管理员');
                const result = await addUser(username, password, role);
                if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
                return NextResponse.json({ ok: true, ...(await getUsersResponse(auth, await getSettings())) });
            }

            case 'remove': {
                if (!requireModify('users.deleteUser')) return errorResponse('无删除用户权限');
                const { username } = body as { username: string };
                const result = await removeUser(username);
                if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
                return NextResponse.json({ ok: true, ...(await getUsersResponse(auth, await getSettings())) });
            }

            case 'updateRole': {
                if (!requireModify('users.changeRole')) return errorResponse('无修改用户角色权限');
                const { username, role } = body as { username: string; role: Role };
                if (!['admin', 'manager', 'guest'].includes(role)) return NextResponse.json({ error: '角色无效' }, { status: 400 });
                if (auth.user.role !== 'admin' && role === 'admin') return errorResponse('无权授予管理员角色');
                const currentUser = (await getUsers()).find((item) => item.username === username);
                if (auth.user.role !== 'admin' && currentUser?.role === 'admin') return errorResponse('无权修改管理员角色');
                const result = await updateUserRole(username, role);
                if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
                return NextResponse.json({ ok: true, ...(await getUsersResponse(auth, await getSettings())) });
            }

            case 'updateSettings': {
                const requested = body.settings as Partial<GlobalSettings>;
                if (!requested || typeof requested !== 'object' || Array.isArray(requested)) {
                    return NextResponse.json({ error: '设置格式错误' }, { status: 400 });
                }

                if (mgOperation === 'emergency.maintenance') {
                    if (!requireModify('emergency.maintenance')) return errorResponse('无维护模式权限');
                    await applyMaintenance(auth);
                } else if (mgOperation === 'emergency.restore') {
                    if (!requireModify('emergency.restore')) return errorResponse('无恢复运行权限');
                    if (!(await applyRestore(auth))) return NextResponse.json({ error: '无维护快照，无法恢复' }, { status: 400 });
                } else {
                    const current = auth.settings;
                    for (const key of Object.keys(requested)) {
                        if (sameValue((requested as Record<string, unknown>)[key], (current as unknown as Record<string, unknown>)[key])) continue;
                        if (key === 'announcements' || key === 'announcement') {
                            const operations = key === 'announcements'
                                ? announcementOperations(current.announcements, requested.announcements)
                                : ['announcements.publish'];
                            if (auth.user.role !== 'admin' && (!operations.length || !operations.every((operation) => canMgModify(auth, operation)))) {
                                return errorResponse('无公告修改权限');
                            }
                            continue;
                        }
                        if (key === 'bannedIps') {
                            const operation = typeof mgOperation === 'string' ? mgOperation : '';
                            const valid = ['visits.banShort', 'visits.banCustom', 'visits.unban', 'emergency.banAllIPs'];
                            if (auth.user.role !== 'admin' && (!valid.includes(operation) || !canMgModify(auth, operation))) {
                                return errorResponse('无 IP 封禁修改权限');
                            }
                            continue;
                        }
                        if (!hasAllowedSettingChange(auth, key, mgOperation)) {
                            return errorResponse(`无权修改设置: ${key}`);
                        }
                    }
                    await updateSettings(requested);
                }

                const freshSettings = await getSettings();
                return NextResponse.json({ ok: true, ...(await getUsersResponse(auth, freshSettings)) });
            }

            case 'changeAdminPassword': {
                if (!requireModify('settings.changePassword')) return errorResponse('无修改管理员密码权限');
                const { password } = body as { password?: string };
                if (!password) return NextResponse.json({ error: '新密码不能留空' }, { status: 400 });
                const result = await updateAdminPassword(password);
                if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
                return NextResponse.json({ ok: true });
            }

            case 'updatePermissions': {
                const { username, permissions } = body as { username: string; permissions: UserPermissions };
                if (!permissions || typeof permissions !== 'object') return NextResponse.json({ error: '权限格式错误' }, { status: 400 });
                const currentUsers = await getUsers();
                const target = currentUsers.find((item) => item.username === username);
                if (!target) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
                if (auth.user.role !== 'admin' && target.role === 'admin') return errorResponse('无权修改管理员权限');
                const currentEffective = await getUserPermissions(username, target.role);
                const keys = new Set([...Object.keys(currentEffective), ...Object.keys(permissions)]);
                const changedKeys = [...keys].filter((key) => !sameValue((currentEffective as any)[key], (permissions as any)[key]));
                const basePathChanged = changedKeys.includes('basePath');
                const otherChanged = changedKeys.some((key) => key !== 'basePath');
                if (auth.user.role !== 'admin') {
                    if (basePathChanged && !canMgModify(auth, 'users.editBasePath')) return errorResponse('无修改用户目录权限');
                    if (otherChanged && !canMgModify(auth, 'users.changePerms')) return errorResponse('无修改用户权限');
                }
                const settings = await getSettings();
                const globalPerms = { ...(settings.permissions || {}) };
                globalPerms[username] = permissions;
                await updateSettings({ permissions: globalPerms });
                return NextResponse.json({ ok: true, ...(await getUsersResponse(auth, await getSettings())) });
            }

            case 'updateFilePermissionRules': {
                if (!requireModify('fileperms.editRules')) return errorResponse('无修改文件权限规则权限');
                const { rules } = body as { rules: FilePermissionRule[] };
                const settings = await getSettings();
                const allUsers = (await getUsers()).map((item) => ({ username: item.username, role: item.role }));
                const manageableUsernames = new Set(
                    allUsers
                        .filter((item) => canAssignFilePermissionTarget(auth.user.role, item.role, item.username))
                        .map((item) => item.username),
                );
                const submittedRules = Array.isArray(rules) ? rules : [];
                const sanitizedRules = submittedRules
                    .map((rule) => filterRuleUsersByActor(rule, auth.user.role, allUsers))
                    .filter(Boolean) as FilePermissionRule[];
                const preservedRules = (settings.filePermissionRules || []).filter((rule) =>
                    !rule.users.some((username) => manageableUsernames.has(username))
                );
                await updateSettings({ filePermissionRules: [...preservedRules, ...sanitizedRules] });
                return NextResponse.json({ ok: true, ...(await getUsersResponse(auth, await getSettings())) });
            }

            default:
                return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
        }
    } catch {
        return NextResponse.json({ error: '接口异常' }, { status: 500 });
    }
}
