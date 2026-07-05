import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { signToken } from '../_auth';
import { findUser, getSettings, getUserPermissions } from '../../../lib/users';
import { getRequestContext, checkEntityBanned, denyAndLog } from '../../../lib/deny-tracker';
import { hashDeviceCode } from '../../../lib/fingerprint';

export async function POST(request: Request) {
    try {
        const ctx = getRequestContext(request);

        // 设备码封禁检查（含 IP + 设备码双维度）
        const deviceCodeHash = hashDeviceCode(ctx.deviceCode || '');
        const { banned, reason } = await checkEntityBanned(ctx.ip, deviceCodeHash);
        if (banned) {
            return NextResponse.json({ code: 403, message: `您的${reason === 'device' ? '设备' : 'IP'}已被防火墙阻断访问` }, { status: 403 });
        }

        const body = await request.json();

        const settings = await getSettings();
        const durationHours = settings.sessionDurationHours || 8;

        // 游客模式
        if (body.guest === true) {
            if (!settings.enableGuestMode) {
                return denyAndLog(request, 'api_login_failed', 403, '系统已关闭游客访问');
            }
            const token = signToken('guest', 'guest', durationHours);
            if (!token) return NextResponse.json({ error: '服务端配置异常' }, { status: 500 });
            const permissions = await getUserPermissions('guest', 'guest');
            const sessionId = crypto.randomUUID();
            return NextResponse.json({ token, role: 'guest', username: 'guest', permissions, sessionId });
        }

        // 用户名密码登录
        const { username, password } = body;
        if (!username || !password) {
            return NextResponse.json({ error: '请填写用户名和密码' }, { status: 400 });
        }

        const user = await findUser(username, password);
        if (!user) {
            return denyAndLog(request, 'api_login_failed', 401, '用户名或密码错误');
        }

        const token = signToken(user.username, user.role, durationHours);
        if (!token) return NextResponse.json({ error: '服务端配置异常' }, { status: 500 });

        const permissions = await getUserPermissions(user.username, user.role);
        const sessionId = crypto.randomUUID();
        return NextResponse.json({ token, role: user.role, username: user.username, permissions, sessionId });
    } catch {
        return NextResponse.json({ error: '登录接口异常' }, { status: 500 });
    }
}
