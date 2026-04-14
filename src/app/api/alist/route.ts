import { NextResponse } from 'next/server';
import { verifyToken } from '../_auth';
import {
    applyBasePathForPermissions,
    checkIpBanned,
    FilePermissionAction,
    getEffectivePermissionsForPath,
    getSettings,
    getUserPermissions,
    normalizePath,
    ruleMatchesTarget,
    UserPermissions,
} from '../../../lib/users';

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

function normalizeVisiblePath(path?: string) {
    const raw = (path || '/').trim();
    if (!raw || raw === '/') return '/';
    return (raw.startsWith('/') ? raw : `/${raw}`).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

export async function POST(request: Request) {
    const startTime = Date.now();
    try {
        const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        if (await checkIpBanned(clientIp)) {
            return NextResponse.json({ code: 403, message: '您的 IP 已被禁止访问' }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const { action, path, name, names, newName, dir_name, parent, keywords, scope } = body as {
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

        const user = verifyToken(request.headers.get('authorization') || undefined);
        if (!user) {
            return NextResponse.json({ code: 401, message: '请先登录' }, { status: 401 });
        }

        console.log(`[alist] ${action} start, path=${path}, user=${user.username}, time=${Date.now() - startTime}ms`);

        const customUrl = request.headers.get('x-alist-url');
        const customUser = request.headers.get('x-alist-username');
        const customPass = request.headers.get('x-alist-password');

        let config: { url: string; user: string; pass: string };
        let globalSettings: any;
        if (customUrl) {
            config = { url: customUrl.replace(/\/+$/, ''), user: customUser || '', pass: customPass || '' };
            globalSettings = await getSettings(); // still need for permissions
        } else {
            globalSettings = await getSettings();
            const channel = globalSettings.downloadChannel || 'ecs';
            config = channel === 'ecs'
                ? { url: ECS_URL, user: ECS_USER, pass: ECS_PASS }
                : { url: FRP_URL, user: FRP_USER, pass: FRP_PASS };
        }

        if (!action) {
            return NextResponse.json({ code: 400, message: '缺少 action 参数' }, { status: 400 });
        }

        const perms = await getUserPermissions(user.username, user.role);
        const applyBasePath = (input: string | undefined) => {
            const original = normalizeVisiblePath(input);
            const basePath = normalizeVisiblePath(perms.basePath || '/');
            if (basePath === '/') return original;
            if (original === '/') return basePath;
            return `${basePath}${original}`.replace(/\/+/g, '/');
        };
        const scopedPath = applyBasePath(path);
        const scopedParent = applyBasePath(parent);
        const basePath = normalizeVisiblePath(perms.basePath || '/');
        const stripBasePath = (input?: string) => {
            if (!input) return input;
            if (basePath === '/') return input;
            if (input === basePath) return '/';
            if (input.startsWith(`${basePath}/`)) return input.slice(basePath.length) || '/';
            return input;
        };

        // Optimized permission checker with cached settings
        const getEffectivePermissionsForPathCached = (targetPath?: string): UserPermissions => {
            const basePermissions = perms; // already fetched
            if (!targetPath || user.role === 'admin') return basePermissions;

            const rules = globalSettings.filePermissionRules || [];
            const normalizedTarget = normalizePath(targetPath);
            const effective = { ...basePermissions };

            for (const rule of rules) {
                if (!Array.isArray(rule.users) || !rule.users.includes(user.username)) continue;
                if (!ruleMatchesTarget(rule, normalizedTarget)) continue;
                for (const action of Object.keys(rule.deny || {}) as FilePermissionAction[]) {
                    if (rule.deny[action]) {
                        effective[action] = false as never;
                    }
                }
            }

            return effective;
        };

        const getScopedPerms = (target?: string) =>
            getEffectivePermissionsForPathCached(
                target ? applyBasePathForPermissions(target, perms.basePath) : undefined,
            );

        if (action === 'list' || action === 'get') {
            const isRoot = !path || path === '/';
            if (!isRoot) {
                const targetPerms = await getScopedPerms(path);
                if (!targetPerms.view && !targetPerms.download && !targetPerms.preview) {
                    return NextResponse.json({ code: 403, message: '该路径已被限制访问' }, { status: 403 });
                }
            }
        }
        if (action === 'search') {
            const targetPerms = await getScopedPerms(parent);
            if (!targetPerms.search) {
                return NextResponse.json({ code: 403, message: '无权搜索文件' }, { status: 403 });
            }
        }
        if (action === 'mkdir') {
            const targetPerms = await getScopedPerms(path);
            if (!targetPerms.upload) {
                return NextResponse.json({ code: 403, message: '无权创建文件夹' }, { status: 403 });
            }
        }
        if (action === 'remove') {
            const parentPerms = await getScopedPerms(path);
            if (!parentPerms.delete) {
                return NextResponse.json({ code: 403, message: '无权删除文件' }, { status: 403 });
            }
            // 额外检查每一个具体项，防止绕过特定路径记录的禁止删除规则
            const items = names || (name ? [name] : []);
            for (const n of items) {
                const fullItemPath = `${(path || '').replace(/\/+$/, '')}/${n}`;
                const itemPerms = await getScopedPerms(fullItemPath);
                if (!itemPerms.delete) {
                    return NextResponse.json({ code: 403, message: `您没有删除该项的权限: ${n}` }, { status: 403 });
                }
            }
        }
        if (action === 'rename') {
            const itemPerms = await getScopedPerms(path);
            if (!itemPerms.rename) {
                return NextResponse.json({ code: 403, message: '无权重命名该项' }, { status: 403 });
            }
        }

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
                        const itemPath = item?.path || `${scopedPath.replace(/\/+$/, '')}/${item?.name || ''}`;
                        const itemPerms = getEffectivePermissionsForPathCached(itemPath);
                        if (!itemPerms.view && !itemPerms.download && !itemPerms.preview) continue;
                        filtered.push({
                            ...item,
                            path: stripBasePath(item?.path),
                            perms: {
                                delete: itemPerms.delete,
                                rename: itemPerms.rename,
                                upload: itemPerms.upload,
                                download: itemPerms.download,
                                preview: itemPerms.preview
                            }
                        });
                    }
                    console.log(`[alist] list filtered to ${filtered.length} items, time=${Date.now() - startTime}ms`);
                    result.data.content = filtered;
                }
                break;
            case 'get':
                result = await alistFetch('/api/fs/get', { path: scopedPath }, config);
                break;
            case 'mkdir':
                result = await alistFetch('/api/fs/mkdir', { path: `${scopedPath.replace(/\/+$/, '')}/${dir_name}` }, config);
                break;
            case 'remove':
                result = await alistFetch('/api/fs/remove', { dir: scopedPath, names: names || (name ? [name] : []) }, config);
                break;
            case 'rename':
                result = await alistFetch('/api/fs/rename', { path: scopedPath, name: (newName || '').trim() }, config);
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
                        const itemPath = item?.path || item?.obj_path || item?.full_path || item?.parent;
                        const itemPerms = getEffectivePermissionsForPathCached(itemPath);
                        if (!itemPerms.view && !itemPerms.download && !itemPerms.preview) continue;
                        filtered.push({
                            ...item,
                            parent: stripBasePath(item?.parent),
                            path: stripBasePath(item?.path),
                            perms: {
                                delete: itemPerms.delete,
                                rename: itemPerms.rename,
                                upload: itemPerms.upload,
                                download: itemPerms.download,
                                preview: itemPerms.preview
                            }
                        });
                    }
                    result.data.content = filtered;
                }
                break;
            default:
                return NextResponse.json({ code: 400, message: `未知操作: ${action}` }, { status: 400 });
        }

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('[alist] error:', error);
        return NextResponse.json({ code: 500, message: error?.message || 'AList 代理出错' }, { status: 500 });
    }
}
