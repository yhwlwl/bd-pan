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

export async function PUT(request: Request) {
    const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    if (await checkIpBanned(clientIp)) {
        return NextResponse.json({ code: 403, message: '您的 IP 已被禁止访问' }, { status: 403 });
    }

    const user = verifyToken(request.headers.get('authorization') || undefined);
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

        const userPerms = await getUserPermissions(user.username, user.role);
        const filePath = applyBasePathForPermissions(originalFilePath, userPerms.basePath);
        const pathPerms = await getEffectivePermissionsForPath(user.username, user.role, filePath);
        if (!pathPerms.upload) {
            return NextResponse.json({ code: 403, message: '该目录禁止上传' }, { status: 403 });
        }

        const contentLength = request.headers.get('Content-Length');
        const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
        const uploadRes = await fetch(`${config.url}/api/fs/put`, {
            method: 'PUT',
            headers: {
                Authorization: tokenData.data.token,
                'File-Path': filePath,
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
