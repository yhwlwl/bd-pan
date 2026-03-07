import { NextResponse } from 'next/server';
import { verifyToken } from '../_auth';
import { getUserPermissions } from '@/lib/users';

const DEFAULT_ALIST_URL = (process.env.NEXT_PUBLIC_ALIST_URL || 'https://frp-gap.com:37492').replace(/\/+$/, '');
const DEFAULT_ALIST_USERNAME = process.env.ALIST_USERNAME || '';
const DEFAULT_ALIST_PASSWORD = process.env.ALIST_PASSWORD || '';

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
        const body = await request.json().catch(() => ({}));
        const { action, path, name, names, newName, dir_name } = body as {
            action: string;
            path?: string;
            name?: string;
            names?: string[];
            newName?: string;
            dir_name?: string;
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

        const config = {
            url: customUrl ? customUrl.replace(/\/+$/, '') : DEFAULT_ALIST_URL,
            user: customUser || DEFAULT_ALIST_USERNAME,
            pass: customPass || DEFAULT_ALIST_PASSWORD,
        };

        if (!action) {
            return NextResponse.json({ code: 400, message: '缺少 action 参数' }, { status: 400 });
        }

        // 获取用户颗粒度权限
        const perms = await getUserPermissions(user.username, user.role);

        // 写操作与读取操作精细权限校验
        const writeActions = ['mkdir', 'remove', 'rename', 'upload'];

        if (action === 'list' || action === 'get') {
            // 根目录始终允许浏览，子目录需要 view 权限
            const isRoot = !path || path === '/';
            if (!isRoot && !perms.view) return NextResponse.json({ code: 403, message: '无权浏览子目录' }, { status: 403 });
        }
        if (action === 'mkdir') {
            if (!perms.upload) return NextResponse.json({ code: 403, message: '无权创建文件夹（需要上传权限）' }, { status: 403 });
        }
        if (action === 'remove') {
            if (!perms.delete) return NextResponse.json({ code: 403, message: '无权删除文件' }, { status: 403 });
        }
        if (action === 'rename') {
            if (!perms.rename) return NextResponse.json({ code: 403, message: '无权修改文件/文件夹名' }, { status: 403 });
        }

        let result: any;

        switch (action) {
            case 'list':
                result = await alistFetch('/api/fs/list', {
                    path: path || '/',
                    page: 1,
                    per_page: 0,
                    refresh: false,
                }, config);
                break;

            case 'get':
                result = await alistFetch('/api/fs/get', {
                    path: path || '/',
                }, config);
                break;

            case 'mkdir':
                result = await alistFetch('/api/fs/mkdir', {
                    path: `${(path || '/').replace(/\/+$/, '')}/${dir_name}`,
                }, config);
                break;

            case 'remove':
                result = await alistFetch('/api/fs/remove', {
                    dir: path || '/',
                    names: names || (name ? [name] : []),
                }, config);
                break;

            case 'rename':
                result = await alistFetch('/api/fs/rename', {
                    path: path || '/',
                    name: (newName || '').trim(),
                }, config);
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
