import { NextResponse } from 'next/server';
import { requireRole } from '../_auth';

const DEFAULT_ALIST_URL = (process.env.ALIST_URL || 'http://47.108.222.119:5244').replace(/\/+$/, '');
const DEFAULT_ALIST_USERNAME = process.env.ALIST_USERNAME || '';
const DEFAULT_ALIST_PASSWORD = process.env.ALIST_PASSWORD || '';

export async function PUT(request: Request) {
    // 仅 admin / manager 可上传
    const authHeader = request.headers.get('authorization') || undefined;
    const user = requireRole(authHeader, 'admin', 'manager');
    if (!user) {
        return NextResponse.json({ code: 403, message: '权限不足，仅管理员可上传文件' }, { status: 403 });
    }

    try {
        const customUrl = request.headers.get('x-alist-url');
        const customUser = request.headers.get('x-alist-username');
        const customPass = request.headers.get('x-alist-password');

        const config = {
            url: customUrl ? customUrl.replace(/\/+$/, '') : DEFAULT_ALIST_URL,
            user: customUser || DEFAULT_ALIST_USERNAME,
            pass: customPass || DEFAULT_ALIST_PASSWORD,
        };

        // 1. 获取 AList Token
        const tokenRes = await fetch(`${config.url}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: config.user, password: config.pass }),
        });
        const tokenData = await tokenRes.json();
        if (tokenData.code !== 200 || !tokenData.data?.token) {
            return NextResponse.json({ code: 500, message: 'AList 目标实例 Token 获取失败' }, { status: 500 });
        }
        const alistToken = tokenData.data.token;

        // 2. 拿到要上传的路径信息
        const filePath = request.headers.get('File-Path');
        if (!filePath) {
            return NextResponse.json({ code: 400, message: '缺少 File-Path 请求头' }, { status: 400 });
        }

        const contentLength = request.headers.get('Content-Length');
        const contentType = request.headers.get('Content-Type') || 'application/octet-stream';

        // 3. Proxy 到 AList Server
        const uploadRes = await fetch(`${config.url}/api/fs/put`, {
            method: 'PUT',
            headers: {
                'Authorization': alistToken,
                'File-Path': filePath,
                'Content-Type': contentType,
                ...(contentLength ? { 'Content-Length': contentLength } : {}),
            },
            // @ts-ignore
            body: request.body,
            duplex: 'half'
        } as any);

        const data = await uploadRes.json();
        return NextResponse.json(data);
    } catch (e: any) {
        console.error('[alist-upload] 代理上传异常:', e);
        return NextResponse.json(
            { code: 500, message: e?.message || '服务器代理上传请求发生异常' },
            { status: 500 },
        );
    }
}
