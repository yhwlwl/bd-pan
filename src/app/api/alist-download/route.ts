import { NextResponse } from 'next/server';
import { verifyToken, verifyTokenWithLog, type AuthContext } from '../_auth';
import { denyAndLog, getRequestContext, checkEntityBanned } from '../../../lib/deny-tracker';
import { hashDeviceCode } from '../../../lib/fingerprint';
import {
    getEffectivePermissionsForPath,
    getSettings,
    getUserPermissions,
} from '../../../lib/users';
import { pgInsert } from '../../../lib/pg-adapter';
import { encodeAlistPathForUrl, isAlistPathScopeError, resolveScopedAlistPath } from '../../../lib/path-scope';

const ECS_URL = (process.env.NEXT_PUBLIC_ALIST_URL || 'https://pan.tantantan.tech:5245').replace(/\/+$/, '');
const ECS_USER = process.env.ALIST_USERNAME || '';
const ECS_PASS = process.env.ALIST_PASSWORD || '';

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

function formatBytes(bytes: number): string {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)}GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${bytes}B`;
}

export async function GET(request: Request) {
    let requestUsername: string | undefined;
    try {
        const ctx = getRequestContext(request);
        const deviceCodeHash = hashDeviceCode(ctx.deviceCode || '');
        const { searchParams } = new URL(request.url);
        const path = searchParams.get('path');
        const tokenParam = searchParams.get('token');
        if (!path) {
            return NextResponse.json({ error: '缺少 path 参数' }, { status: 400 });
        }

        const authHeader = request.headers.get('authorization') || (tokenParam ? `Bearer ${tokenParam}` : undefined);
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
            return new Response('请先登录', { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
        requestUsername = user.username;

        const basePerms = await getUserPermissions(user.username, user.role);
        const absolutePath = resolveScopedAlistPath(path, basePerms.basePath);
        const isPreview = searchParams.get('preview') === '1';
        // 来源由服务端决定，不能让客户端把下载日志伪装成另一站点。
        const logSource = process.env.APP_SOURCE || 'pan';
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

        const settings = await getSettings();
        const url = ECS_URL;
        const aUser = ECS_USER;
        const aPass = ECS_PASS;

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
            const encodedPath = encodeAlistPathForUrl(absolutePath);
            const proxyUrl = sign ? `${url}/p${encodedPath}?sign=${encodeURIComponent(sign)}` : `${url}/p${encodedPath}`;
            fileRes = await fetch(proxyUrl, { headers: proxyHeaders });
        }

        const fileSize = parseInt(fileRes.headers.get('Content-Length') || '0', 10) || (getData.data?.size || 0);

        if (!fileRes.ok && fileRes.status !== 206) {
            const errText = await fileRes.text().catch(() => '');
            // 记录下载失败
            pgInsert('bdpan_action_logs', {
                created_at: new Date().toISOString(),
                username: user.username,
                action_type: `下载${isPreview ? ' - 预览' : ''} - 失败`,
                action_item: `${path} (${formatBytes(fileSize)})`,
                ip: ctx.ip, location: '未知定位',
                log_text: `${user.username} 下载失败: ${path} HTTP${fileRes.status}`,
                source: logSource,
            }).catch(() => {});
            return new Response(`下载失败 (${fileRes.status}): ${errText.substring(0, 200)}`, {
                status: fileRes.status,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
        }

        // 记录下载成功
        pgInsert('bdpan_action_logs', {
            created_at: new Date().toISOString(),
            username: user.username,
            action_type: `下载${isPreview ? ' - 预览' : ''} - 成功`,
            action_item: `${path} (${formatBytes(fileSize)})`,
            ip: ctx.ip, location: '未知定位',
            log_text: `${user.username} 下载成功: ${path}, ${formatBytes(fileSize)}`,
            source: logSource,
        }).catch(() => {});

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
        if (isAlistPathScopeError(error)) {
            return denyAndLog(request, 'api_path_scope_denied', 403, '请求路径不在允许范围内', requestUsername);
        }
        return new Response(`下载代理出错: ${error?.message || '未知错误'}`, {
            status: 500,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }
}
