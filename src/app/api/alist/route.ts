import { NextResponse } from 'next/server';
import { verifyToken, verifyTokenWithLog } from '../_auth';
import {
    FilePermissionAction,
    getEffectivePermissionsForPath,
    getSettings,
    getUserPermissions,
    normalizePath,
    ruleMatchesTarget,
    UserPermissions,
} from '../../../lib/users';
import { denyAndLog, getRequestContext, checkEntityBanned } from '../../../lib/deny-tracker';
import { hashDeviceCode } from '../../../lib/fingerprint';
import { getAlistPermissionPathVariants, isAlistPathScopeError, normalizeAlistName, resolveScopedAlistPath, stripScopedAlistPath } from '../../../lib/path-scope';

const ECS_URL = (process.env.NEXT_PUBLIC_ALIST_URL || 'https://pan.tantantan.tech:5245').replace(/\/+$/, '');
const ECS_USER = process.env.ALIST_USERNAME || '';
const ECS_PASS = process.env.ALIST_PASSWORD || '';
const FRP_URL = (process.env.NEXT_PUBLIC_ALIST_URL_FALLBACK || 'https://frp-gap.com:37492').replace(/\/+$/, '');
const FRP_USER = process.env.ALIST_USERNAME_FALLBACK || '';
const FRP_PASS = process.env.ALIST_PASSWORD_FALLBACK || '';

const tokenCache = new Map<string, { token: string; expiry: number }>();

async function getAlistToken(url: string, user: string, pass: string): Promise<string> {
    const cacheKey = `${url}|${user}|${pass}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) {
        return cached.token;
    }

    const res = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
    });

    const data = await res.json();
    if (data.code !== 200 || !data.data?.token) {
        throw new Error(data.message || 'AList 登录失败');
    }

    const newToken = data.data.token;
    tokenCache.set(cacheKey, { token: newToken, expiry: Date.now() + 47 * 60 * 60 * 1000 });
    return newToken;
}

async function alistFetch(endpoint: string, body: any, config: { url: string; user: string; pass: string }) {
    const token = await getAlistToken(config.url, config.user, config.pass);
    const res = await fetch(`${config.url}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: token,
        },
        body: JSON.stringify(body),
    });
    return res.json();
}

const REDACTED_ALIST_KEYS = new Set(['token', 'authorization', 'password']);

function redactAlistSecrets(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redactAlistSecrets);
    if (!value || typeof value !== 'object') return value;
    const safe: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        if (REDACTED_ALIST_KEYS.has(key.toLowerCase())) continue;
        safe[key] = redactAlistSecrets(child);
    }
    return safe;
}

function projectAlistItem(item: any, itemPath: string, visiblePath: string, itemPerms: UserPermissions) {
    const itemName = String(item?.name || '');
    const isDir = Boolean(item?.is_dir);
    const itemDownload = !isDir && itemPerms.download;
    return {
        name: itemName,
        is_dir: isDir,
        size: Number(item?.size || 0),
        modified: item?.modified,
        created: item?.created,
        thumb: item?.thumb,
        provider: item?.provider,
        path: visiblePath,
        // raw_url/sign only exist for an explicitly downloadable file. A
        // preview-only user must never receive a reusable AList link.
        ...(itemDownload ? {
            ...(item?.raw_url ? { raw_url: item.raw_url } : {}),
            ...(item?.sign ? { sign: item.sign } : {}),
            download_path: itemPath,
        } : {}),
        perms: {
            delete: itemPerms.delete,
            rename: itemPerms.rename,
            upload: itemPerms.upload,
            download: itemDownload,
            preview: itemPerms.preview,
            view: itemPerms.view,
        },
    };
}

export async function POST(request: Request) {
    const startTime = Date.now();
    let requestUsername: string | undefined;
    try {
        const body = await request.json().catch(() => ({}));
        let { action, path, name, names, newName, dir_name, parent, keywords, scope } = body as {
            action: string;
            path?: string;
            name?: string;
            names?: string[];
            newName?: string;
            dir_name?: string;
            parent?: string;
            keywords?: string;
            scope?: number;
        };

        const ctx = getRequestContext(request);
        const deviceCodeHash = hashDeviceCode(ctx.deviceCode || '');

        // 先验证已有 token，再统一检查 IP/设备/账号三维度封禁。
        const authHeader = request.headers.get('authorization') || undefined;
        const tokenUser = verifyToken(authHeader);
        const { banned, reason: banReason } = await checkEntityBanned(
            ctx.ip, deviceCodeHash, tokenUser?.role, tokenUser?.username,
        );
        if (banned) {
            const label = banReason === 'device' ? '设备' : banReason === 'account' ? '账号' : 'IP';
            return denyAndLog(request, 'api_entity_banned', 403, `您的${label}已被禁止访问`, tokenUser?.username);
        }

        const user = tokenUser || verifyTokenWithLog(authHeader, ctx);
        if (!user) {
            return NextResponse.json({ code: 401, message: '请先登录' }, { status: 401 });
        }
        requestUsername = user.username;

        // 维护模式：非 admin 全部拒绝
        const settings = await getSettings();
        if (settings.maintenanceMode && user.role !== 'admin') {
            return NextResponse.json({ code: 403, message: '站点维护中，请稍后再试' }, { status: 403 });
        }

        console.log(`[alist] ${action} start, path=${path}, user=${user.username}, role=${user.role}, time=${Date.now() - startTime}ms`);

        // Backend and credentials are server-controlled. Never accept an URL or
        // AList credential from the browser: that would be an SSRF/credential
        // relay and would let a user escape the configured storage boundary.
        const globalSettings = settings;
        const channel = globalSettings.downloadChannel || 'ecs';
        const config = channel === 'ecs'
            ? { url: ECS_URL, user: ECS_USER, pass: ECS_PASS }
            : { url: FRP_URL, user: FRP_USER, pass: FRP_PASS };

        if (!action) {
            return NextResponse.json({ code: 400, message: '缺少 action 参数' }, { status: 400 });
        }

        const perms = await getUserPermissions(user.username, user.role);
        const scopedPath = resolveScopedAlistPath(path, perms.basePath);
        const scopedParent = resolveScopedAlistPath(parent, perms.basePath);
        const stripBasePath = (input?: string) => input
            ? stripScopedAlistPath(input, perms.basePath)
            : input;

        // Optimized permission checker with cached settings
        const getEffectivePermissionsForPathCached = (targetPath?: string): UserPermissions => {
            const basePermissions = perms; // already fetched
            if (!targetPath || user.role === 'admin') return basePermissions;

            const rules = globalSettings.filePermissionRules || [];
            const normalizedTargets = getAlistPermissionPathVariants(targetPath, perms.basePath);
            const effective = { ...basePermissions };
            let hitCount = 0;

            for (const rule of rules) {
                if (!Array.isArray(rule.users) || !rule.users.includes(user.username)) continue;
                if (!normalizedTargets.some((target) => ruleMatchesTarget(rule, normalizePath(target)))) continue;
                hitCount++;
                for (const action of Object.keys(rule.deny || {}) as FilePermissionAction[]) {
                    if (rule.deny[action]) {
                        effective[action] = false as never;
                    }
                }
            }

            if (hitCount > 0) {
                console.log(`[alist:perms] ${normalizedTargets[0]} → ${hitCount} 条规则命中, download=${effective.download}, preview=${effective.preview}, view=${effective.view}`);
            }

            return effective;
        };

        const getScopedPerms = (target?: string) =>
            getEffectivePermissionsForPathCached(
                target ? resolveScopedAlistPath(target, perms.basePath) : undefined,
            );

        if (action === 'list' || action === 'get') {
            const isRoot = !path || path === '/';
            if (!isRoot) {
                const targetPerms = await getScopedPerms(path);
                if (!targetPerms.view && !targetPerms.download && !targetPerms.preview) {
                    return denyAndLog(request, 'api_file_rule_denied', 403, '该路径已被限制访问', user.username);
                }
            }
        }
        if (action === 'search') {
            const targetPerms = await getScopedPerms(parent);
            if (!targetPerms.search) {
                return denyAndLog(request, 'api_permission_denied', 403, '无权搜索文件', user.username);
            }
        }
        if (action === 'mkdir') {
            const targetPerms = await getScopedPerms(path);
            if (!targetPerms.upload) {
                return denyAndLog(request, 'api_permission_denied', 403, '无权创建文件夹', user.username);
            }
        }
        if (action === 'remove') {
            const parentPerms = await getScopedPerms(path);
            if (!parentPerms.delete) {
                return denyAndLog(request, 'api_permission_denied', 403, '无权删除文件', user.username);
            }
            // 额外检查每一个具体项，防止绕过特定路径记录的禁止删除规则
            const items = (names || (name ? [name] : [])).map((item) => normalizeAlistName(item));
            for (const n of items) {
                const fullItemPath = `${scopedPath.replace(/\/+$/, '')}/${n}`;
                const itemPerms = await getScopedPerms(fullItemPath);
                if (!itemPerms.delete) {
                    return denyAndLog(request, 'api_permission_denied', 403, `您没有删除该项的权限: ${n}`, user.username);
                }
            }
        }
        if (action === 'rename') {
            const itemPerms = await getScopedPerms(path);
            if (!itemPerms.rename) {
                return denyAndLog(request, 'api_permission_denied', 403, '无权重命名该项', user.username);
            }
        }

        const safeDirName = action === 'mkdir' ? normalizeAlistName(dir_name) : undefined;
        const safeNewName = action === 'rename' ? normalizeAlistName(newName) : undefined;
        const safeRemoveNames = action === 'remove'
            ? (names || (name ? [name] : [])).map((item) => normalizeAlistName(item))
            : [];

        let result: any;
        switch (action) {
            case 'list':
                result = await alistFetch('/api/fs/list', { path: scopedPath, page: 1, per_page: 0, refresh: false }, config);
                if (result?.data) {
                    const currentPathPerms = await getScopedPerms(path);
                    result.data.current_perms = {
                        delete: currentPathPerms.delete,
                        rename: currentPathPerms.rename,
                        upload: currentPathPerms.upload,
                        search: currentPathPerms.search,
                    };
                }
                if (Array.isArray(result?.data?.content)) {
                    console.log(`[alist] list fetched ${result.data.content.length} items, time=${Date.now() - startTime}ms`);
                    const filtered = [];
                    for (const item of result.data.content) {
                        // alist 某些驱动返回的 item.path 可能不带挂载前缀，补齐
                        const itemPath = resolveScopedAlistPath(
                            `${scopedPath.replace(/\/+$/, '')}/${normalizeAlistName(item?.name)}`,
                            perms.basePath,
                        );
                        const itemPerms = getEffectivePermissionsForPathCached(itemPath);
                        if (!itemPerms.view && !itemPerms.download && !itemPerms.preview) continue;
                        filtered.push(projectAlistItem(item, itemPath, stripBasePath(itemPath) || '/', itemPerms));
                    }
                    console.log(`[alist] list filtered to ${filtered.length} items, time=${Date.now() - startTime}ms`);
                    result.data.content = filtered;
                }
                break;
            case 'get':
                result = await alistFetch('/api/fs/get', { path: scopedPath }, config);
                if (result?.data) {
                    const itemPerms = getEffectivePermissionsForPathCached(scopedPath);
                    result.data = projectAlistItem(
                        result.data,
                        scopedPath,
                        stripBasePath(scopedPath) || '/',
                        itemPerms,
                    );
                }
                break;
            case 'mkdir':
                result = await alistFetch('/api/fs/mkdir', { path: `${scopedPath.replace(/\/+$/, '')}/${safeDirName}` }, config);
                break;
            case 'remove':
                result = await alistFetch('/api/fs/remove', { dir: scopedPath, names: safeRemoveNames }, config);
                break;
            case 'rename':
                result = await alistFetch('/api/fs/rename', { path: scopedPath, name: safeNewName }, config);
                break;
            case 'list_archive':
                result = await alistFetch('/api/fs/other', { path: scopedPath, method: 'list_archive' }, config);
                break;
            case 'search':
                result = await alistFetch('/api/fs/search', {
                    parent: scopedParent,
                    keywords: (keywords || '').trim(),
                    scope: typeof scope === 'number' ? scope : 0,
                    page: 1,
                    per_page: 5000,
                }, config);
                if (Array.isArray(result?.data?.content)) {
                    const filtered = [];
                    for (const item of result.data.content) {
                        const itemPath = resolveScopedAlistPath(
                            item?.path || item?.obj_path || item?.full_path
                              || `${(item?.parent || scopedParent).replace(/\/+$/, '')}/${normalizeAlistName(item?.name)}`,
                            perms.basePath,
                        );
                        const itemPerms = getEffectivePermissionsForPathCached(itemPath);
                        if (!itemPerms.view && !itemPerms.download && !itemPerms.preview) continue;
                        const visibleItemPath = stripBasePath(itemPath) || '/';
                        const lastSlash = visibleItemPath.lastIndexOf('/');
                        filtered.push({
                            ...projectAlistItem(item, itemPath, visibleItemPath, itemPerms),
                            parent: lastSlash <= 0 ? '/' : visibleItemPath.slice(0, lastSlash),
                        });
                    }
                    result.data.content = filtered;
                }
                break;
            default:
                return NextResponse.json({ code: 400, message: `未知操作: ${action}` }, { status: 400 });
        }

        return NextResponse.json({
            code: result?.code,
            message: result?.message || (result?.code === 200 ? 'success' : 'AList 请求失败'),
            data: ['list', 'get', 'search'].includes(action) && result?.code === 200
                ? redactAlistSecrets(result.data)
                : null,
        }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error: any) {
        console.error('[alist] error:', error);
        if (isAlistPathScopeError(error)) {
            return denyAndLog(request, 'api_path_scope_denied', 403, '请求路径不在允许范围内', requestUsername);
        }
        return NextResponse.json({ code: 500, message: error?.message || 'AList 代理出错' }, { status: 500 });
    }
}
