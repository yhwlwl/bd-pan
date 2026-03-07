import { NextResponse } from 'next/server';
import { verifyAdminToken } from '../_auth';

const ALIST_URL = (process.env.ALIST_URL || 'https://frp-gap.com:37492').replace(/\/+$/, '');
const ALIST_USERNAME = process.env.ALIST_USERNAME || '';
const ALIST_PASSWORD = process.env.ALIST_PASSWORD || '';

export async function POST(request: Request) {
    const authHeader = request.headers.get('authorization') || undefined;
    if (!verifyAdminToken(authHeader)) {
        return NextResponse.json({ error: '需要管理员权限喵...' }, { status: 401 });
    }

    try {
        const res = await fetch(`${ALIST_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: ALIST_USERNAME, password: ALIST_PASSWORD }),
        });
        const data = await res.json();
        if (data.code !== 200 || !data.data?.token) {
            return NextResponse.json({ error: data.message || 'AList 登录失败' }, { status: 500 });
        }
        return NextResponse.json({ token: data.data.token });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || '接口异常' }, { status: 500 });
    }
}
