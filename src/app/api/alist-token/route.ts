import { NextResponse } from 'next/server';
import { verifyToken } from '../_auth';
import { getUserPermissions, getSettings } from '../../../lib/users';

// ECS 成都节点 (主)
const ECS_URL = (process.env.NEXT_PUBLIC_ALIST_URL || 'https://pan.tantantan.tech').replace(/\/+$/, '');
const ECS_USER = process.env.ALIST_USERNAME || '';
const ECS_PASS = process.env.ALIST_PASSWORD || '';
// FRP NAS 节点 (备)
const FRP_URL = (process.env.NEXT_PUBLIC_ALIST_URL_FALLBACK || 'https://frp-gap.com:37492').replace(/\/+$/, '');
const FRP_USER = process.env.ALIST_USERNAME_FALLBACK || '';
const FRP_PASS = process.env.ALIST_PASSWORD_FALLBACK || '';

const tokenCache = new Map<string, { token: string; expiry: number }>();

export async function POST(request: Request) {
    const authHeader = request.headers.get('authorization') || undefined;
    const user = verifyToken(authHeader);
    if (!user) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const perms = await getUserPermissions(user.username, user.role);
    if (!perms.upload) {
        return NextResponse.json({ error: '权限不足，无权上传' }, { status: 403 });
    }

    try {
        // 根据管理员设置的渠道选择后端
        const settings = await getSettings();
        const channel = settings.downloadChannel || 'ecs';
        const alistUrl = channel === 'ecs' ? ECS_URL : FRP_URL;
        const alistUser = channel === 'ecs' ? ECS_USER : FRP_USER;
        const alistPass = channel === 'ecs' ? ECS_PASS : FRP_PASS;

        const cacheKey = `${alistUrl}|${alistUser}`;
        const cached = tokenCache.get(cacheKey);
        if (cached && Date.now() < cached.expiry) {
            return NextResponse.json({ token: cached.token, url: alistUrl });
        }

        const res = await fetch(`${alistUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: alistUser, password: alistPass }),
        });
        const data = await res.json();
        if (data.code !== 200 || !data.data?.token) {
            return NextResponse.json({ error: data.message || 'AList 登录失败' }, { status: 500 });
        }

        tokenCache.set(cacheKey, { token: data.data.token, expiry: Date.now() + 47 * 60 * 60 * 1000 });
        return NextResponse.json({ token: data.data.token, url: alistUrl });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || '接口异常' }, { status: 500 });
    }
}
