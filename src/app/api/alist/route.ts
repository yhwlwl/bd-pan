import { NextResponse } from 'next/server';
import { verifyToken } from '../_auth';
import { getUserPermissions, getSettings, checkIpBanned } from '../../../lib/users';

// ECS 成都节点 (主)
const ECS_URL = (process.env.NEXT_PUBLIC_ALIST_URL || 'http://8.137.91.213:5244').replace(/\/+$/, '');
const ECS_USER = process.env.ALIST_USERNAME || '';
const ECS_PASS = process.env.ALIST_PASSWORD || '';
// FRP NAS 节点 (备)
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
        body: JSON.stringify({
            username: user,
            password: pass,
        }),
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
            'Authorization': token,
        },
        body: JSON.stringify(body),
    });
    return res.json();
}

export async function POST(request: Request) {
    try {
        const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        if (await checkIpBanned(clientIp)) {
            return NextResponse.json({ code: 403, message: '您的 IP 环境异常，已被防火墙阻断访问' }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const { action, path, name, names, newName, dir_name, keywords, scope, page, per_page } = body as {
            action: string;
            path?: string;
            name?: string;
            names?: string[];
            newName?: string;
            dir_name?: string;
            keywords?: string;
            scope?: number;
            page?: number;
            per_page?: number;
        };

        const authHeader = request.headers.get('authorization') || undefined;

        // 所有操作都需要登录
        const user = verifyToken(authHeader);
        if (!user) {
            return NextResponse.json({ code: 401, message: '请先登录' }, { status: 401 });
        }

        const customUrl = request.headers.get('x-alist-url');
        const customUser = request.headers.get('x-alist-username');
        const customPass = request.headers.get('x-alist-password');

        let config: { url: string; user: string; pass: string };
        if (customUrl) {
            config = { url: customUrl.replace(/\/+$/, ''), user: customUser || '', pass: customPass || '' };
        } else {
            // 根据管理员设置的渠道选择后端
            const settings = await getSettings();
            const channel = settings.downloadChannel || 'ecs';
            config = channel === 'ecs'
                ? { url: ECS_URL, user: ECS_USER, pass: ECS_PASS }
                : { url: FRP_URL, user: FRP_USER, pass: FRP_PASS };
        }

        if (!action) {
            return NextResponse.json({ code: 400, message: '缺少 action 参数' }, { status: 400 });
        }

        // 获取用户颗粒度权限
        const perms = await getUserPermissions(user.username, user.role);
        
        // --- 根目录权限隔离 ---
        const applyBasePath = (p: string | undefined) => {
            const original = p || '/';
            const bp = (perms.basePath || '/').replace(/\/+$/, '');
            if (!bp) return original;
            if (original === '/') return bp || '/';
            return `${bp}${original.startsWith('/') ? '' : '/'}${original}`;
        };
        const removeBasePath = (fullPath: string) => {
            if (!fullPath) return '/';
            const bp = (perms.basePath || '/').replace(/\/+$/, '');
            if (!bp) return fullPath;
            if (fullPath.startsWith(bp)) {
                let stripped = fullPath.substring(bp.length);
                if (!stripped) return '/';
                return stripped.startsWith('/') ? stripped : `/${stripped}`;
            }
            return fullPath;
        };

        const scopedPath = applyBasePath(path);

        // 写操作与读取操作精细权限校验
        if (action === 'list' || action === 'get') {
            const isRoot = !path || path === '/';
            if (!isRoot && !perms.view) return NextResponse.json({ code: 403, message: '无权浏览子目录' }, { status: 403 });
        }
        if (action === 'mkdir' && !perms.upload) return NextResponse.json({ code: 403, message: '无权创建文件夹（需要上传权限）' }, { status: 403 });
        if (action === 'remove' && !perms.delete) return NextResponse.json({ code: 403, message: '无权删除文件' }, { status: 403 });
        if (action === 'rename' && !perms.rename) return NextResponse.json({ code: 403, message: '无权修改文件/文件夹名' }, { status: 403 });

        let result: any;

        switch (action) {
            case 'list':
                result = await alistFetch('/api/fs/list', { path: scopedPath, page: 1, per_page: 0, refresh: false }, config);
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
                result = await alistFetch('/api/fs/search', { parent: scopedPath || '/', keywords: keywords, scope: scope || 1, page: page || 1, per_page: per_page || 100 }, config);
                // 搜索结果返回的是 AList 原始绝对路径，需要剥离 basePath 供前端使用，防止下次进入请求导致路径重复叠加
                if (result.code === 200 && result.data?.content) {
                    result.data.content = result.data.content.map((item: any) => ({
                        ...item,
                        path: removeBasePath(item.path)
                    }));
                }
                break;

            default:
                return NextResponse.json({ code: 400, message: `未知操作: ${action}` }, { status: 400 });
        }

        return NextResponse.json(result);
    } catch (e: any) {
        console.error('[alist] error:', e);
        return NextResponse.json(
            { code: 500, message: e?.message || 'AList 代理出错' },
            { status: 500 },
        );
    }
}
