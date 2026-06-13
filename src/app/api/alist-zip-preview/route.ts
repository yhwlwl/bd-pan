import { NextResponse } from 'next/server';
import { verifyToken } from '../_auth';
import {
    applyBasePathForPermissions,
    checkIpBanned,
    getEffectivePermissionsForPath,
    getSettings,
    getUserPermissions,
} from '../../../lib/users';

const ALIST_BASE_DEFAULT = (process.env.NEXT_PUBLIC_ALIST_URL || 'https://pan.tantantan.tech:5245').replace(/\/+$/, '');
const ECS_URL = ALIST_BASE_DEFAULT;
const ECS_USER = process.env.ALIST_USERNAME || '';
const ECS_PASS = process.env.ALIST_PASSWORD || '';
const FRP_URL = (process.env.NEXT_PUBLIC_ALIST_URL_FALLBACK || 'https://frp-gap.com:37492').replace(/\/+$/, '');
const FRP_USER = process.env.ALIST_USERNAME_FALLBACK || '';
const FRP_PASS = process.env.ALIST_PASSWORD_FALLBACK || '';

const tokenCache = new Map<string, { token: string; expiry: number }>();

async function getAlistToken(url: string, user: string, pass: string): Promise<string> {
    const cacheKey = `${url}:${user}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
        return cached.token;
    }

    const res = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
    });

    const data = (await res.json()) as { data?: { token: string } };
    const token = data.data?.token || '';
    tokenCache.set(cacheKey, { token, expiry: Date.now() + 8 * 60 * 60 * 1000 });
    return token;
}

function normalizeVisiblePath(path: string): string {
    return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

async function getAllFilesInDir(
    aListUrl: string,
    aListToken: string,
    dirPath: string,
    maxDepth: number = 100,
    currentDepth: number = 0,
): Promise<Array<{ path: string; size: number; is_dir: boolean; name: string }>> {
    if (currentDepth >= maxDepth) return [];

    const res = await fetch(`${aListUrl}/api/fs/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: aListToken },
        body: JSON.stringify({ path: dirPath }),
    });

    const data = await res.json();
    if (data.code !== 200) return [];

    const items = data.data?.content || [];
    const allFiles = [];

    for (const item of items) {
        const itemPath = `${normalizeVisiblePath(dirPath)}/${item.name}`.replace(/\/+/g, '/');
        if (item.is_dir) {
            const subFiles = await getAllFilesInDir(aListUrl, aListToken, itemPath, maxDepth, currentDepth + 1);
            allFiles.push(...subFiles);
        } else {
            allFiles.push({
                path: itemPath,
                size: item.size || 0,
                is_dir: false,
                name: item.name,
            });
        }
    }

    return allFiles;
}

export async function GET(request: Request) {
    try {
        const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        if (await checkIpBanned(clientIp)) {
            return new Response('IP banned', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }

        const { searchParams } = new URL(request.url);
        const pathsParam = searchParams.get('paths');
        const tokenParam = searchParams.get('token');

        if (!pathsParam) {
            return NextResponse.json({ error: 'Missing paths' }, { status: 400 });
        }

        let paths: string[];
        try {
            paths = JSON.parse(pathsParam);
            if (!Array.isArray(paths)) throw new Error('paths must be array');
        } catch {
            return NextResponse.json({ error: 'Invalid paths format' }, { status: 400 });
        }

        // Verify user
        const authHeader = request.headers.get('authorization') || (tokenParam ? `Bearer ${tokenParam}` : undefined);
        const user = verifyToken(authHeader);
        if (!user) {
            return NextResponse.json({ error: '请先登录' }, { status: 401 });
        }

        // Check permissions
        const basePerms = await getUserPermissions(user.username, user.role);

        const settings = await getSettings();
        const channel = settings.downloadChannel || 'ecs';
        const url = channel === 'ecs' ? ECS_URL : FRP_URL;
        const aUser = channel === 'ecs' ? ECS_USER : FRP_USER;
        const aPass = channel === 'ecs' ? ECS_PASS : FRP_PASS;

        const aListToken = await getAlistToken(url, aUser, aPass);

        // 收集目录信息用于显示
        const dirInfos: Array<{ name: string; fileCount: number }> = [];
        let deniedCount = 0;

        for (const path of paths) {
            const absolutePath = applyBasePathForPermissions(path, basePerms.basePath);
            const pathName = path.split('/').pop() || 'folder';

            // 权限检查
            const pathPerms = await getEffectivePermissionsForPath(user.username, user.role, absolutePath);
            if (!pathPerms.view || !pathPerms.download) {
                console.log(`[ZIP-preview] 权限跳过: ${path}`);
                deniedCount++;
                continue;
            }

            const getRes = await fetch(`${url}/api/fs/get`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: aListToken },
                body: JSON.stringify({ path: absolutePath }),
            });

            if (!getRes.ok) continue;

            const getData = await getRes.json();
            if (getData.code !== 200) continue;

            const isDir = getData.data?.is_dir || false;

            if (isDir) {
                const allFiles = await getAllFilesInDir(url, aListToken, absolutePath);
                dirInfos.push({ name: pathName, fileCount: allFiles.length });
            }
        }

        if (dirInfos.length === 0 && deniedCount > 0) {
            return NextResponse.json({ error: '所有选定项均被权限策略禁止访问', denied: true }, { status: 403 });
        }

        return NextResponse.json({
            message: '[ZIP] 开始生成 ZIP 文件...',
            dirs: dirInfos
        });

    } catch (error: any) {
        console.error('[ZIP预览] 错误:', error);
        return new Response(`错误: ${error?.message}`, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
}