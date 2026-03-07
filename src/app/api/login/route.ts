import { NextResponse } from 'next/server';
import { signToken } from '../_auth';
import { findUser, getSettings } from '@/lib/users';

export async function POST(request: Request) {
    try {
        const body = await request.json();

        // 游客模式
        if (body.guest === true) {
            const settings = getSettings();
            if (!settings.allowGuestDownload) {
                return NextResponse.json({ error: '游客模式已被管理员关闭' }, { status: 403 });
            }
            const token = signToken('guest', 'guest');
            if (!token) return NextResponse.json({ error: '服务端配置异常' }, { status: 500 });
            return NextResponse.json({ token, role: 'guest', username: 'guest' });
        }

        // 用户名密码登录
        const { username, password } = body;
        if (!username || !password) {
            return NextResponse.json({ error: '请填写用户名和密码' }, { status: 400 });
        }

        const user = findUser(username, password);
        if (!user) {
            return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
        }

        const token = signToken(user.username, user.role);
        if (!token) return NextResponse.json({ error: '服务端配置异常' }, { status: 500 });

        return NextResponse.json({ token, role: user.role, username: user.username });
    } catch {
        return NextResponse.json({ error: '登录接口异常' }, { status: 500 });
    }
}
