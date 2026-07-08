import { NextResponse } from 'next/server';
import { verifyToken, verifyTokenWithLog } from '../_auth';
import { denyAndLog, getRequestContext, checkEntityBanned } from '../../../lib/deny-tracker';
import { hashDeviceCode } from '../../../lib/fingerprint';
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

export async function PUT(request: Request) {
    const ctx = getRequestContext(request);
    const deviceCodeHash = hashDeviceCode(ctx.deviceCode || '');
    const { banned, reason: banReason } = await checkEntityBanned(ctx.ip, deviceCodeHash);
    if (banned) {
        return NextResponse.json({ code: 403, message: `您的${banReason === 'device' ? '设备' : 'IP'}已被禁止访问` }, { status: 403 });
    }

    const user = verifyTokenWithLog(request.headers.get('authorization') || undefined, ctx);
    if (!user) {
        return NextResponse.json({ code: 401, message: '请先登录' }, { status: 401 });
    }

    try {
        const customUrl = request.headers.get('x-alist-url');
        const customUser = request.headers.get('x-alist-username');
        const customPass = request.headers.get('x-alist-password');

        let config: { url: string; user: string; pass: string };
        if (customUrl) {
            config = { url: customUrl.replace(/\/+$/, ''), user: customUser || '', pass: customPass || '' };
        } else {
            const settings = await getSettings();
            const channel = settings.downloadChannel || 'ecs';
            config = channel === 'ecs'
                ? { url: ECS_URL, user: ECS_USER, pass: ECS_PASS }
                : { url: FRP_URL, user: FRP_USER, pass: FRP_PASS };
        }

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
        let filePath = applyBasePathForPermissions(rawFilePath, userPerms.basePath);
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

        const data = await uploadRes.json();
        return NextResponse.json(data);
    } catch (error: any) {
        console.error('[alist-upload] error:', error);
        return NextResponse.json({ code: 500, message: error?.message || '上传代理失败' }, { status: 500 });
    }
}
