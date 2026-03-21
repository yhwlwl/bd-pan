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

export async function GET(request: Request) {
    try {
        const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        if (await checkIpBanned(clientIp)) {
            return new Response('您的 IP 环境异常，已被防火墙阻断访问', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }

        const { searchParams } = new URL(request.url);
        const path = searchParams.get('path');
        const configB64 = searchParams.get('c');
        const tokenParam = searchParams.get('token'); // Token via query string (GET 请求无法用 header)
        if (!path) {
            return NextResponse.json({ error: '缺少 path 参数' }, { status: 400 });
        }

        // 权限校验
        const authHeader = request.headers.get('authorization') || (tokenParam ? `Bearer ${tokenParam}` : undefined);
        const user = verifyToken(authHeader);
        if (!user) {
            return new Response('请先登录', { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }

        // 检查下载权限
        const perms = await getUserPermissions(user.username, user.role);
        if (!perms.download) {
            return new Response('权限不足，无权下载文件', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
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
            } catch (e) {
                // ignore
            }
        }

        let url: string, aUser: string, aPass: string;
        if (customConfig?.url) {
            url = customConfig.url.replace(/\/+$/, '');
            aUser = customConfig.user || '';
            aPass = customConfig.pass || '';
        } else {
            const settings = await getSettings();
            const channel = settings.downloadChannel || 'ecs';
            if (channel === 'ecs') { url = ECS_URL; aUser = ECS_USER; aPass = ECS_PASS; }
            else { url = FRP_URL; aUser = FRP_USER; aPass = FRP_PASS; }
        }

        const token = await getAlistToken(url, aUser, aPass);
        
        const bp = (perms.basePath || '/').replace(/\/+$/, '');
        const scopedPath = bp ? `${bp}${path.startsWith('/') ? '' : '/'}${path}` : path;
        const filename = scopedPath.split('/').pop() || 'download';
        const rangeHeader = request.headers.get('range');

        // 获取文件信息
        const getRes = await fetch(`${url}/api/fs/get`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token,
            },
            body: JSON.stringify({ path: scopedPath }),
        });
        const getData = await getRes.json();

        if (getData.code !== 200) {
            return NextResponse.json(
                { error: getData.message || '获取文件信息失败' },
                { status: 500 }
            );
        }

        const rawUrl = getData.data?.raw_url;
        const isBaidu = rawUrl && (rawUrl.includes('baidupcs.com') || rawUrl.includes('baidu.com'));

        let fileRes: Response;

        if (isBaidu && rawUrl) {
            const fetchHeaders: Record<string, string> = {
                'User-Agent': 'pan.baidu.com',
            };
            if (rangeHeader) fetchHeaders['Range'] = rangeHeader;
            fileRes = await fetch(rawUrl, { headers: fetchHeaders });
        } else {
            const proxyHeaders: Record<string, string> = {
                'Authorization': token,
            };
            if (rangeHeader) proxyHeaders['Range'] = rangeHeader;

            const sign = getData.data?.sign || '';
            const proxyUrl = sign
                ? `${url}/p${path}?sign=${sign}`
                : `${url}/p${path}`;

            fileRes = await fetch(proxyUrl, { headers: proxyHeaders });
        }

        if (!fileRes.ok && fileRes.status !== 206) {
            const errText = await fileRes.text().catch(() => '');
            return new Response(
                `下载失败 (${fileRes.status}): ${errText.substring(0, 200)}`,
                { status: fileRes.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
            );
        }

        const responseHeaders = new Headers();
        const isPreview = searchParams.get('preview') === '1';
        responseHeaders.set('Content-Disposition', `${isPreview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`);

        const contentType = fileRes.headers.get('Content-Type') || 'application/octet-stream';
        responseHeaders.set('Content-Type', contentType);

        const contentLength = fileRes.headers.get('Content-Length');
        if (contentLength) responseHeaders.set('Content-Length', contentLength);

        const contentRange = fileRes.headers.get('Content-Range');
        if (contentRange) responseHeaders.set('Content-Range', contentRange);

        if (rangeHeader && contentRange) {
            responseHeaders.set('Accept-Ranges', 'bytes');
        }

        return new Response(fileRes.body, {
            status: fileRes.status,
            headers: responseHeaders,
        });

    } catch (e: any) {
        console.error('[alist-download] error:', e);
        return new Response(
            `下载代理出错: ${e?.message || '未知错误'}`,
            { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        );
    }
}
