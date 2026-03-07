import { NextResponse } from 'next/server';
import { signToken } from '../_auth';
import { findUser, getSettings, getUserPermissions } from '../../../lib/users';

export async function POST(request: Request) {
    try {
        const body = await request.json();

        // 游客模式
        if (body.guest === true) {
            const settings = await getSettings();
            if (!settings.enableGuestMode) {
                return NextResponse.json({ error: '系统已关闭游客访问' }, { status: 403 });
            }
            const token = signToken('guest', 'guest');
            if (!token) return NextResponse.json({ error: '服务端配置异常' }, { status: 500 });
            const permissions = await getUserPermissions('guest', 'guest');
            return NextResponse.json({ token, role: 'guest', username: 'guest', permissions });
        }

        // 用户名密码登录
        const { username, password } = body;
        if (!username || !password) {
            return NextResponse.json({ error: '请填写用户名和密码' }, { status: 400 });
        }

        const user = await findUser(username, password);
        if (!user) {
            return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
        }

        const token = signToken(user.username, user.role);
        if (!token) return NextResponse.json({ error: '服务端配置异常' }, { status: 500 });

        const permissions = await getUserPermissions(user.username, user.role);
        return NextResponse.json({ token, role: user.role, username: user.username, permissions });
    } catch {
        return NextResponse.json({ error: '登录接口异常' }, { status: 500 });
    }
}
