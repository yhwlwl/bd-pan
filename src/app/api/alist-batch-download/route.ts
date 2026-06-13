import { NextResponse } from 'next/server';
import { verifyToken } from '../_auth';
import {
    applyBasePathForPermissions,
    checkIpBanned,
    getEffectivePermissionsForPath,
    getSettings,
    getUserPermissions,
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
    if (cached && Date.now() < cached.expiry) return cached.token;

    const res = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
    });
    const data = await res.json();
    if (data.code !== 200 || !data.data?.token) throw new Error('AList 登录失败');
    const newToken = data.data.token;
    tokenCache.set(cacheKey, { token: newToken, expiry: Date.now() + 47 * 60 * 60 * 1000 });
    return newToken;
}

export async function GET(request: Request) {
    try {
        const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        if (await checkIpBanned(clientIp)) {
            return NextResponse.json({ error: 'IP 已被禁止' }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const pathsParam = searchParams.get('paths');
        const tokenParam = searchParams.get('token');
        const name = searchParams.get('name') || 'download';

        if (!pathsParam) return NextResponse.json({ error: '缺少 paths 参数' }, { status: 400 });

        let paths: string[];
        try { paths = JSON.parse(pathsParam); if (!Array.isArray(paths)) throw new Error(); } catch {
            return NextResponse.json({ error: 'paths 格式错误' }, { status: 400 });
        }

        const authHeader = request.headers.get('authorization') || (tokenParam ? `Bearer ${tokenParam}` : undefined);
        const user = verifyToken(authHeader);
        if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

        // 权限检查
        const basePerms = await getUserPermissions(user.username, user.role);
        for (const p of paths) {
            const absPath = applyBasePathForPermissions(p, basePerms.basePath);
            const perms = await getEffectivePermissionsForPath(user.username, user.role, absPath);
            if (!perms.view || !perms.download) {
                return NextResponse.json({ error: `无权访问: ${p}` }, { status: 403 });
            }
        }

        const settings = await getSettings();
        const channel = settings.downloadChannel || 'ecs';
        const url = channel === 'ecs' ? ECS_URL : FRP_URL;
        const aUser = channel === 'ecs' ? ECS_USER : FRP_USER;
        const aPass = channel === 'ecs' ? ECS_PASS : FRP_PASS;
        const token = await getAlistToken(url, aUser, aPass);

        // 调用 alist 打包 API
        console.log(`[batch-dl] 调用 alist archive: ${paths.length} 个路径`);
        const archiveRes = await fetch(`${url}/api/fs/other`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: token },
            body: JSON.stringify({
                method: 'archive',
                paths,
                name: `${name}.zip`,
            }),
        });
        const archiveData = await archiveRes.json();
        console.log(`[batch-dl] alist archive 返回: code=${archiveData.code}`, archiveData.data || archiveData.message);

        if (archiveData.code === 200 && archiveData.data) {
            // alist 返回了下载链接
            const downloadUrl = archiveData.data.url || archiveData.data;
            if (downloadUrl && typeof downloadUrl === 'string') {
                const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : `${url}${downloadUrl}`;
                return NextResponse.json({ ok: true, url: fullUrl });
            }
        }

        // 降级：返回 null 让前端用旧 ZIP 方案
        console.warn('[batch-dl] alist archive 不可用，降级');
        return NextResponse.json({ ok: false, fallback: true, error: archiveData.message || 'archive not available' });
    } catch (error: any) {
        console.error('[batch-dl] 错误:', error);
        return NextResponse.json({ ok: false, fallback: true, error: error?.message }, { status: 500 });
    }
}
