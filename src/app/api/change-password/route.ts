import { NextResponse } from 'next/server';
import { verifyTokenWithLog } from '../_auth';
import { changeUserPassword } from '../../../lib/users';
import { getRequestContext } from '../../../lib/deny-tracker';

// POST /api/change-password — 任意已登录用户修改自己的密码
// 需带 Authorization: Bearer <token>，body: { oldPassword, newPassword }
export async function POST(request: Request) {
    const ctx = getRequestContext(request);
    const auth = verifyTokenWithLog(request.headers.get('authorization') || undefined, ctx);
    if (!auth) {
        return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 });
    }

    try {
        const { oldPassword, newPassword } = await request.json();
        if (!newPassword) return NextResponse.json({ error: '新密码不能为空' }, { status: 400 });

        const result = await changeUserPassword(auth.username, oldPassword || '', newPassword);
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: '接口异常' }, { status: 500 });
    }
}
