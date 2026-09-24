import { NextResponse } from 'next/server';
import { verifyToken, verifyTokenWithLog } from '../_auth';
import { denyAndLog, getRequestContext, checkEntityBanned } from '../../../lib/deny-tracker';
import { hashDeviceCode } from '../../../lib/fingerprint';
import {
    getEffectivePermissionsForPath,
    getSettings,
    getUserPermissions,
} from '../../../lib/users';
import { isAlistPathScopeError, resolveScopedAlistPath } from '../../../lib/path-scope';

const ECS_URL = (process.env.NEXT_PUBLIC_ALIST_URL || 'https://pan.tantantan.tech:5245').replace(/\/+$/, '');
const ECS_USER = process.env.ALIST_USERNAME || '';
const ECS_PASS = process.env.ALIST_PASSWORD || '';

export async function PUT(request: Request) {
    const ctx = getRequestContext(request);
    const deviceCodeHash = hashDeviceCode(ctx.deviceCode || '');
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

    try {
        const settings = await getSettings();
        const config = { url: ECS_URL, user: ECS_USER, pass: ECS_PASS };

        const tokenRes = await fetch(`${config.url}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: config.user, password: config.pass }),
        });
        const tokenData = await tokenRes.json();
        if (tokenData.code !== 200 || !tokenData.data?.token) {
            return NextResponse.json({ code: 500, message: 'AList Token 获取失败' }, { status: 500 });
        }

        const originalFilePath = request.headers.get('File-Path');
        if (!originalFilePath) {
            return NextResponse.json({ code: 400, message: '缺少 File-Path 请求头' }, { status: 400 });
        }

        const decodePathSegments = (path: string) => path.split('/').map((seg) => {
            try { return decodeURIComponent(seg); } catch { return seg; }
        }).join('/');

        const rawFilePath = decodePathSegments(originalFilePath);
        const userPerms = await getUserPermissions(user.username, user.role);
        const filePath = resolveScopedAlistPath(rawFilePath, userPerms.basePath);
        const encodedFilePath = filePath.split('/').map(encodeURIComponent).join('/');

        console.log('[alist-upload] userPerms.basePath:', userPerms.basePath, 'originalFilePath:', originalFilePath, 'rawFilePath:', rawFilePath, 'resolvedFilePath:', filePath, 'encodedFilePath:', encodedFilePath);

        const pathPerms = await getEffectivePermissionsForPath(user.username, user.role, filePath);
        if (!pathPerms.upload) {
            return denyAndLog(request, 'api_permission_denied', 403, '该目录禁止上传', user.username);
        }

        const contentLength = request.headers.get('Content-Length');
        const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
        const uploadRes = await fetch(`${config.url}/api/fs/put`, {
            method: 'PUT',
            headers: {
                Authorization: tokenData.data.token,
                'File-Path': encodedFilePath,
                'Content-Type': contentType,
                ...(contentLength ? { 'Content-Length': contentLength } : {}),
            },
            body: request.body,
            duplex: 'half',
        } as any);

        const data = await uploadRes.json().catch(() => ({}));
        return NextResponse.json({
            code: data?.code ?? (uploadRes.ok ? 200 : uploadRes.status),
            message: data?.message || (uploadRes.ok ? 'success' : 'AList 上传失败'),
            data: null,
        }, { status: uploadRes.ok ? 200 : uploadRes.status });
    } catch (error: any) {
        console.error('[alist-upload] error:', error);
        if (isAlistPathScopeError(error)) {
            return denyAndLog(request, 'api_path_scope_denied', 403, '请求路径不在允许范围内', tokenUser?.username);
        }
        return NextResponse.json({ code: 500, message: error?.message || '上传代理失败' }, { status: 500 });
    }
}
