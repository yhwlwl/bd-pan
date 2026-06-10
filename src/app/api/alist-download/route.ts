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
    if (data.code !== 200 || !data.data?.token) throw new Error(data.message || 'AList 登录失败');

    const newToken = data.data.token;
    tokenCache.set(cacheKey, { token: newToken, expiry: Date.now() + 47 * 60 * 60 * 1000 });
    return newToken;
}

function normalizeVisiblePath(path?: string) {
    const raw = (path || '/').trim();
    if (!raw || raw === '/') return '/';
    return (raw.startsWith('/') ? raw : `/${raw}`).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

export async function GET(request: Request) {
    try {
        const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        if (await checkIpBanned(clientIp)) {
            return new Response('您的 IP 已被禁止访问', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }

        const { searchParams } = new URL(request.url);
        const path = searchParams.get('path');
        const configB64 = searchParams.get('c');
        const tokenParam = searchParams.get('token');
        if (!path) {
            return NextResponse.json({ error: '缺少 path 参数' }, { status: 400 });
        }

        const authHeader = request.headers.get('authorization') || (tokenParam ? `Bearer ${tokenParam}` : undefined);
        const user = verifyToken(authHeader);
        if (!user) {
            return new Response('请先登录', { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }

        const basePerms = await getUserPermissions(user.username, user.role);
        const absolutePath = applyBasePathForPermissions(path, basePerms.basePath);
        const isPreview = searchParams.get('preview') === '1';
        console.log(`[download] path=${path}, absolutePath=${absolutePath}, user=${user.username}, role=${user.role}, isPreview=${isPreview}`);
        const pathPerms = await getEffectivePermissionsForPath(user.username, user.role, absolutePath);
        console.log(`[download] perms: download=${pathPerms.download}, preview=${pathPerms.preview}, view=${pathPerms.view}`);
        if (isPreview && !pathPerms.preview) {
            console.warn(`[download] 预览被拒: ${absolutePath}`);
            return new Response('该文件禁止预览', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
        if (!isPreview && !pathPerms.download) {
            console.warn(`[download] 下载被拒: ${absolutePath}`);
            return new Response('该文件禁止下载', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }

        let customConfig: any = null;
        if (configB64) {
            try {
                const s = Buffer.from(configB64, 'base64').toString('utf8');
                try {
                    customConfig = JSON.parse(s);
                } catch {
                    customConfig = JSON.parse(decodeURIComponent(s));
                }
            } catch { }
        }

        let url: string;
        let aUser: string;
        let aPass: string;
        if (customConfig?.url) {
            url = customConfig.url.replace(/\/+$/, '');
            aUser = customConfig.user || '';
            aPass = customConfig.pass || '';
        } else {
            const settings = await getSettings();
            const channel = settings.downloadChannel || 'ecs';
            if (channel === 'ecs') {
                url = ECS_URL;
                aUser = ECS_USER;
                aPass = ECS_PASS;
            } else {
                url = FRP_URL;
                aUser = FRP_USER;
                aPass = FRP_PASS;
            }
        }

        const token = await getAlistToken(url, aUser, aPass);
        const scopedPath = absolutePath;
        const filename = normalizeVisiblePath(scopedPath).split('/').pop() || 'download';
        const rangeHeader = request.headers.get('range');

        const getRes = await fetch(`${url}/api/fs/get`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: token,
            },
            body: JSON.stringify({ path: scopedPath }),
        });
        const getData = await getRes.json();

        if (getData.code !== 200) {
            return NextResponse.json({ error: getData.message || '获取文件信息失败' }, { status: 500 });
        }

        const rawUrl = getData.data?.raw_url;
        const isBaidu = rawUrl && (rawUrl.includes('baidupcs.com') || rawUrl.includes('baidu.com'));
        let fileRes: Response;

        if (isBaidu && rawUrl) {
            const fetchHeaders: Record<string, string> = { 'User-Agent': 'pan.baidu.com' };
            if (rangeHeader) fetchHeaders.Range = rangeHeader;
            fileRes = await fetch(rawUrl, { headers: fetchHeaders });
        } else {
            const proxyHeaders: Record<string, string> = { Authorization: token };
            if (rangeHeader) proxyHeaders.Range = rangeHeader;

            const sign = getData.data?.sign || '';
            const publicPath = normalizeVisiblePath(path);
            const proxyUrl = sign ? `${url}/p${publicPath}?sign=${sign}` : `${url}/p${publicPath}`;
            fileRes = await fetch(proxyUrl, { headers: proxyHeaders });
        }

        if (!fileRes.ok && fileRes.status !== 206) {
            const errText = await fileRes.text().catch(() => '');
            return new Response(`下载失败 (${fileRes.status}): ${errText.substring(0, 200)}`, {
                status: fileRes.status,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
        }

        const responseHeaders = new Headers();
        responseHeaders.set('Content-Disposition', `${isPreview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`);
        responseHeaders.set('Content-Type', fileRes.headers.get('Content-Type') || 'application/octet-stream');

        const contentLength = fileRes.headers.get('Content-Length');
        if (contentLength) responseHeaders.set('Content-Length', contentLength);

        const contentRange = fileRes.headers.get('Content-Range');
        if (contentRange) responseHeaders.set('Content-Range', contentRange);
        if (rangeHeader && contentRange) responseHeaders.set('Accept-Ranges', 'bytes');

        return new Response(fileRes.body, {
            status: fileRes.status,
            headers: responseHeaders,
        });
    } catch (error: any) {
        console.error('[alist-download] error:', error);
        return new Response(`下载代理出错: ${error?.message || '未知错误'}`, {
            status: 500,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }
}
